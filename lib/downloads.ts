import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from 'expo-file-system';

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
import { sniffVideo, type SniffResult } from './sniff';
import { USER_AGENT } from './ua';

const MAX_CONCURRENT = 2;
const DB_PROGRESS_INTERVAL_MS = 1000;


export const videosDir = new Directory(Paths.document, 'videos');

export function videoFile(episode: Pick<Episode, 'fileName'>) {
  return new File(videosDir, episode.fileName);
}

const active = new Map<number, DownloadTask>();
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
};

export function enqueue(d: NewDownload) {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (d.referer) {
    headers.Referer = d.referer;
    try {
      headers.Origin = new URL(d.referer).origin;
    } catch {
      // Ignore a malformed referer; the Referer header alone is still sent.
    }
  }
  const id = insertEpisode({
    show: d.show,
    title: d.title,
    sourceUrl: d.url,
    pageUrl: d.pageUrl ?? null,
    headersJson: JSON.stringify(headers),
    kind: d.kind,
  });
  pump();
  return id;
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

function start(episode: Episode) {
  if (episode.kind !== 'mp4') {
    updateEpisode(episode.id, {
      status: 'error',
      error: 'Streaming (HLS) downloads are not supported yet.',
    });
    return;
  }

  videosDir.create({ idempotent: true, intermediates: true });
  const options = {
    headers: JSON.parse(episode.headersJson) as Record<string, string>,
    onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) =>
      onProgress(episode.id, bytesWritten, totalBytes),
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

  active.set(episode.id, task);
  updateEpisode(episode.id, { status: 'downloading', error: null });

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
    .catch((err: unknown) => {
      if (removing.has(episode.id)) return;
      const message = err instanceof Error ? err.message : String(err);
      // A failed resume usually means stale resume data; drop it so a retry starts fresh.
      updateEpisode(episode.id, { status: 'error', error: message, resumeJson: null });
    })
    .finally(() => {
      active.delete(episode.id);
      lastDbWrite.delete(episode.id);
      task.release();
      pump();
    });
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
export type Progress = { bytesWritten: number; totalBytes: number };
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

function onProgress(id: number, bytesWritten: number, totalBytes: number) {
  progress.set(id, { bytesWritten, totalBytes });
  progressListeners.forEach((l) => l());
  const now = Date.now();
  if (now - (lastDbWrite.get(id) ?? 0) > DB_PROGRESS_INTERVAL_MS) {
    lastDbWrite.set(id, now);
    updateEpisode(id, { bytesWritten, totalBytes }, { silent: true });
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
  progress.delete(id);
  deleteEpisodeRow(id);
  setTimeout(() => removing.delete(id), 5000);
}

let initialized = false;

/** Call once at startup: downloads cut off by the app closing go back in the queue. */
export function initDownloads() {
  if (initialized) return;
  initialized = true;
  for (const e of listEpisodes()) {
    if (e.status === 'downloading') updateEpisode(e.id, { status: 'queued' }, { silent: true });
  }
  notify();
  pump();
}
