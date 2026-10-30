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
import { fetchBytes, fetchText, FilePartStore, FileSink, partsDir, partsRoot } from './fs-io';
import { formatBytes } from './format';
import { requestHeaders } from './http';
import { assemble, downloadParts, loadSubtitles, partsSize, planFingerprint, planStream, type StreamPlan } from './hls-download';
import { logError, logInfo, logWarn, shortUrl } from './log';
import { getStreamQuality } from './settings';
import { deleteThumbnail, ensureThumbnail, thumbsDir } from './thumbs';
import { sniffVideo, type SniffResult } from './sniff';
import { subtitleFileName } from './subtitles';
import { USER_AGENT } from './ua';
import { URL } from './url';

const MAX_CONCURRENT = 2;
/** Progress note while a stream's pieces are put together into the MP4. */
export const FINISHING = 'Finishing…';
const MAX_STREAM_HEIGHT = 1080;
const KEEP_AWAKE_TAG = 'vidstash-downloads';
const DB_PROGRESS_INTERVAL_MS = 1000;


export const videosDir = new Directory(Paths.document, 'videos');

export function videoFile(episode: Pick<Episode, 'fileName'>) {
  return new File(videosDir, episode.fileName);
}

/** Soft subtitles saved with the video, if the stream had English ones. */
export function subtitleFile(episode: Pick<Episode, 'fileName'>) {
  return new File(videosDir, subtitleFileName(episode.fileName));
}

const active = new Map<number, Job>(); // the current job per episode
const lastDbWrite = new Map<number, number>();

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
  return requestHeaders(referer, USER_AGENT);
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
  logInfo('queue', `#${id} added ${d.kind} ${shortUrl(d.url)} referer=${d.referer ? shortUrl(d.referer, 60) : 'none'}`);
  pump();
  return id;
}

/**
 * Points an existing download at a freshly found link (the old one expired or
 * stopped working) and queues it again, keeping its name and place.
 */
export function relink(id: number, d: { url: string; kind: DownloadKind; referer?: string | null }) {
  const old = detach(id);
  progress.delete(id);
  logInfo('queue', `#${id} relinked to ${d.kind} ${shortUrl(d.url)}`);
  updateEpisode(id, {
    sourceUrl: d.url,
    kind: d.kind,
    headersJson: JSON.stringify(headersFor(d.referer)),
    status: 'queued',
    error: null,
    resumeJson: null,
    bytesWritten: 0,
  });
  // A replaced stream job must stop writing to the parts folder before the new one starts.
  (old?.done ?? Promise.resolve()).then(pump, pump);
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

/**
 * A running download, whichever kind. A job only touches its episode while it
 * is the episode's current job: once removed or replaced it winds down quietly.
 */
type Job = {
  /** Asks the job to stop where it can pick up again; false when it can't (finishing a stream). */
  pause(): boolean;
  cancel(): void;
  /** Settles when the job has completely stopped. */
  done: Promise<void>;
  isCurrent(): boolean;
};

function start(episode: Episode) {
  logInfo('download', `#${episode.id} start ${episode.kind}${episode.maxHeight ? ` ≤${episode.maxHeight}p` : ''} ${shortUrl(episode.sourceUrl)}`);
  updateEpisode(episode.id, { status: 'downloading', error: null });
  const job: Job = { pause: () => false, cancel() {}, done: Promise.resolve(), isCurrent: () => active.get(episode.id) === job };
  active.set(episode.id, job);
  job.done = (episode.kind === 'hls' ? runStream(episode, job) : runFile(episode, job))
    .catch((err: unknown) => failed(job, episode.id, err))
    .finally(() => finishJob(episode.id, job));
  updateKeepAwake();
}

/** Stops tracking an episode's job (cancelling it) so it can be removed or replaced. */
function detach(id: number): Job | undefined {
  const job = active.get(id);
  if (!job) return undefined;
  active.delete(id);
  job.cancel();
  lastDbWrite.delete(id);
  updateKeepAwake();
  return job;
}

function finishJob(id: number, job: Job) {
  if (job.isCurrent()) {
    active.delete(id);
    lastDbWrite.delete(id);
    updateKeepAwake();
  }
  pump();
}

function failed(job: Job, id: number, err: unknown, patch: Partial<Episode> = {}) {
  if (!job.isCurrent()) return;
  logError('download', `#${id} failed:`, err);
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

async function runFile(episode: Episode, job: Job): Promise<void> {
  videosDir.create({ idempotent: true, intermediates: true });
  const options = {
    headers: JSON.parse(episode.headersJson) as Record<string, string>,
    onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
      if (job.isCurrent()) onProgress(episode.id, { bytesWritten, totalBytes });
    },
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
  job.pause = () => {
    task.pause();
    return true;
  };
  job.cancel = () => task.cancel();

  return run()
    .then((file) => {
      if (!job.isCurrent()) return;
      if (file) {
        const check = checkDownloadedFile(file);
        if (!check.ok) {
          const size = file.size ?? 0;
          try {
            file.delete();
          } catch {
            // Leaving the bad file is harmless; it is overwritten on retry.
          }
          logError('download', `#${episode.id} finished file is not a video (${size} bytes): ${check.reason}`);
          updateEpisode(episode.id, { status: 'error', error: check.reason, resumeJson: null, bytesWritten: 0 });
          return;
        }
        const size = file.size ?? 0;
        logInfo('download', `#${episode.id} done ${formatBytes(size)}`);
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
        logInfo('download', `#${episode.id} paused (resume data ${resumeJson ? 'saved' : 'missing'})`);
        updateEpisode(episode.id, { status: 'paused', resumeJson });
      }
    })
    // A failed resume usually means stale resume data; drop it so a retry starts fresh.
    .catch((err: unknown) => failed(job, episode.id, err, { resumeJson: null }))
    .finally(() => task.release());
}

/**
 * Streams download piece by piece into a parts folder, then get assembled into
 * one MP4. Pieces already on disk are kept, so pausing (or the app being
 * closed) loses at most the pieces in flight.
 */
function runStream(episode: Episode, job: Job): Promise<void> {
  const controller = new AbortController();
  let pausing = false;
  job.pause = () => {
    pausing = true;
    controller.abort();
    return true;
  };
  job.cancel = () => controller.abort();
  const headers = JSON.parse(episode.headersJson) as Record<string, string>;
  const store = new FilePartStore(partsDir(episode.id));
  const report = (p: Progress) => {
    if (job.isCurrent()) onProgress(episode.id, p);
  };

  return (async () => {
    const plan = await planStream(episode.sourceUrl, fetchText(headers, controller.signal), episode.maxHeight ?? MAX_STREAM_HEIGHT);
    logInfo(
      'stream',
      `#${episode.id} plan ${plan.format} ${plan.height ?? '?'}p ${Math.round(plan.duration)}s ` +
        plan.streams.map((s) => `${s.stream}:${s.segments.length}${s.init ? '+init' : ''}`).join(' ') +
        ` ~${plan.estimatedBytes ? formatBytes(plan.estimatedBytes) : '?'}` +
        (plan.streams.some((s) => s.segments.some((p) => p.key)) ? ' encrypted' : '')
    );
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
      onRetry: (part, attempt, err) => logWarn('stream', `#${episode.id} ${part} attempt ${attempt} failed, retrying:`, err),
      onProgress: ({ done, total, bytes }) =>
        report({ bytesWritten: bytes, totalBytes: -1, fraction: done / total, note: `${done} of ${total} pieces` }),
    });
    if (controller.signal.aborted) return;

    // Parts are deleted as they go into the MP4, so finishing only needs a little headroom.
    const pieces = partsSize(plan, store);
    const headroom = pieces * 0.15 + 50e6;
    const freeNow = freeSpace();
    if (freeNow !== null && freeNow < headroom) {
      throw new Error(`Not enough free space to finish: free up about ${formatBytes(headroom - freeNow)}`);
    }

    // Assembling is local and quick, and the pieces it has used are gone: let it finish.
    job.pause = () => false;
    videosDir.create({ idempotent: true, intermediates: true });
    logInfo('stream', `#${episode.id} assembling ${formatBytes(pieces)} of pieces`);
    const sink = new FileSink(videoFile(episode));
    let duration: number;
    try {
      duration = await assemble(plan, store, sink, {
        signal: controller.signal,
        consumeParts: true,
        onProgress: (f) => report({ bytesWritten: sink.position, totalBytes: -1, fraction: f, note: FINISHING }),
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
    if (!job.isCurrent()) return;
    const size = videoFile(episode).size ?? 0;
    logInfo('stream', `#${episode.id} done ${formatBytes(size)} ${Math.round(duration)}s`);
    await saveSubtitles(episode, plan, headers);
    updateEpisode(episode.id, { status: 'done', bytesWritten: size, totalBytes: size, durationSec: duration });
    deleteParts(episode.id);
    makeThumbnail(episode.id);
  })().catch((err: unknown) => {
    if (pausing && job.isCurrent()) {
      logInfo('stream', `#${episode.id} paused`);
      updateEpisode(episode.id, { status: 'paused' });
    } else failed(job, episode.id, err);
  });
}

/** Best effort: a video without its subtitles still plays, so failures are only logged. */
async function saveSubtitles(episode: Episode, plan: StreamPlan, headers: Record<string, string>) {
  if (!plan.subtitle) return;
  const label = plan.subtitle.name ?? plan.subtitle.language ?? 'subtitles';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const vtt = await loadSubtitles(plan.subtitle, fetchText(headers, controller.signal));
    const file = subtitleFile(episode);
    if (file.exists) file.delete();
    file.create();
    file.write(vtt);
    logInfo('stream', `#${episode.id} saved ${label} subtitles (${formatBytes(vtt.length)})`);
  } catch (e) {
    logWarn('stream', `#${episode.id} couldn’t save ${label} subtitles:`, e);
  } finally {
    clearTimeout(timer);
  }
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
  const job = active.get(id);
  // Show it paused straight away; the job itself may take a moment to wind down.
  if (job?.pause()) updateEpisode(id, { status: 'paused' });
}

export function resume(id: number) {
  // A job that is still winding down must stop writing before the next one starts.
  const winding = active.get(id);
  (winding?.done ?? Promise.resolve()).then(() => {
    const episode = getEpisode(id);
    if (episode?.status !== 'paused') return; // finished, removed or failed meanwhile
    updateEpisode(id, { status: 'queued', error: null });
    pump();
  });
}

export function retry(id: number) {
  progress.delete(id);
  updateEpisode(id, { status: 'queued', error: null, resumeJson: null, bytesWritten: 0 });
  pump();
}

export function remove(id: number) {
  logInfo('queue', `#${id} removed`);
  detach(id);
  const episode = getEpisode(id);
  if (episode) {
    try {
      for (const file of [videoFile(episode), subtitleFile(episode)]) if (file.exists) file.delete();
    } catch {
      // The row still goes; a leftover file is cleaned up with the videos folder.
    }
  }
  deleteParts(id);
  deleteThumbnail(id);
  progress.delete(id);
  deleteEpisodeRow(id);
}

/**
 * Deletes files nothing refers to: stream pieces of finished or removed
 * downloads, and videos whose episode is gone. Returns the bytes freed.
 */
export function cleanUpFiles(): number {
  const episodes = new Map(listEpisodes().map((e) => [e.id, e]));
  let freed = 0;
  try {
    if (partsRoot.exists) {
      for (const entry of partsRoot.list()) {
        if (!/^\d+$/.test(entry.name)) continue;
        const e = episodes.get(Number(entry.name));
        const inUse = e && e.status !== 'done';
        if (!inUse) {
          freed += entry.size ?? 0;
          entry.delete();
        }
      }
    }
    if (videosDir.exists) {
      const known = new Set([...episodes.values()].flatMap((e) => [e.fileName, subtitleFileName(e.fileName)]));
      for (const entry of videosDir.list()) {
        // Only files the app named itself ("<id>.mp4", "<id>.vtt"): the folder is visible in the Files app.
        if (/^\d+\.(mp4|vtt)$/.test(entry.name) && !known.has(entry.name)) {
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
      logWarn('app', `#${e.id} video file missing; flagged for re-download`);
      updateEpisode(
        e.id,
        { status: 'error', error: 'The video file was deleted outside the app. Retry to download it again.', bytesWritten: 0, resumeJson: null },
        { silent: true }
      );
    }
  }
  const freed = cleanUpFiles();
  const counts = new Map<string, number>();
  for (const e of listEpisodes()) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  logInfo(
    'app',
    `startup: ${[...counts].map(([status, n]) => `${n} ${status}`).join(', ') || 'no downloads'}` +
      (freed > 0 ? `, cleaned ${formatBytes(freed)}` : '')
  );
  notify();
  pump();
}
