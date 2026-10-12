/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { candidateKey } from '../lib/probe';

test('same stream with different tokens is one candidate', () => {
  assert.equal(
    candidateKey('https://cdndirector.dailymotion.com/cdn/manifest/video/xb6d29a.m3u8?sec=AAA'),
    candidateKey('https://cdndirector.dailymotion.com/cdn/manifest/video/xb6d29a.m3u8?sec=BBB')
  );
  assert.notEqual(
    candidateKey('https://cdndirector.dailymotion.com/cdn/manifest/video/xb6d29a.m3u8?sec=AAA'),
    candidateKey('https://cdndirector.dailymotion.com/cdn/manifest/video/zzzzzz.m3u8?sec=AAA')
  );
});

test('short generic paths keep their query (ok.ru style)', () => {
  assert.notEqual(
    candidateKey('https://vd205.okcdn.ru/video.m3u8?cmd=videoPlayerCdn&id=1'),
    candidateKey('https://vd205.okcdn.ru/video.m3u8?cmd=videoPlayerCdn&id=2')
  );
});
