/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sniffVideo } from '../lib/sniff';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

test('accepts MP4, WebM and TS', () => {
  assert.equal(sniffVideo(bytes('\0\0\0\x20ftypisom\0\0\x02\0')).ok, true);
  assert.equal(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2])).ok, true);
  assert.equal(sniffVideo(new Uint8Array([0x47, 0x40, 0, 0x10])).ok, true);
});

test('rejects HTML, JSON, playlists and empty files', () => {
  assert.equal(sniffVideo(bytes('<!DOCTYPE html><html>Just a moment...')).ok, false);
  assert.equal(sniffVideo(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('  \n<html>')])).ok, false);
  assert.equal(sniffVideo(bytes('{"error":"forbidden"}')).ok, false);
  assert.equal(sniffVideo(bytes('#EXTM3U\n#EXT-X-VERSION:3')).ok, false);
  assert.equal(sniffVideo(new Uint8Array()).ok, false);
});

test('lets unknown binary formats through', () => {
  assert.equal(sniffVideo(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8])).ok, true);
});
