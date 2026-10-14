/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDetectorMessage } from '../lib/detector-messages';

test('accepts well-formed detector messages', () => {
  assert.deepEqual(parseDetectorMessage(JSON.stringify({ type: 'media', url: 'https://a/b.m3u8', kind: 'hls', via: 'xhr', frame: 'https://p/' })), {
    type: 'media',
    url: 'https://a/b.m3u8',
    kind: 'hls',
    via: 'xhr',
    frame: 'https://p/',
  });
  assert.deepEqual(parseDetectorMessage(JSON.stringify({ type: 'page', title: '', url: 'https://p/' })), { type: 'page', title: '', url: 'https://p/' });
});

test('ignores anything else a page might post', () => {
  for (const data of ['null', '42', '"hi"', 'not json', '{}', '{"type":"servers"}', '{"type":"media","url":"x"}', '{"type":"media","url":"x","kind":"exe","frame":"f"}']) {
    const r = parseDetectorMessage(data);
    assert.ok(r === null || (r.type === 'servers' && r.servers.length === 0), `should ignore ${data}`);
  }
  // Bad entries inside a server list are dropped, good ones kept.
  const r = parseDetectorMessage(JSON.stringify({ type: 'servers', servers: [null, { url: 'https://s/1', label: 'One' }, { label: 'no url' }] }));
  assert.deepEqual(r, { type: 'servers', servers: [{ url: 'https://s/1', label: 'One' }] });
});
