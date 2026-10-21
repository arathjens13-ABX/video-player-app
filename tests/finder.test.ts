/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FinderSession, sameServer } from '../lib/finder';
import type { Candidate, ProbeResult } from '../lib/probe';

const servers = [
  { label: 'Hardsub English Dailymotion AX', url: 'https://geo.dailymotion.com/player/xhojl.html?video=abc' },
  { label: 'Hardsub English Odysee AX', url: 'https://odysee.com/$/embed/@x:1/ep?r=1' },
  { label: 'Current player · geo.dailymotion.com', url: 'https://geo.dailymotion.com/player/xhojl.html?video=abc&x' },
];
const dmMaster: Candidate = { url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/abc.m3u8?sec=1', kind: 'hls', frame: 'https://geo.dailymotion.com/player/xhojl.html', via: 'page' };
const odyMaster: Candidate = { url: 'https://secure.odycdn.com/v6/streams/abc/master.m3u8', kind: 'hls', frame: 'https://odysee.com/$/embed/@x:1/ep', via: 'fetch' };
const odyV1: Candidate = { ...odyMaster, url: 'https://secure.odycdn.com/v6/streams/abc/v1.m3u8', via: 'xhr' };
const stream = (duration: number, heights: number[] = []): ProbeResult => ({
  status: 'ok',
  kind: 'hls',
  info: { duration, qualities: heights.map((h) => ({ label: `${h}p`, url: `${h}`, height: h, bandwidth: h * 1000 })), encrypted: false, unsupportedEncryption: false },
});

test('switches to the wanted server and ignores the default player’s video', () => {
  const s = new FinderSession('hardsub english odysee AX ');
  // The page's default player (Dailymotion) reports its stream before the server list.
  assert.equal(s.onMedia(dmMaster), false);
  assert.equal(s.onServers(servers), servers[1].url);
  assert.equal(s.serverUsed, 'Hardsub English Odysee AX');
  assert.equal(s.accepted.length, 0);
  assert.equal(s.onMedia(odyV1), true);
  assert.equal(s.onMedia(odyMaster), true);
  assert.equal(s.onMedia(odyMaster), false); // reported again
  assert.equal(s.onServers(servers), null); // decided once
});

test('picks the episode once checks settle, preferring the quality choice', () => {
  const s = new FinderSession('Hardsub English Odysee AX');
  s.onServers(servers);
  s.onMedia(odyV1);
  s.onMedia(odyMaster);
  const status: Record<string, ProbeResult | 'pending'> = { [odyV1.url]: stream(1300), [odyMaster.url]: 'pending' };
  assert.equal(s.pick((u) => status[u], 1000), null); // master still checking
  status[odyMaster.url] = stream(1300, [1080, 720]);
  assert.equal(s.pick((u) => status[u], 1500)?.candidate.url, odyMaster.url);
});

test('takes what it has once the settle time passes', () => {
  const s = new FinderSession(null);
  s.onServers(servers);
  s.onMedia(odyV1);
  s.onMedia(odyMaster);
  const status: Record<string, ProbeResult | 'pending'> = { [odyV1.url]: stream(1300), [odyMaster.url]: 'pending' };
  assert.equal(s.pick((u) => status[u], 0), null);
  assert.equal(s.pick((u) => status[u], 3000)?.candidate.url, odyV1.url);
});

test('ads are never picked; a missing server falls back to the page default', () => {
  const s = new FinderSession('Hardsub English Rumble AX');
  s.onMedia(dmMaster);
  assert.equal(s.onServers(servers), null);
  s.settleWithoutServers();
  assert.equal(s.serverUsed, null);
  const ad: Candidate = { url: 'https://ads.test/ad.m3u8', kind: 'hls', frame: 'https://ads.test/', via: 'xhr' };
  s.onMedia(ad);
  const status: Record<string, ProbeResult> = { [ad.url]: stream(30, [720]) };
  assert.equal(s.pick((u) => status[u], 0, 0), null);
  status[dmMaster.url] = stream(961, [720]);
  assert.equal(s.pick((u) => status[u], 0, 0)?.candidate.url, dmMaster.url);
});

test('waits for a late server list, but not forever', () => {
  const s = new FinderSession('Hardsub English Odysee AX');
  assert.equal(s.onServers([servers[2]]), null); // only the current player so far
  assert.equal(s.onServers([]), null);
  s.onMedia(dmMaster);
  assert.equal(s.accepted.length, 0);
  s.settleWithoutServers();
  assert.deepEqual(s.accepted.map((c) => c.url), [dmMaster.url]);
});

test('a full list arriving later still switches', () => {
  const s = new FinderSession('Hardsub English Odysee AX');
  assert.equal(s.onServers([servers[2]]), null);
  assert.equal(s.onServers(servers), servers[1].url);
});

test('server names match despite tags the site adds or drops', () => {
  assert.ok(sameServer('Hardsub English Dailymotion', 'Hardsub English Dailymotion AX'));
  assert.ok(sameServer('Hardsub English Dailymotion AX', 'hardsub  english dailymotion'));
  assert.ok(!sameServer('Hardsub Indonesia Dailymotion', 'Hardsub English Dailymotion AX'));
  assert.ok(!sameServer('Hardsub English Odysee', 'Hardsub English Dailymotion'));
});
