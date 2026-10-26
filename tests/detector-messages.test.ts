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
  assert.deepEqual(parseDetectorMessage(JSON.stringify({ type: 'page', title: '', url: 'https://p/' })), { type: 'page', title: '', url: 'https://p/', cover: null });
  assert.equal(
    (parseDetectorMessage(JSON.stringify({ type: 'page', title: 't', url: 'https://p/', cover: 'https://p/poster.jpg' })) as { cover: string }).cover,
    'https://p/poster.jpg'
  );
  // Only web images: a page can post anything.
  assert.equal(
    (parseDetectorMessage(JSON.stringify({ type: 'page', title: 't', url: 'https://p/', cover: 'file:///etc/passwd' })) as { cover: string | null }).cover,
    null
  );
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

test('pages can only hand over web links, and episodes only from the list’s own site', () => {
  for (const url of ['file:///var/mobile/x.mp4', 'javascript:alert(1)', 'vidstash://open?url=x', 'data:video/mp4;base64,AA']) {
    assert.equal(parseDetectorMessage(JSON.stringify({ type: 'media', url, kind: 'file', frame: 'https://p/' })), null, url);
  }
  const servers = parseDetectorMessage(
    JSON.stringify({ type: 'servers', servers: [{ label: 'ok', url: 'https://a.test/e' }, { label: 'bad', url: 'file:///etc/hosts' }] })
  );
  assert.deepEqual(servers, { type: 'servers', servers: [{ label: 'ok', url: 'https://a.test/e' }] });
  const eps = parseDetectorMessage(
    JSON.stringify({
      type: 'episodes',
      series: 'S',
      listUrl: 'https://animexin.dev/show/',
      episodes: [
        { url: 'https://animexin.dev/show-episode-1/', num: '1', title: 'E1' },
        { url: 'https://www.animexin.dev/show-episode-2/', num: '2', title: 'E2' },
        { url: 'https://evil.test/x/', num: '3', title: 'E3' },
        { url: 'file:///private/var/x', num: '4', title: 'E4' },
      ],
    })
  );
  assert.deepEqual(
    eps && eps.type === 'episodes' ? eps.episodes.map((e) => e.num) : null,
    ['1', '2']
  );
  assert.equal(parseDetectorMessage(JSON.stringify({ type: 'episodes', listUrl: 'file:///x', episodes: [] })), null);
  // A flood of entries is capped.
  const many = parseDetectorMessage(
    JSON.stringify({ type: 'servers', servers: Array.from({ length: 5000 }, (_, i) => ({ label: 'x'.repeat(10000), url: `https://a.test/${i}` })) })
  );
  assert.ok(many && many.type === 'servers' && many.servers.length === 100 && many.servers[0].label.length === 200);
});
