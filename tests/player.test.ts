/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextRate, offerSkipIntro, rateLabel, skipTarget, tapZone } from '../lib/player';

test('speed cycles and wraps', () => {
  assert.deepEqual([1, 1.25, 1.5, 2, 0.75].map(nextRate), [1.25, 1.5, 2, 0.75, 1]);
  assert.equal(nextRate(1.1), 1); // an odd rate restarts the cycle
  assert.equal(rateLabel(1.25), '1.25×');
  assert.equal(rateLabel(2), '2×');
});

test('taps: outer thirds skip, middle toggles', () => {
  assert.equal(tapZone(10, 800), 'back');
  assert.equal(tapZone(400, 800), 'middle');
  assert.equal(tapZone(790, 800), 'forward');
  assert.equal(tapZone(5, 0), 'middle');
});

test('skips stay inside the video', () => {
  assert.equal(skipTarget(5, -10, 900), 0);
  assert.equal(skipTarget(100, 10, 900), 110);
  assert.equal(skipTarget(895, 10, 900), 899);
  assert.equal(skipTarget(100, 90, 0), 190); // duration not known yet
});

test('skip intro shows only early in a full episode', () => {
  assert.ok(offerSkipIntro(10, 960));
  assert.ok(offerSkipIntro(100, 960)); // after a recap, the opening can start later
  assert.ok(!offerSkipIntro(1, 960));
  assert.ok(!offerSkipIntro(301, 960));
  assert.ok(!offerSkipIntro(100, 960, true)); // used once: gone for the rest of the episode
  assert.ok(!offerSkipIntro(10, 120)); // a short clip
});
