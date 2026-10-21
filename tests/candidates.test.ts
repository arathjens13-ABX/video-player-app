/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimatedSize, groupVideos, sourceLabel } from '../lib/candidates';
import type { Candidate, ProbeResult } from '../lib/probe';

const dm = 'https://geo.dailymotion.com/player/x.html?video=abc';
const cand = (url: string, frame = dm): Candidate => ({ url, kind: url.includes('.mp4') ? 'file' : 'hls', frame, via: 'fetch' });
const stream = (duration: number, heights: number[] = []): ProbeResult => ({
  status: 'ok',
  kind: 'hls',
  info: {
    duration,
    qualities: heights.map((h) => ({ label: `${h}p`, url: `https://x/${h}.m3u8`, height: h, bandwidth: h * 2000 })),
    encrypted: false,
    unsupportedEncryption: false,
  },
});

test('a stream and its per-quality playlists are one video, offered by the master', () => {
  // What a Dailymotion page loaded on the phone: the master, then each quality's playlist, then an ad.
  const master = cand('https://cdndirector.dailymotion.com/cdn/manifest/video/abc.m3u8');
  const v1 = cand('https://vod3.cf.dmcdn.net/sec/abc/h264_720/manifest.m3u8');
  const v2 = cand('https://vod3.cf.dmcdn.net/sec/abc/h264_480/manifest.m3u8');
  const ad = cand('https://ads.example/ad.m3u8', 'https://ads.example/');
  const pending = cand('https://vod3.cf.dmcdn.net/sec/abc/h264_380/manifest.m3u8');
  const results: Record<string, ProbeResult | 'pending'> = {
    [v1.url]: stream(960),
    [master.url]: stream(960.4, [720, 480, 380]),
    [v2.url]: stream(959.5),
    [ad.url]: stream(30, [720]),
    [pending.url]: 'pending',
  };
  const groups = groupVideos([v1, ad, master, v2, pending], (u) => results[u]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].best.url, master.url);
  assert.deepEqual(groups[0].copies.map((c) => c.url).sort(), [v1.url, v2.url].sort());
  // The ad comes after the episode even though it has a quality list.
  assert.equal(groups[1].best.url, ad.url);
});

test('different servers with different lengths stay separate; failed links are left out', () => {
  const a = cand('https://cdndirector.dailymotion.com/a.m3u8');
  const b = cand('https://secure.odycdn.com/b/master.m3u8', 'https://odysee.com/$/embed/x');
  const bad = cand('https://vod3.cf.dmcdn.net/frag.mp4');
  const results: Record<string, ProbeResult> = {
    [a.url]: stream(960, [720]),
    [b.url]: stream(1300, [1080]),
    [bad.url]: { status: 'invalid', reason: 'Too small to be a video (857 B)' },
  };
  const groups = groupVideos([a, b, bad], (u) => results[u]);
  assert.deepEqual(
    groups.map((g) => sourceLabel(g.best)),
    ['odysee.com', 'dailymotion.com']
  );
});

test('episode-length files rank above short streams', () => {
  const file = cand('https://cdn.x/ep.mp4', 'https://cdn.x/');
  const clip = cand('https://cdn.x/clip.m3u8', 'https://cdn.x/');
  const results: Record<string, ProbeResult> = {
    [file.url]: { status: 'ok', kind: 'file', size: 300e6, contentType: 'video/mp4' },
    [clip.url]: stream(45, [1080]),
  };
  assert.equal(groupVideos([clip, file], (u) => results[u])[0].best.url, file.url);
});

test('estimated size comes from the best quality bitrate', () => {
  const r = stream(800, [720]) as Extract<ProbeResult, { status: 'ok' }>;
  assert.equal(estimatedSize(r), (720 * 2000 * 800) / 8);
  assert.equal(estimatedSize(stream(800) as Extract<ProbeResult, { status: 'ok' }>), null);
});
