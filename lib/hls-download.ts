/**
 * Downloads an HLS stream and turns it into one MP4. Platform-independent:
 * the app supplies storage and networking (see downloads.ts); tests supply
 * Node versions.
 *
 * Two phases:
 * 1. download: every piece (segment, init section) is fetched, decrypted and
 *    saved as its own part file. Parts already on disk are skipped, so a
 *    paused or interrupted download picks up where it stopped.
 * 2. assemble: parts are read back in order and written into a single MP4.
 */

import { decryptAes128Cbc } from './aes';
import { audioFor, loadPlaylist, pickSubtitle, pickVariant, type FetchText, type MediaPlaylist, type Segment, type SubtitleTrack } from './hls';
import { joinVtt, MAX_SUBTITLE_CHARS } from './subtitles';
import { readBoxes } from './mp4/boxes';
import { FlatMp4Writer, type OutputSink } from './mp4/flatten';
import { TsToFmp4 } from './mp4/transmux';
import { URL } from './url';

export type FetchBytes = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<Uint8Array>;

export interface PartStore {
  has(name: string): boolean;
  write(name: string, bytes: Uint8Array): void;
  read(name: string): Uint8Array;
  remove(name: string): void;
  size(name: string): number;
}

type Part = {
  name: string;
  url: string;
  range?: { offset: number; length: number };
  key?: Segment['key'];
  /** IV for AES-128 when the playlist doesn't give one: the media sequence number. */
  sequence?: number;
};

export type StreamPlan = {
  /** 'video' and 'audio' when the audio is a separate rendition, otherwise just 'main'. */
  streams: { stream: string; init?: Part; segments: Part[] }[];
  format: 'fmp4' | 'ts';
  duration: number;
  height?: number;
  /** Rough size from the advertised bitrate, when the playlist gives one. */
  estimatedBytes?: number;
  /** English soft subtitles offered with the stream, saved alongside the video. */
  subtitle?: SubtitleTrack;
};

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function parseRange(byterange: string | undefined, nextOffset: number) {
  if (!byterange) return undefined;
  const [len, off] = byterange.split('@');
  return { length: Number(len), offset: off !== undefined ? Number(off) : nextOffset };
}

function partsFor(stream: string, segments: Segment[]) {
  let next = 0;
  let initPart: Part | undefined;
  const parts = segments.map((s, i): Part => {
    const range = parseRange(s.byterange, next);
    if (range) next = range.offset + range.length;
    if (s.map && !initPart) {
      // An init section can be encrypted by a key declared before it (with an explicit IV).
      initPart = { name: `${stream}-init`, url: s.map.url, range: parseRange(s.map.byterange, 0), key: s.map.key, sequence: 0 };
    }
    return { name: `${stream}-${i}`, url: s.url, range, key: s.key, sequence: s.sequence };
  });
  return { stream, init: initPart, segments: parts };
}

/** Rejects media playlists the app can't turn into a file. */
function checkMediaPlaylist(playlist: MediaPlaylist, what: string) {
  if (!playlist.ended) throw new Error(`This is a live stream (${what}), which can’t be downloaded`);
  if (playlist.segments.length === 0) throw new Error(`The stream’s ${what} is empty`);
  const keys = [...playlist.segments.map((s) => s.key), ...playlist.segments.map((s) => s.map?.key)];
  if (keys.some((k) => k && k.method !== 'AES-128')) {
    throw new Error('This stream is DRM-protected and can’t be downloaded');
  }
  const maps = new Set(playlist.segments.map((s) => s.map?.url));
  if (maps.size > 1) {
    // Usually ads spliced into the stream with their own encoding; one MP4 can't hold both.
    throw new Error('This stream changes format partway through (often inserted ads), which the app can’t save yet');
  }
}

/** Reads the playlists and works out every piece to download. */
export async function planStream(url: string, fetchText: FetchText, maxHeight = 1080): Promise<StreamPlan> {
  let playlist = await loadPlaylist(url, fetchText);
  let audioUrl: string | undefined;
  let height: number | undefined;
  let bandwidth: number | undefined;
  let subtitle: SubtitleTrack | undefined;
  if (playlist.type === 'master') {
    subtitle = pickSubtitle(playlist.subtitles);
    const variant = pickVariant(playlist.variants, maxHeight);
    if (!variant) throw new Error('The stream has no playable versions');
    height = variant.height;
    bandwidth = variant.bandwidth || undefined;
    audioUrl = audioFor(playlist, variant)?.url;
    playlist = await loadPlaylist(variant.url, fetchText);
  }
  if (playlist.type !== 'media') throw new Error('Unexpected playlist layout');
  checkMediaPlaylist(playlist, 'video');

  const format = playlist.segments[0]?.map ? 'fmp4' : 'ts';
  const streams = [partsFor(audioUrl ? 'video' : 'main', playlist.segments)];
  if (audioUrl) {
    const audio = await loadPlaylist(audioUrl, fetchText);
    if (audio.type !== 'media') throw new Error('Unexpected audio playlist layout');
    checkMediaPlaylist(audio, 'audio');
    if (format === 'ts' || !audio.segments[0]?.map) {
      throw new Error('This stream keeps its audio in a format the app can’t combine yet');
    }
    streams.push(partsFor('audio', audio.segments));
  }
  const estimatedBytes = bandwidth ? Math.round((bandwidth / 8) * playlist.duration) : undefined;
  return { streams, format, duration: playlist.duration, height, estimatedBytes, subtitle };
}

const MAX_SUBTITLE_PIECES = 2000;

/** The whole subtitle track as one WebVTT file (its playlist may split it into many pieces). */
export async function loadSubtitles(track: SubtitleTrack, fetchText: FetchText): Promise<string> {
  const playlist = await loadPlaylist(track.url, fetchText);
  if (playlist.type !== 'media') throw new Error('Unexpected subtitle playlist layout');
  if (playlist.segments.length > MAX_SUBTITLE_PIECES) throw new Error('Subtitle track has too many pieces');
  const pieces: string[] = [];
  let total = 0;
  for (const segment of playlist.segments) {
    const got = await fetchText(segment.url);
    const text = typeof got === 'string' ? got : got.text;
    total += text.length;
    if (total > MAX_SUBTITLE_CHARS) throw new Error('Subtitle track is too big');
    pieces.push(text);
  }
  const vtt = joinVtt(pieces);
  if (!vtt.includes('-->')) throw new Error('Subtitle track has no cues');
  return vtt;
}

export function allParts(plan: StreamPlan): Part[] {
  return plan.streams.flatMap((s) => (s.init ? [s.init, ...s.segments] : s.segments));
}

function ivFor(part: Part): Uint8Array {
  const iv = new Uint8Array(16);
  const hex = part.key?.iv?.replace(/^0x/i, '');
  if (hex) {
    const padded = hex.padStart(32, '0');
    for (let i = 0; i < 16; i++) iv[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  } else {
    // Big-endian media sequence number in the last bytes.
    let n = part.sequence ?? 0;
    for (let i = 15; i >= 8 && n > 0; i--) {
      iv[i] = n % 256;
      n = Math.floor(n / 256);
    }
  }
  return iv;
}

/**
 * Finds where MPEG-TS packets start. Some CDNs disguise stream pieces as
 * images by putting a PNG/JPEG/GIF header in front; players skip ahead to the
 * first sync byte, and so do we. Returns -1 if this isn't TS at all.
 */
export function findTsStart(data: Uint8Array, searchLimit = 64 * 1024): number {
  const limit = Math.min(searchLimit, data.length - 188 * 2);
  for (let k = 0; k <= limit; k++) {
    if (data[k] === 0x47 && data[k + 188] === 0x47 && data[k + 376] === 0x47) return k;
  }
  // A piece shorter than three packets: accept a sync byte at the start.
  return data[0] === 0x47 ? 0 : -1;
}

/**
 * Catches error pages and other junk served in place of a piece of video, so
 * it is retried rather than saved. Returns the piece, minus any disguise.
 */
function checkPart(format: StreamPlan['format'], part: Part, data: Uint8Array): Uint8Array {
  const fail = (): never => {
    throw new Error('The server sent something that isn’t video (the link may have expired)');
  };
  if (data.length < 8) fail();
  if (format === 'ts') {
    const start = findTsStart(data);
    if (start < 0) fail();
    return start > 0 ? data.subarray(start) : data;
  }
  const types = readBoxes(data).map((b) => b.type);
  const expected = part.name.endsWith('-init') ? 'moov' : 'moof';
  if (!types.includes(expected)) fail();
  return data;
}

export type DownloadProgress = { done: number; total: number; bytes: number };

/**
 * Fetches every part not already in the store. Resolves when all parts are
 * saved; rejects on the first part that still fails after retries, or when
 * `signal` aborts.
 */
export async function downloadParts(
  plan: StreamPlan,
  store: PartStore,
  fetchBytes: FetchBytes,
  headers: Record<string, string>,
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
    /** Called when a part fails and is about to be retried (for diagnostics). */
    onRetry?: (part: string, attempt: number, error: unknown) => void;
  } = {}
) {
  const parts = allParts(plan);
  const keys = new Map<string, Promise<Uint8Array>>();
  let done = parts.filter((p) => store.has(p.name)).length;
  let bytes = 0;
  const queue = parts.filter((p) => !store.has(p.name));
  opts.onProgress?.({ done, total: parts.length, bytes });

  // One part failing for good stops the others too (and cancels their requests).
  const stop = new AbortController();
  const onOuterAbort = () => stop.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  if (opts.signal?.aborted) stop.abort();
  const signal = stop.signal;

  const getKey = (url: string) => {
    let k = keys.get(url);
    if (!k) {
      k = fetchBytes(url, headers, signal);
      keys.set(url, k);
      k.catch(() => keys.delete(url));
    }
    return k;
  };

  async function fetchPart(part: Part) {
    const h = part.range
      ? { ...headers, Range: `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}` }
      : headers;
    let data = await fetchBytes(part.url, h, signal);
    if (part.key?.method === 'AES-128' && part.key.url) {
      const key = await getKey(part.key.url);
      if (key.length !== 16) throw new Error('The stream’s decryption key is invalid');
      try {
        data = await decryptAes128Cbc(key, ivFor(part), data);
      } catch {
        throw new Error('A piece of the stream couldn’t be decrypted');
      }
    }
    return checkPart(plan.format, part, data);
  }

  const ATTEMPTS = 4;
  async function worker() {
    while (queue.length > 0) {
      if (signal.aborted) throw abortError();
      const part = queue.shift()!;
      for (let attempt = 1; ; attempt++) {
        try {
          const data = await fetchPart(part);
          if (signal.aborted) throw abortError(); // don't write once the download has been stopped
          store.write(part.name, data);
          bytes += data.length;
          done++;
          opts.onProgress?.({ done, total: parts.length, bytes });
          break;
        } catch (e) {
          if (signal.aborted || attempt >= ATTEMPTS) throw e;
          opts.onRetry?.(part.name, attempt, e);
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length));
  // The failure that stopped the download. Errors from the requests it cancelled don't count:
  // they can't be told apart by type (expo/fetch reports cancellations as plain Errors).
  let firstFailure: { error: unknown } | null = null;
  // Wait for every worker to stop before reporting, so nothing writes to the store afterwards.
  const results = await Promise.allSettled(
    Array.from({ length: n }, () =>
      worker().catch((e) => {
        if (!signal.aborted) firstFailure ??= { error: e };
        stop.abort();
        throw e;
      })
    )
  );
  opts.signal?.removeEventListener('abort', onOuterAbort);
  if (firstFailure) throw (firstFailure as { error: unknown }).error;
  if (opts.signal?.aborted) throw abortError();
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected) throw rejected.reason;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Identifies a plan's pieces, so a resumed download can tell whether the parts
 * on disk came from the same stream (same quality, same segment layout).
 * Query strings are ignored: signed URLs change on every visit.
 */
export function planFingerprint(plan: StreamPlan): string {
  const paths = allParts(plan).map((p) => {
    try {
      return new URL(p.url).pathname + (p.range ? `@${p.range.offset}+${p.range.length}` : '');
    } catch {
      return p.url;
    }
  });
  // A short hash keeps the marker file small.
  let h = 0x811c9dc5;
  for (const ch of paths.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${plan.format}:${plan.height ?? 0}:${paths.length}:${h.toString(16)}`;
}

/** Bytes the downloaded parts take up: roughly the size the finished MP4 will be. */
export function partsSize(plan: StreamPlan, store: PartStore) {
  return allParts(plan).reduce((n, p) => n + (store.has(p.name) ? store.size(p.name) : 0), 0);
}

export type AssembleOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /**
   * Delete each part once it is in the MP4, so a download needs about 1x its
   * size in free space instead of 2x. Parts deleted before an interruption are
   * simply downloaded again.
   */
  consumeParts?: boolean;
};

/**
 * Writes the downloaded parts into one MP4. Returns its duration in seconds.
 * Yields between segments so the app stays responsive while it works.
 */
export async function assemble(plan: StreamPlan, store: PartStore, sink: OutputSink, opts: AssembleOptions = {}): Promise<number> {
  const writer = new FlatMp4Writer(sink);
  const longest = Math.max(...plan.streams.map((s) => s.segments.length));
  // A piece that breaks assembly is deleted, so a retry downloads it again instead of failing on it forever.
  let current = '';
  const take = (name: string) => {
    current = name;
    return store.read(name);
  };
  const done = (name: string) => {
    if (opts.consumeParts) store.remove(name);
  };
  try {
    return await assembleParts(plan, writer, longest, take, done, opts);
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError') && current && store.has(current)) store.remove(current);
    throw e;
  }
}

async function assembleParts(
  plan: StreamPlan,
  writer: FlatMp4Writer,
  longest: number,
  take: (name: string) => Uint8Array,
  done: (name: string) => void,
  opts: AssembleOptions
): Promise<number> {
  const step = async (i: number) => {
    opts.onProgress?.((i + 1) / longest);
    await tick();
    if (opts.signal?.aborted) throw abortError();
  };

  if (plan.format === 'ts') {
    const [main] = plan.streams;
    const tm = new TsToFmp4();
    for (let i = 0; i < main.segments.length; i++) {
      const name = main.segments[i].name;
      for (const out of tm.push(take(name))) {
        writer.addInit('main', out.init);
        writer.addFragments('main', out.data);
      }
      done(name);
      await step(i);
    }
  } else {
    for (const s of plan.streams) {
      if (!s.init) throw new Error('Stream is missing its init section');
      writer.addInit(s.stream, take(s.init.name));
    }
    // Interleave the streams segment by segment so audio and video stay close together in the file.
    for (let i = 0; i < longest; i++) {
      for (const s of plan.streams) {
        if (i >= s.segments.length) continue;
        const name = s.segments[i].name;
        writer.addFragments(s.stream, take(name));
        done(name);
      }
      await step(i);
    }
    for (const s of plan.streams) if (s.init) done(s.init.name);
  }
  return writer.finish();
}
