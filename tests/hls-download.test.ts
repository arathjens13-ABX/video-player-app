/// <reference types="node" />
/**
 * End-to-end stream downloads against small HLS fixtures made with ffmpeg
 * (tests/fixtures): an AES-128 encrypted MPEG-TS stream, and an fMP4 stream
 * with audio in a separate rendition (the Dailymotion layout). The output is
 * checked with ffprobe and fully decoded with ffmpeg.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { allParts, assemble, downloadParts, partsSize, planFingerprint, planStream, type FetchBytes } from '../lib/hls-download';
import { readBoxes } from '../lib/mp4/boxes';
import { DirStore, FileSink } from './support/node-io';

const FIXTURES = path.join(__dirname, 'fixtures');
const BASE = 'https://cdn.test/';
const hasFfmpeg = spawnSync('ffprobe', ['-version']).status === 0;

function fixtureFetch(opts: { fail?: (url: string) => boolean; transform?: (url: string, b: Uint8Array) => Uint8Array } = {}) {
  const calls: string[] = [];
  const fetchBytes: FetchBytes = async (url, headers, signal) => {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    calls.push(url);
    if (opts.fail?.(url)) throw new Error('network down');
    const file = path.join(FIXTURES, new URL(url).pathname);
    if (!fs.existsSync(file)) throw new Error('HTTP 404');
    let bytes = new Uint8Array(fs.readFileSync(file));
    const range = headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
    if (range) bytes = bytes.slice(Number(range[1]), Number(range[2]) + 1);
    return opts.transform ? opts.transform(url, bytes) : bytes;
  };
  const fetchText = async (url: string) => new TextDecoder().decode(await fetchBytes(url, {}));
  return { fetchBytes, fetchText, calls };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vidstash-'));
}

function probe(file: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,start_time,duration', '-of', 'json', file]);
  return JSON.parse(r.stdout.toString()).streams as { codec_type: string; codec_name: string; start_time: string; duration: string }[];
}

/** Frames a player actually shows (edit lists applied), counted by decoding. */
function shownFrames(file: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]);
  return Number(r.stdout.toString().trim());
}

function decodesCleanly(file: string) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  return r.status === 0 && r.stderr.toString().trim() === '';
}

async function download(url: string, io = fixtureFetch()) {
  const dir = tempDir();
  const plan = await planStream(url, io.fetchText);
  const store = new DirStore(path.join(dir, 'parts'));
  await downloadParts(plan, store, io.fetchBytes, {}, { concurrency: 3 });
  const out = path.join(dir, 'out.mp4');
  const sink = new FileSink(out);
  const duration = await assemble(plan, store, sink);
  sink.close();
  return { plan, out, duration, dir };
}

test('encrypted MPEG-TS stream becomes a playable MP4', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { plan, out, duration } = await download(BASE + 'ts-aes/index.m3u8');
  assert.equal(plan.format, 'ts');
  assert.equal(plan.streams.length, 1);
  assert.ok(Math.abs(duration - 6) < 0.2, `duration ${duration}`);
  const streams = probe(out);
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  for (const s of streams) assert.ok(Math.abs(Number(s.duration) - 6) < 0.2, `${s.codec_type} duration ${s.duration}`);
  assert.ok(decodesCleanly(out));
  assert.equal(shownFrames(out), 150); // 6 s at 25 fps: none cut off by the edit list
});

test('fMP4 stream with separate audio is combined in sync', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { plan, out, duration } = await download(BASE + 'fmp4-split/master.m3u8');
  assert.equal(plan.format, 'fmp4');
  assert.deepEqual(plan.streams.map((s) => s.stream), ['video', 'audio']);
  assert.ok(Math.abs(duration - 6) < 0.2, `duration ${duration}`);
  const streams = probe(out);
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  // ffmpeg wrote both renditions starting at 0; the output must keep them aligned.
  for (const s of streams) assert.ok(Math.abs(Number(s.start_time)) < 0.03, `${s.codec_type} starts at ${s.start_time}`);
  assert.ok(decodesCleanly(out));
  assert.equal(shownFrames(out), 150);
});

test('byte-range streams (one file, pieces as ranges) work', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { plan, out, duration } = await download(BASE + 'ts-ranges/index.m3u8');
  assert.deepEqual(
    plan.streams[0].segments.map((p) => p.range),
    [
      { offset: 0, length: 50008 },
      { offset: 50008, length: 51136 },
      { offset: 101144, length: 50948 },
    ]
  );
  assert.ok(Math.abs(duration - 6) < 0.2, `duration ${duration}`);
  assert.deepEqual(probe(out).map((s) => s.codec_type).sort(), ['audio', 'video']);
  assert.ok(decodesCleanly(out));
});

test('streams that switch format midway are refused rather than saved broken', async () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init-a.mp4"',
    '#EXTINF:2,',
    'a0.m4s',
    '#EXT-X-DISCONTINUITY',
    '#EXT-X-MAP:URI="init-ad.mp4"',
    '#EXTINF:2,',
    'ad0.m4s',
    '#EXT-X-ENDLIST',
  ].join('\n');
  await assert.rejects(planStream('https://x/a.m3u8', async () => playlist), /changes format/);
});

test('an interrupted download resumes without refetching finished pieces', async () => {
  const url = BASE + 'fmp4-split/master.m3u8';
  const dir = tempDir();
  const store = new DirStore(dir);
  const broken = fixtureFetch({ fail: (u) => u.endsWith('video/seg2.m4s') });
  const plan = await planStream(url, broken.fetchText);
  await assert.rejects(downloadParts(plan, store, broken.fetchBytes, {}, { concurrency: 2 }), /network down/);
  const saved = allParts(plan).filter((p) => store.has(p.name)).length;
  assert.ok(saved > 0 && saved < allParts(plan).length);

  const good = fixtureFetch();
  await downloadParts(plan, store, good.fetchBytes, {}, { concurrency: 2 });
  assert.equal(good.calls.length, allParts(plan).length - saved);
  assert.ok(allParts(plan).every((p) => store.has(p.name)));
});

test('pausing stops the download', async () => {
  const io = fixtureFetch();
  const plan = await planStream(BASE + 'ts-aes/index.m3u8', io.fetchText);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadParts(plan, new DirStore(tempDir()), io.fetchBytes, {}, { signal: controller.signal }),
    (e: Error) => e.name === 'AbortError'
  );
});

test('error pages served instead of pieces are rejected, not saved', async () => {
  const html = new TextEncoder().encode('<html><body>403 Forbidden</body></html>');
  const io = fixtureFetch({ transform: (u, b) => (u.endsWith('seg1.m4s') ? html : b) });
  const plan = await planStream(BASE + 'fmp4-split/master.m3u8', io.fetchText);
  const store = new DirStore(tempDir());
  await assert.rejects(downloadParts(plan, store, io.fetchBytes, {}, { concurrency: 1 }), /isn’t video/);
  assert.ok(!store.has('video-1') && !store.has('audio-1'));
});

test('a wrong decryption key is reported', async () => {
  const io = fixtureFetch({ transform: (u, b) => (u.endsWith('key.bin') ? new Uint8Array(16).fill(7) : b) });
  const plan = await planStream(BASE + 'ts-aes/index.m3u8', io.fetchText);
  await assert.rejects(downloadParts(plan, new DirStore(tempDir()), io.fetchBytes, {}, { concurrency: 1 }), /decrypted|isn’t video/);
});

test('live streams and DRM are refused up front', async () => {
  const live = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\na.ts\n';
  await assert.rejects(planStream('https://x/live.m3u8', async () => live), /live stream/);
  const drm = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST\n';
  await assert.rejects(planStream('https://x/drm.m3u8', async () => drm), /DRM/);
});

test('assembly can consume parts as it goes, and stops when cancelled', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const io = fixtureFetch();
  const dir = tempDir();
  const plan = await planStream(BASE + 'fmp4-split/master.m3u8', io.fetchText);
  const store = new DirStore(path.join(dir, 'parts'));
  await downloadParts(plan, store, io.fetchBytes, {});
  assert.ok(partsSize(plan, store) > 0);
  assert.ok(plan.estimatedBytes && plan.estimatedBytes > 0);

  // Cancel partway: assembly stops, and the parts not yet used are still there.
  const controller = new AbortController();
  const sink1 = new FileSink(path.join(dir, 'a.mp4'));
  await assert.rejects(
    assemble(plan, store, sink1, { consumeParts: true, signal: controller.signal, onProgress: (f) => f > 0.3 && controller.abort() }),
    (e: Error) => e.name === 'AbortError'
  );
  sink1.close();
  const left = allParts(plan).filter((p) => store.has(p.name)).length;
  assert.ok(left > 0 && left < allParts(plan).length, `left ${left}`);

  // Resuming re-downloads what was consumed, then a full assembly leaves no parts behind.
  await downloadParts(plan, store, io.fetchBytes, {});
  const out = path.join(dir, 'b.mp4');
  const sink2 = new FileSink(out);
  await assemble(plan, store, sink2, { consumeParts: true });
  sink2.close();
  assert.equal(allParts(plan).filter((p) => store.has(p.name)).length, 0);
  assert.ok(decodesCleanly(out));
});

test('plan fingerprints ignore signed query strings but not quality or layout', async () => {
  const io = fixtureFetch();
  const a = await planStream(BASE + 'fmp4-split/master.m3u8', io.fetchText);
  const signed = await planStream(BASE + 'fmp4-split/master.m3u8', async (u) =>
    (await io.fetchText(u)).replace(/^(?!#)(\S+)$/gm, '$1?token=xyz')
  );
  assert.equal(planFingerprint(a), planFingerprint(signed));
  const ts = await planStream(BASE + 'ts-aes/index.m3u8', io.fetchText);
  assert.notEqual(planFingerprint(a), planFingerprint(ts));
});

test('a piece that keeps failing stops the whole download cleanly', async () => {
  const slow = fixtureFetch({ fail: (u) => u.endsWith('video/seg1.m4s') });
  // The failing piece fails fast; every other request is slow, so it is still in flight when the
  // download gives up and gets cancelled. Like expo/fetch on a phone, a cancelled request fails with
  // a plain Error, not an AbortError.
  const delayed: FetchBytes = (u, h, signal) =>
    new Promise((resolve, reject) => {
      if (u.endsWith('video/seg1.m4s')) return reject(new Error('network down'));
      const timer = setTimeout(() => slow.fetchBytes(u, h, signal).then(resolve, reject), 6000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('fetch failed: Fetch request has been canceled'));
      });
    });
  const plan = await planStream(BASE + 'fmp4-split/master.m3u8', slow.fetchText);
  const base = new DirStore(tempDir());
  let writesAfterFailure = 0;
  let failedAt = 0;
  const store = {
    has: (n: string) => base.has(n),
    read: (n: string) => base.read(n),
    remove: (n: string) => base.remove(n),
    size: (n: string) => base.size(n),
    write: (n: string, b: Uint8Array) => {
      if (failedAt) writesAfterFailure++;
      base.write(n, b);
    },
  };
  const retries: string[] = [];
  await assert.rejects(
    downloadParts(plan, store, delayed, {}, { concurrency: 3, onRetry: (part, attempt) => retries.push(`${part}#${attempt}`) }),
    (e: Error) => e.message === 'network down' // the real cause, not the cancellations it triggered
  );
  failedAt = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(writesAfterFailure, 0, 'no worker may write after the download has failed');
  assert.deepEqual(
    retries.filter((r) => r.startsWith('video-1#')),
    ['video-1#1', 'video-1#2', 'video-1#3'] // 4 attempts = 3 retries, no "retry" after the last one
  );
});

test('a TS stream that switches resolution midway is refused, not saved corrupt', async () => {
  const io = fixtureFetch();
  const plan = await planStream(BASE + 'ts-switch/index.m3u8', io.fetchText);
  const store = new DirStore(tempDir());
  await downloadParts(plan, store, io.fetchBytes, {});
  const sink = new FileSink(path.join(tempDir(), 'out.mp4'));
  await assert.rejects(assemble(plan, store, sink), /changes format/);
  sink.close();
});

test('TS pieces disguised as images (fake PNG header) are unwrapped', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(120).fill(0x47 ^ 0xff)]);
  const io = fixtureFetch({
    transform: (u, b) => (u.endsWith('.ts') ? new Uint8Array([...png, ...b]) : b),
  });
  const { out } = await download(BASE + 'ts-ranges/index.m3u8', io);
  assert.ok(decodesCleanly(out));
  assert.equal(shownFrames(out), 150);
});

test('a gap between fragments is followed, keeping tracks on the source timeline', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  // Shift the audio's last fragment 0.5 s later, as a stream with a small gap would be.
  const shift = (u: string, b: Uint8Array) => {
    if (!u.endsWith('audio/seg3.m4s')) return b;
    const copy = b.slice();
    const moof = readBoxes(copy).find((x) => x.type === 'moof')!;
    const tfdt = readBoxes(copy, readBoxes(copy, moof.dataStart, moof.end).find((x) => x.type === 'traf')!.dataStart, moof.end).find(
      (x) => x.type === 'tfdt'
    )!;
    const v1 = copy[tfdt.dataStart] === 1;
    const o = tfdt.dataStart + (v1 ? 8 : 4); // low 32 bits
    const value = ((copy[o] << 24) | (copy[o + 1] << 16) | (copy[o + 2] << 8) | copy[o + 3]) >>> 0;
    const next = value + 24000; // 0.5 s at 48 kHz
    copy[o] = next >>> 24;
    copy[o + 1] = (next >>> 16) & 255;
    copy[o + 2] = (next >>> 8) & 255;
    copy[o + 3] = next & 255;
    return copy;
  };
  const { out } = await download(BASE + 'fmp4-split/master.m3u8', fixtureFetch({ transform: shift }));
  const audio = probe(out).find((s) => s.codec_type === 'audio')!;
  assert.ok(Math.abs(Number(audio.duration) - 6.52) < 0.05, `audio duration ${audio.duration}`);
  assert.ok(decodesCleanly(out));
});
