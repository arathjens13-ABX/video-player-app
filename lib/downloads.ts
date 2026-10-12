import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import {
  deleteEpisodeRow,
  getEpisode,
  insertEpisode,
  listEpisodes,
  notify,
  updateEpisode,
  type DownloadKind,
  type Episode,
} from './db';
import { fetchBytes, fetchText, FilePartStore, FileSink, partsDir } from './fs-io';
import { formatBytes } from './format';
import { assemble, downloadParts, partsSize, planFingerprint, planStream } from './hls-download';
import { getStreamQuality } from './settings';
import { deleteThumbnail, ensureThumbnail, thumbsDir } from './thumbs';
import { sniffVideo, type SniffResult } from './sniff';
import { USER_AGENT } from './ua';

const MAX_CONCURRENT = 2;
const MAX_STREAM_HEIGHT = 1080;
const KEEP_AWAKE_TAG = 'vidstash-downloads';
const DB_PROGRESS_INTERVAL_MS = 1000;


export const videosDir = new Directory(Paths.document, 'videos');

export function videoFile(episode: Pick<Episode, 'fileName'>) {
  return new File(videosDir, episode.fileName);
}

const active = new Map<number, Job>();
const lastDbWrite = new Map<number, number>();
// Ids being removed, so their cancellation isn't recorded as an error.
const removing = new Set<number>();

export type NewDownload = {
  url: string;
  kind: DownloadKind;
  show: string;
  title: string;
  pageUrl?: string | null;
  referer?: string | null;
  /** Stream quality cap; defaults to the Settings choice. */
  maxHeight?: number;
};

function headersFor(referer: string | null | undefined) {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (referer) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch {
      // Ignore a malformed referer; the Referer header alone is still sent.
    }
  }
  return headers;
}

export function enqueue(d: NewDownload) {
  const headers = headersFor(d.referer);
  const id = insertEpisode({
    show: d.show,
    title: d.title,
    sourceUrl: d.url,
    pageUrl: d.pageUrl ?? null,
    headersJson: JSON.stringify(headers),
    kind: d.kind,
    maxHeight: d.kind === 'hls' ? (d.maxHeight ?? getStreamQuality()) : null,
  });
  pump();
  return id;
}

/**
 * Points an existing download at a freshly found link (the old one expired or
 * stopped working) and queues it again, keeping its name and place.
 */
export function relink(id: number, d: { url: string; kind: DownloadKind; referer?: string | null }) {
  const job = active.get(id);
  if (job) {
    removing.add(id); // its cancellation isn't an error
    job.cancel();
    setTimeout(() => removing.delete(id), 5000);
  }
  progress.delete(id);
  updateEpisode(id, {
    sourceUrl: d.url,
    kind: d.kind,
    headersJson: JSON.stringify(headersFor(d.referer)),
    status: 'queued',
    error: null,
    resumeJson: null,
    bytesWritten: 0,
  });
  // Let a cancelled job wind down before the new one starts.
  setTimeout(pump, job ? 300 : 0);
}

function pump() {
  if (active.size >= MAX_CONCURRENT) return;
  const queued = listEpisodes()
    .filter((e) => e.status === 'queued' && !active.has(e.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const episode of queued) {
    if (active.size >= MAX_CONCURRENT) break;
    start(episode);
  }
}

/** A running download, whichever kind. */
type Job = { pause(): void; cancel(): void };

function start(episode: Episode) {
  updateEpisode(episode.id, { status: 'downloading', error: null });
  const job = episode.kind === 'hls' ? startStream(episode) : startFile(episode);
  active.set(episode.id, job);
  updateKeepAwake();
}

function finished(id: number) {
  active.delete(id);
  lastDbWrite.delete(id);
  updateKeepAwake();
  pump();
}

function failed(id: number, err: unknown, patch: Partial<Episode> = {}) {
  if (removing.has(id)) return;
  updateEpisode(id, { status: 'error', error: explainError(err), ...patch });
}

/** Turns low-level failures into something actionable. */
export function explainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b(401|403|404|410)\b/.test(message)) {
    return `${message}. The link has probably expired (they only last a few hours on many sites). Use Find again.`;
  }
  if (/network|offline|internet|timed out|timeout/i.test(message)) {
    return `${message}. Check your connection, then Retry.`;
  }
  return message;
}

function startFile(episode: Episode): Job {
  videosDir.create({ idempotent: true, intermediates: true });
  const options = {
    headers: JSON.parse(episode.headersJson) as Record<string, string>,
    onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) =>
      onProgress(episode.id, { bytesWritten, totalBytes }),
  };

  let task: DownloadTask;
  let run: () => Promise<File | null>;
  if (episode.resumeJson) {
    task = DownloadTask.fromSavable(JSON.parse(episode.resumeJson) as DownloadPauseState, options);
    run = () => task.resumeAsync();
  } else {
    const destination = videoFile(episode);
    if (destination.exists) destination.delete();
    task = File.createDownloadTask(episode.sourceUrl, destination, options);
    run = () => task.downloadAsync();
  }

  run()
    .then((file) => {
      if (file) {
        const check = checkDownloadedFile(file);
        if (!check.ok) {
          try {
            file.delete();
          } catch {
            // Leaving the bad file is harmless; it is overwritten on retry.
          }
          updateEpisode(episode.id, { status: 'error', error: check.reason, resumeJson: null, bytesWritten: 0 });
          return;
        }
        const size = file.size ?? 0;
        updateEpisode(episode.id, {
          status: 'done',
          bytesWritten: size,
          totalBytes: size,
          resumeJson: null,
        });
        makeThumbnail(episode.id);
      } else {
        // Paused: keep what native code needs to pick the transfer back up.
        let resumeJson: string | null = null;
        try {
          resumeJson = JSON.stringify(task.savable());
        } catch {
          // No resume data; the download will restart from the beginning.
        }
        updateEpisode(episode.id, { status: 'paused', resumeJson });
      }
    })
    // A failed resume usually means stale resume data; drop it so a retry starts fresh.
    .catch((err: unknown) => failed(episode.id, err, { resumeJson: null }))
    .finally(() => {
      task.release();
      finished(episode.id);
    });

  return { pause: () => task.pause(), cancel: () => task.cancel() };
}

/**
 * Streams download piece by piece into a parts folder, then get assembled into
 * one MP4. Pieces already on disk are kept, so pausing (or the app being
 * closed) loses at most the pieces in flight.
 */
function startStream(episode: Episode): Job {
  const controller = new AbortController();
  let pausing = false;
  const headers = JSON.parse(episode.headersJson) as Record<string, string>;
  const store = new FilePartStore(partsDir(episode.id));

  (async () => {
    const plan = await planStream(episode.sourceUrl, fetchText(headers, controller.signal), episode.maxHeight ?? MAX_STREAM_HEIGHT);
    // Pieces saved earlier must belong to this exact stream; if the site now serves something else, start over.
    store.prepare(planFingerprint(plan));
    const free = freeSpace();
    const remaining = (plan.estimatedBytes ?? 0) - partsSize(plan, store);
    if (free !== null && remaining > 0 && free < remaining + 100e6) {
      throw new Error(`Not enough free space: this video needs about ${formatBytes(remaining)} more`);
    }
    await downloadParts(plan, store, fetchBytes, headers, {
      concurrency: 4,
      signal: controller.signal,
      onProgress: ({ done, total, bytes }) =>
        onProgress(episode.id, { bytesWritten: bytes, totalBytes: -1, fraction: done / total, note: `${done} of ${total} pieces` }),
    });
    if (controller.signal.aborted) return;

    // Parts are deleted as they go into the MP4, so finishing only needs a little headroom.
    const headroom = partsSize(plan, store) * 0.15 + 50e6;
    const freeNow = freeSpace();
    if (freeNow !== null && freeNow < headroom) {
      throw new Error(`Not enough free space to finish: free up about ${formatBytes(headroom - freeNow)}`);
    }

    videosDir.create({ idempotent: true, intermediates: true });
    const sink = new FileSink(videoFile(episode));
    let duration: number;
    try {
      duration = await assemble(plan, store, sink, {
        signal: controller.signal,
        consumeParts: true,
        onProgress: (f) =>
          onProgress(episode.id, { bytesWritten: sink.position, totalBytes: -1, fraction: f, note: 'Finishing…' }),
      });
    } catch (e) {
      sink.close();
      // A half-written MP4 is useless; the parts left over are what resuming needs.
      try {
        videoFile(episode).delete();
      } catch {
        // Already gone.
      }
      throw e;
    }
    sink.close();
    const size = videoFile(episode).size ?? 0;
    updateEpisode(episode.id, { status: 'done', bytesWritten: size, totalBytes: size, durationSec: duration });
    deleteParts(episode.id);
    makeThumbnail(episode.id);
  })()
    .catch((err: unknown) => {
      if (pausing) updateEpisode(episode.id, { status: 'paused' });
      else failed(episode.id, err);
    })
    .finally(() => finished(episode.id));

  return {
    pause: () => {
      pausing = true;
      controller.abort();
    },
    cancel: () => controller.abort(),
  };
}

function makeThumbnail(id: number) {
  const e = getEpisode(id);
  if (!e) return;
  ensureThumbnail(e, videoFile(e).uri).then((made) => made && notify());
}

function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

function deleteParts(id: number) {
  try {
    const dir = partsDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // Leftover parts only cost space; Settings shows usage.
  }
}

// Stream downloads run in JavaScript, which iOS pauses when the screen locks; keep it on while they run.
let keepingAwake = false;
function updateKeepAwake() {
  const needed = [...active.keys()].some((id) => getEpisode(id)?.kind === 'hls');
  if (needed === keepingAwake) return;
  keepingAwake = needed;
  if (needed) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

function checkDownloadedFile(file: File): SniffResult {
  try {
    const handle = file.open();
    try {
      return sniffVideo(handle.readBytes(64));
    } finally {
      handle.close();
    }
  } catch {
    // Can't read it back; let the player be the judge.
    return { ok: true };
  }
}

// Live progress lives in memory so the UI can update often without hammering SQLite.
export type Progress = {
  bytesWritten: number;
  totalBytes: number;
  /** 0..1 when known some other way than bytes (stream downloads count pieces). */
  fraction?: number;
  note?: string;
};
const progress = new Map<number, Progress>();
const progressListeners = new Set<() => void>();

export function getProgress(id: number): Progress | undefined {
  return progress.get(id);
}

export function subscribeProgress(listener: () => void) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function onProgress(id: number, p: Progress) {
  progress.set(id, p);
  progressListeners.forEach((l) => l());
  const now = Date.now();
  if (now - (lastDbWrite.get(id) ?? 0) > DB_PROGRESS_INTERVAL_MS) {
    lastDbWrite.set(id, now);
    updateEpisode(id, { bytesWritten: p.bytesWritten, totalBytes: p.totalBytes }, { silent: true });
  }
}

export function pause(id: number) {
  active.get(id)?.pause();
}

export function resume(id: number) {
  updateEpisode(id, { status: 'queued', error: null });
  pump();
}

export function retry(id: number) {
  progress.delete(id);
  updateEpisode(id, { status: 'queued', error: null, resumeJson: null, bytesWritten: 0 });
  pump();
}

export function remove(id: number) {
  const task = active.get(id);
  if (task) {
    removing.add(id);
    task.cancel();
  }
  const episode = getEpisode(id);
  if (episode) {
    const file = videoFile(episode);
    try {
      if (file.exists) file.delete();
    } catch {
      // The row still goes; a leftover file is cleaned up with the videos folder.
    }
  }
  deleteParts(id);
  deleteThumbnail(id);
  progress.delete(id);
  deleteEpisodeRow(id);
  setTimeout(() => removing.delete(id), 5000);
}

/**
 * Deletes files nothing refers to: stream pieces of finished or removed
 * downloads, and videos whose episode is gone. Returns the bytes freed.
 */
export function cleanUpFiles(): number {
  const episodes = new Map(listEpisodes().map((e) => [e.id, e]));
  let freed = 0;
  const partsRoot = new Directory(Paths.document, 'parts');
  try {
    if (partsRoot.exists) {
      for (const entry of partsRoot.list()) {
        if (!/^\d+$/.test(entry.name)) continue;
        const e = episodes.get(Number(entry.name));
        const inUse = e && e.status !== 'done' && !removing.has(e.id);
        if (!inUse) {
          freed += entry.size ?? 0;
          entry.delete();
        }
      }
    }
    if (videosDir.exists) {
      const known = new Set([...episodes.values()].map((e) => e.fileName));
      for (const entry of videosDir.list()) {
        // Only files the app named itself ("<id>.mp4"): the folder is visible in the Files app.
        if (/^\d+\.mp4$/.test(entry.name) && !known.has(entry.name)) {
          freed += entry.size ?? 0;
          entry.delete();
        }
      }
    }
    if (thumbsDir.exists) {
      for (const entry of thumbsDir.list()) {
        const m = entry.name.match(/^(\d+)\.jpg$/);
        if (m && !episodes.has(Number(m[1]))) {
          freed += entry.size ?? 0;
          entry.delete();
        }
      }
    }
  } catch {
    // Best effort; anything left is tried again next time.
  }
  return freed;
}

/** Space taken by pieces of unfinished stream downloads. */
export function temporaryFilesSize(): number {
  try {
    const partsRoot = new Directory(Paths.document, 'parts');
    return partsRoot.exists ? (partsRoot.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

let initialized = false;

/**
 * Call once at startup: downloads cut off by the app closing go back in the
 * queue, videos deleted outside the app (e.g. in the Files app) are flagged so
 * they can be downloaded again, and leftover files are cleaned up.
 */
export function initDownloads() {
  if (initialized) return;
  initialized = true;
  for (const e of listEpisodes()) {
    if (e.status === 'downloading') updateEpisode(e.id, { status: 'queued' }, { silent: true });
    else if (e.status === 'done' && !videoFile(e).exists) {
      updateEpisode(
        e.id,
        { status: 'error', error: 'The video file was deleted outside the app. Retry to download it again.', bytesWritten: 0, resumeJson: null },
        { silent: true }
      );
    }
  }
  cleanUpFiles();
  notify();
  pump();
}
