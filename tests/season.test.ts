/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { howManyFit, inRange, listedNumber, presets, seasonEpisodes, sizeAtQuality } from '../lib/season';

// As animexin lists them: newest first.
const list = [32, 31, 30, 3, 2, 1].map((n) => ({
  url: `https://animexin.dev/tales-of-demons-and-gods-season-10-episode-${n}-${432 + n}-indonesia-english-sub/`,
  num: `${n} [${432 + n}]`,
  title: `Tales of Demons and Gods Season 10 Episode ${n} [${432 + n}] Subtitle`,
}));

test('listed numbers use the season count, not the running total', () => {
  assert.equal(listedNumber('32 [464]'), 32);
  assert.equal(listedNumber('Special'), null);
  assert.equal(listedNumber('12.5'), 12.5);
});

test('season episodes come out in watching order with Library names', () => {
  const eps = seasonEpisodes(list);
  assert.deepEqual(eps.map((e) => e.number), [1, 2, 3, 30, 31, 32]);
  assert.equal(eps[0].show, 'Tales Of Demons And Gods Season 10');
  assert.equal(eps[0].name, 'Episode 1');
});

test('episode pages without a number column fall back to the title', () => {
  const eps = seasonEpisodes([{ url: 'https://x/ep-7/', num: '', title: 'Soul Land 2 Episode 7 Indonesia, English Sub' }]);
  assert.equal(eps[0].number, 7);
  assert.equal(eps[0].show, 'Soul Land 2');
});

test('presets continue after what you have', () => {
  const eps = seasonEpisodes(list);
  const p = presets(eps, new Set([1, 2]), 3)!;
  assert.deepEqual(p.next, { from: 3, to: 31 });
  assert.deepEqual(p.latest, { from: 30, to: 32 });
  assert.deepEqual(p.all, { from: 1, to: 32 });
  assert.equal(p.highestHave, 2);
  assert.deepEqual(presets(eps, new Set(), 2)!.next, { from: 1, to: 2 });
  assert.equal(presets(eps, new Set([32]), 2)!.next, null);
  assert.deepEqual(inRange(eps, { from: 31, to: 2 }).map((e) => e.number), [2, 3, 30, 31]);
});

test('size at a quality cap and how many fit above the floor', () => {
  const info = {
    duration: 961,
    qualities: [
      { label: '1080p', url: 'a', height: 1080, bandwidth: 4_000_000 },
      { label: '720p', url: 'b', height: 720, bandwidth: 2_000_000 },
      { label: '288p', url: 'c', height: 288, bandwidth: 400_000 },
    ],
    encrypted: false,
    unsupportedEncryption: false,
    subtitles: [],
  };
  assert.equal(sizeAtQuality(info, 720), (2_000_000 * 961) / 8);
  assert.equal(sizeAtQuality(info, 1080), (4_000_000 * 961) / 8);
  assert.equal(sizeAtQuality(info, 144), (400_000 * 961) / 8); // nothing that small: the lowest
  assert.equal(sizeAtQuality({ ...info, qualities: [] }, 720), null);
  assert.equal(howManyFit(93e9, 250e6), 292);
  assert.equal(howManyFit(21e9, 250e6), 4);
  assert.equal(howManyFit(19e9, 250e6), 0);
});
