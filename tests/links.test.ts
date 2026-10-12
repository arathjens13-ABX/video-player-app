/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractUrl, guessNames, normalizeUrl } from '../lib/links';

test('guessNames reads show and episode from animexin-style URLs', () => {
  assert.deepEqual(
    guessNames('https://animexin.dev/battle-through-the-heavens-season-5-episode-140-indonesia-english-sub/'),
    { show: 'Battle Through The Heavens Season 5', title: 'Episode 140' }
  );
  assert.deepEqual(guessNames('https://cdn.example.com/v/renegade-immortal-episode-12-english-sub.mp4'), {
    show: 'Renegade Immortal',
    title: 'Episode 12',
  });
});

test('guessNames reads page titles', () => {
  assert.deepEqual(guessNames('Aliens Among Immortals Episode 60 Indonesia, English Sub - AnimeXin'), {
    show: 'Aliens Among Immortals',
    title: 'Episode 60',
  });
  assert.deepEqual(guessNames('Perfect World Ep 200'), { show: 'Perfect World', title: 'Episode 200' });
});

test('guessNames falls back to Unsorted', () => {
  assert.deepEqual(guessNames('https://h.com/files/abc123.mp4?token=1'), { show: 'Unsorted', title: 'Abc123' });
  assert.deepEqual(guessNames('https://h.com/'), { show: 'Unsorted', title: 'h.com' });
});

test('guessNames survives malformed percent-encoding', () => {
  const result = guessNames('https://h.com/show-%E0%A4%A-episode-3.mp4');
  assert.equal(result.title, 'Episode 3');
});

test('normalizeUrl adds a scheme and rejects junk', () => {
  assert.equal(normalizeUrl('animexin.dev/x'), 'https://animexin.dev/x');
  assert.equal(normalizeUrl('  https://a.b/c.mp4 '), 'https://a.b/c.mp4');
  assert.equal(normalizeUrl('hello'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
});

test('guessNames handles S/E style and ignores stray E-numbers', () => {
  assert.deepEqual(guessNames('Stellar Transformation S5 E12'), { show: 'Stellar Transformation S5', title: 'Episode 12' });
  assert.deepEqual(guessNames('https://x.com/Soul Land E02 Episode 7.mp4'), { show: 'Soul Land E02', title: 'Episode 7' });
});

test('extractUrl pulls the link out of shared text', () => {
  assert.equal(extractUrl('Watch this: https://animexin.dev/soul-land-episode-1/ so good!'), 'https://animexin.dev/soul-land-episode-1/');
  assert.equal(extractUrl('(https://a.b/c.mp4).'), 'https://a.b/c.mp4');
  assert.equal(extractUrl('animexin.dev'), 'https://animexin.dev/');
  assert.equal(extractUrl('no link here'), null);
});
