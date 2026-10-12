/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeStream, parseAttributes, parsePlaylist, pickVariant } from '../lib/hls';

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="(original)",URI="audio/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=460560,CODECS="mp4a.40.2,avc1.42001e",RESOLUTION=512x288,AUDIO="aac"
288/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,AVERAGE-BANDWIDTH=2000000,RESOLUTION=1280x720
https://cdn.test/720/index.m3u8?token=a,b
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080/index.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0000000000000000000000000000000A
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
0.m4s
#EXTINF:3.5,title
1.m4s
#EXT-X-BYTERANGE:1000@2000
#EXTINF:2.5,
2.m4s
#EXT-X-ENDLIST
`;

test('parses a master playlist with relative and absolute variants', () => {
  const p = parsePlaylist(MASTER, 'https://cdn.test/hls/master.m3u8');
  assert.equal(p.type, 'master');
  if (p.type !== 'master') return;
  assert.equal(p.variants.length, 3);
  assert.equal(p.variants[0].url, 'https://cdn.test/hls/288/index.m3u8');
  assert.equal(p.variants[1].url, 'https://cdn.test/720/index.m3u8?token=a,b');
  assert.equal(p.variants[1].bandwidth, 2000000);
  assert.equal(pickVariant(p.variants)?.height, 1080);
  assert.equal(pickVariant(p.variants, 720)?.height, 720);
  assert.equal(pickVariant(p.variants, 100)?.height, 288);
});

test('parses a media playlist with keys, maps and byte ranges', () => {
  const p = parsePlaylist(MEDIA.replace(/\n/g, '\r\n'), 'https://cdn.test/hls/720/index.m3u8');
  assert.equal(p.type, 'media');
  if (p.type !== 'media') return;
  assert.equal(p.segments.length, 3);
  assert.equal(p.duration, 10);
  assert.equal(p.ended, true);
  assert.equal(p.segments[0].url, 'https://cdn.test/hls/720/0.m4s');
  assert.equal(p.segments[0].sequence, 7);
  assert.equal(p.segments[2].sequence, 9);
  assert.equal(p.segments[0].key?.method, 'AES-128');
  assert.equal(p.segments[0].key?.url, 'https://cdn.test/hls/720/key.bin');
  assert.equal(p.segments[0].map?.url, 'https://cdn.test/hls/720/init.mp4');
  assert.equal(p.segments[2].byterange, '1000@2000');
  assert.equal(p.segments[1].byterange, undefined);
});

test('rejects things that are not playlists', () => {
  assert.throws(() => parsePlaylist('<?xml version="1.0"?><vmap:VMAP>', 'https://x/'));
  assert.throws(() => parsePlaylist('', 'https://x/'));
});

test('parseAttributes keeps commas inside quotes', () => {
  assert.deepEqual(parseAttributes('BANDWIDTH=1,CODECS="mp4a.40.2,avc1.4d401f",NAME=x'), {
    BANDWIDTH: '1',
    CODECS: 'mp4a.40.2,avc1.4d401f',
    NAME: 'x',
  });
});

test('describeStream follows the master to the best variant', async () => {
  const files: Record<string, string> = {
    'https://cdn.test/hls/master.m3u8': MASTER,
    'https://cdn.test/hls/1080/index.m3u8': MEDIA,
  };
  const info = await describeStream('https://cdn.test/hls/master.m3u8', async (u) => {
    if (!(u in files)) throw new Error('unexpected fetch ' + u);
    return files[u];
  });
  assert.equal(info.duration, 10);
  assert.deepEqual(info.qualities.map((q) => q.label), ['1080p', '720p', '288p']);
  assert.equal(info.encrypted, true);
  assert.equal(info.unsupportedEncryption, false);
});

test('flags SAMPLE-AES as unsupported', async () => {
  const drm = MEDIA.replace('METHOD=AES-128', 'METHOD=SAMPLE-AES');
  const info = await describeStream('https://x/a.m3u8', async () => drm);
  assert.equal(info.unsupportedEncryption, true);
});
