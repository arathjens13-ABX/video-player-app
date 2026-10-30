/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dailymotionId, dailymotionProblem, FinderSession, PER_SERVER_MS, sameServer, serverOrder } from '../lib/finder';
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
  info: { duration, qualities: heights.map((h) => ({ label: `${h}p`, url: `${h}`, height: h, bandwidth: h * 1000 })), encrypted: false, unsupportedEncryption: false, subtitles: [] },
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

test('ads are never picked; a missing server falls back to another English hardsub', () => {
  const s = new FinderSession('Hardsub English Rumble AX');
  s.onMedia(dmMaster);
  assert.equal(s.onServers(servers), null);
  assert.equal(s.settleWithoutServers(), servers[0].url);
  assert.equal(s.serverUsed, 'Hardsub English Dailymotion AX');
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

const animexin = [
  { label: 'Hardsub English Dailymotion', url: 'https://geo.dailymotion.com/player/xid0t.html?video=k4TsVtIyPsIrQSCvCTG' },
  { label: 'All Sub Player Dailymotion', url: 'https://geo.dailymotion.com/player/xid0t.html?video=k64qTb81hoc29sCvCQQ' },
  { label: 'Hardsub English Ok.ru', url: 'https://ok.ru/videoembed/123' },
  { label: 'Hardsub English Mega', url: 'https://mega.nz/embed/abc' },
  { label: 'Terabox Eng', url: 'https://terabox.com/s/abc' },
  { label: 'All Sub Player Rumble', url: 'https://rumble.com/embed/v1' },
  { label: 'Hardsub Indonesia Dailymotion', url: 'https://geo.dailymotion.com/player/xid0t.html?video=indo' },
  { label: 'Current player · geo.dailymotion.com', url: 'https://geo.dailymotion.com/player/xid0t.html?video=k4TsVtIyPsIrQSCvCTG&x' },
];
const withSubs = (duration: number, langs: string[]): ProbeResult => ({
  status: 'ok',
  kind: 'hls',
  info: { duration, qualities: [], encrypted: false, unsupportedEncryption: false, subtitles: langs.map((language) => ({ language })) },
});

test('server order: wanted, other English hardsubs, then All Sub; never cloud drives', () => {
  assert.deepEqual(
    serverOrder(animexin, 'Hardsub English Ok.ru').map((s) => s.label),
    ['Hardsub English Ok.ru', 'Hardsub English Dailymotion', 'All Sub Player Dailymotion', 'All Sub Player Rumble']
  );
  assert.deepEqual(
    serverOrder(animexin, null).map((s) => s.label),
    ['Hardsub English Dailymotion', 'Hardsub English Ok.ru', 'All Sub Player Dailymotion', 'All Sub Player Rumble']
  );
  assert.deepEqual(serverOrder([animexin[3], animexin[4], animexin[7]], null), []);
});

test('a removed upload is skipped at once; All Sub needs English subtitles', () => {
  const s = new FinderSession('Hardsub English Dailymotion', 0);
  assert.equal(s.onServers(animexin), animexin[0].url);
  const status: Record<string, ProbeResult | 'pending'> = {};
  const get = (u: string) => status[u];
  assert.equal(s.moveOn(get, 1000), null); // still has time
  s.markGone(animexin[0].url, 'removed by Dailymotion');
  assert.equal(s.moveOn(get, 1500), animexin[2].url); // Ok.ru next
  assert.equal(s.serverUsed, 'Hardsub English Ok.ru');
  assert.equal(s.moveOn(get, 1500 + PER_SERVER_MS - 1), null);
  assert.equal(s.moveOn(get, 1501 + PER_SERVER_MS), animexin[1].url); // Ok.ru timed out: All Sub Dailymotion

  // Its video checks out but only has Spanish and Thai: not picked, and the next server is tried.
  const allSub: Candidate = { url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/x9esgr0.m3u8', kind: 'hls', frame: animexin[1].url, via: 'xhr' };
  assert.equal(s.onMedia(allSub), true);
  status[allSub.url] = withSubs(1261, ['es', 'th']);
  assert.equal(s.pick(get, 50_000, 0), null);
  assert.equal(s.moveOn(get, 50_000), animexin[5].url);

  // Rumble's All Sub has English: that one is taken.
  const rumble: Candidate = { url: 'https://rumble.com/hls/v1/master.m3u8', kind: 'hls', frame: animexin[5].url, via: 'xhr' };
  s.onMedia(rumble);
  status[rumble.url] = withSubs(1261, ['es', 'en']);
  assert.equal(s.pick(get, 60_000, 0)?.candidate.url, rumble.url);
  assert.equal(s.serverUsed, 'All Sub Player Rumble');
});

test('when every server fails, the message says what was tried', () => {
  const s = new FinderSession('Hardsub English Dailymotion', 0);
  s.onServers([animexin[0], animexin[3]]);
  s.markGone(animexin[0].url, 'removed by Dailymotion');
  assert.equal(s.moveOn(() => undefined, 10), 'none');
  assert.equal(s.failure(), 'No video found. Tried: Hardsub English Dailymotion (removed by Dailymotion)');
  assert.equal(s.moveOn(() => undefined, 10), null); // stays finished
});

test('Dailymotion ids and removed uploads', () => {
  assert.equal(dailymotionId(animexin[0].url), 'k4TsVtIyPsIrQSCvCTG');
  assert.equal(dailymotionId('https://www.dailymotion.com/embed/video/x9esgr0?autoplay=1'), 'x9esgr0');
  assert.equal(dailymotionId('https://ok.ru/videoembed/123'), null);
  assert.equal(dailymotionId('https://evil-dailymotion.com/embed/video/x1'), null);
  assert.equal(dailymotionProblem({ error: { title: 'Content rejected.', status_code: 410 } }), 'removed by Dailymotion');
  assert.equal(dailymotionProblem({ error: { title: 'Private', status_code: 403 } }), 'not playable on Dailymotion');
  assert.equal(dailymotionProblem({ id: 'x9esgr0', title: 'ep 43' }), null);
  assert.equal(dailymotionProblem(null), null);
});
