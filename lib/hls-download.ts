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
import { cbc } from '@noble/ciphers/aes.js';

import { audioFor, parsePlaylist, pickVariant, type Segment } from './hls';
import { readBoxes } from './mp4/boxes';
import { FlatMp4Writer, type OutputSink } from './mp4/flatten';
import { TsToFmp4 } from './mp4/transmux';

export type FetchBytes = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<Uint8Array>;

export interface PartStore {
  has(name: string): boolean;
  write(name: string, bytes: Uint8Array): void;
  read(name: string): Uint8Array;
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
      initPart = { name: `${stream}-init`, url: s.map.url, range: parseRange(s.map.byterange, 0) };
    }
    return { name: `${stream}-${i}`, url: s.url, range, key: s.key, sequence: s.sequence };
  });
  return { stream, init: initPart, segments: parts };
}

/** Reads the playlists and works out every piece to download. */
export async function planStream(
  url: string,
  fetchText: (url: string) => Promise<string>,
  maxHeight = 1080
): Promise<StreamPlan> {
  let playlist = parsePlaylist(await fetchText(url), url);
  let audioUrl: string | undefined;
  let height: number | undefined;
  if (playlist.type === 'master') {
    const variant = pickVariant(playlist.variants, maxHeight);
    if (!variant) throw new Error('The stream has no playable versions');
    height = variant.height;
    audioUrl = audioFor(playlist, variant)?.url;
    playlist = parsePlaylist(await fetchText(variant.url), variant.url);
  }
  if (playlist.type !== 'media') throw new Error('Unexpected playlist layout');
  if (!playlist.ended) throw new Error('This is a live stream, which can’t be downloaded');
  if (playlist.segments.some((s) => s.key && s.key.method !== 'AES-128')) {
    throw new Error('This stream is DRM-protected and can’t be downloaded');
  }

  const format = playlist.segments[0]?.map ? 'fmp4' : 'ts';
  const streams = [partsFor(audioUrl ? 'video' : 'main', playlist.segments)];
  if (audioUrl) {
    const audio = parsePlaylist(await fetchText(audioUrl), audioUrl);
    if (audio.type !== 'media') throw new Error('Unexpected audio playlist layout');
    if (format === 'ts' || !audio.segments[0]?.map) {
      throw new Error('This stream keeps its audio in a format the app can’t combine yet');
    }
    streams.push(partsFor('audio', audio.segments));
  }
  return { streams, format, duration: playlist.duration, height };
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

/** Catches error pages and other junk served in place of a piece of video, so it is retried, not saved. */
function checkPart(format: StreamPlan['format'], part: Part, data: Uint8Array) {
  const fail = () => {
    throw new Error('The server sent something that isn’t video (the link may have expired)');
  };
  if (data.length < 8) fail();
  if (format === 'ts') {
    if (data[0] !== 0x47) fail(); // MPEG-TS sync byte
  } else {
    const types = readBoxes(data).map((b) => b.type);
    const expected = part.name.endsWith('-init') ? 'moov' : 'moof';
    if (!types.includes(expected)) fail();
  }
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
  opts: { concurrency?: number; signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {}
) {
  const parts = allParts(plan);
  const keys = new Map<string, Promise<Uint8Array>>();
  let done = parts.filter((p) => store.has(p.name)).length;
  let bytes = 0;
  const queue = parts.filter((p) => !store.has(p.name));
  opts.onProgress?.({ done, total: parts.length, bytes });

  const getKey = (url: string) => {
    let k = keys.get(url);
    if (!k) {
      k = fetchBytes(url, headers, opts.signal);
      keys.set(url, k);
      k.catch(() => keys.delete(url));
    }
    return k;
  };

  async function fetchPart(part: Part) {
    const h = part.range
      ? { ...headers, Range: `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}` }
      : headers;
    let data = await fetchBytes(part.url, h, opts.signal);
    if (part.key?.method === 'AES-128' && part.key.url) {
      const key = await getKey(part.key.url);
      if (key.length !== 16) throw new Error('The stream’s decryption key is invalid');
      try {
        data = cbc(key, ivFor(part)).decrypt(data);
      } catch {
        throw new Error('A piece of the stream couldn’t be decrypted');
      }
    }
    checkPart(plan.format, part, data);
    return data;
  }

  async function worker() {
    while (queue.length > 0) {
      if (opts.signal?.aborted) throw abortError();
      const part = queue.shift()!;
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const data = await fetchPart(part);
          store.write(part.name, data);
          bytes += data.length;
          done++;
          opts.onProgress?.({ done, total: parts.length, bytes });
          lastError = undefined;
          break;
        } catch (e) {
          lastError = e;
          if (opts.signal?.aborted) throw e;
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
      if (lastError) throw lastError;
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length));
  await Promise.all(Array.from({ length: n }, worker));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Writes the downloaded parts into one MP4. Returns its duration in seconds.
 * Yields between segments so the app stays responsive while it works.
 */
export async function assemble(
  plan: StreamPlan,
  store: PartStore,
  sink: OutputSink,
  onProgress?: (fraction: number) => void
): Promise<number> {
  const writer = new FlatMp4Writer(sink);
  const longest = Math.max(...plan.streams.map((s) => s.segments.length));

  if (plan.format === 'ts') {
    const [main] = plan.streams;
    const tm = new TsToFmp4();
    for (let i = 0; i < main.segments.length; i++) {
      for (const out of tm.push(store.read(main.segments[i].name))) {
        writer.addInit('main', out.init);
        writer.addFragments('main', out.data);
      }
      onProgress?.((i + 1) / longest);
      await tick();
    }
  } else {
    for (const s of plan.streams) {
      if (!s.init) throw new Error('Stream is missing its init section');
      writer.addInit(s.stream, store.read(s.init.name));
    }
    // Interleave the streams segment by segment so audio and video stay close together in the file.
    for (let i = 0; i < longest; i++) {
      for (const s of plan.streams) {
        if (i < s.segments.length) writer.addFragments(s.stream, store.read(s.segments[i].name));
      }
      onProgress?.((i + 1) / longest);
      await tick();
    }
  }
  return writer.finish();
}
