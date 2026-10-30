/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSubtitles, planStream } from '../lib/hls-download';
import { cueTextAt, joinVtt, parseCues, subtitleFileName } from '../lib/subtitles';

const VTT = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

NOTE a comment --> with an arrow-like thing is still a note

1
00:00:01.000 --> 00:00:03.500 align:center line:90%
<i>Hello</i> &amp; welcome

00:00:03.000 --> 00:00:04.000
Overlap

00:01:05.25 --> 00:01:06.000
{\\an8}Short fraction
`;

const SRT = `1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst line\r\nsecond line\r\n\r\n2\r\n00:00:05,500 --> 00:00:04,000\r\nbackwards, skipped\r\n`;

test('reads WebVTT cues, cleaning tags', () => {
  const cues = parseCues(VTT);
  assert.deepEqual(
    cues.map((c) => [c.start, c.end, c.text]),
    [
      [1, 3.5, 'Hello & welcome'],
      [3, 4, 'Overlap'],
      [65.25, 66, 'Short fraction'],
    ]
  );
});

test('reads SRT cues and skips broken ones', () => {
  assert.deepEqual(parseCues(SRT), [{ start: 1, end: 2, text: 'First line\nsecond line' }]);
  assert.deepEqual(parseCues('not subtitles at all'), []);
  assert.deepEqual(parseCues(''), []);
});

test('finds the text on screen, overlaps included', () => {
  const cues = parseCues(VTT);
  assert.equal(cueTextAt(cues, 0.5), '');
  assert.equal(cueTextAt(cues, 1), 'Hello & welcome');
  assert.equal(cueTextAt(cues, 3.2), 'Hello & welcome\nOverlap');
  assert.equal(cueTextAt(cues, 3.5), 'Overlap');
  assert.equal(cueTextAt(cues, 10), '');
  assert.equal(cueTextAt(cues, 65.5), 'Short fraction');
  assert.equal(cueTextAt([], 1), '');
});

test('joins pieces into one file, dropping repeats, and it reads back the same', () => {
  const a = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:09.000 --> 00:00:11.000\nEdge\n';
  const b = 'WEBVTT\n\n00:00:09.000 --> 00:00:11.000\nEdge\n\n01:00:00.000 --> 01:00:01.000\nLate\n';
  const joined = joinVtt([b, a]);
  assert.ok(joined.startsWith('WEBVTT\n'));
  assert.deepEqual(
    parseCues(joined).map((c) => c.text),
    ['One', 'Edge', 'Late']
  );
  assert.equal(parseCues(joined)[2].start, 3600);
});

test('subtitle files sit next to their video', () => {
  assert.equal(subtitleFileName('12.mp4'), '12.vtt');
});

test('a stream plan picks English subtitles and they load in full', async () => {
  const files: Record<string, string> = {
    'https://cdn.test/master.m3u8': `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="es",NAME="Español",URI="sub/es.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="en",NAME="English",URI="sub/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,SUBTITLES="s"
720.m3u8
`,
    'https://cdn.test/720.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n#EXT-X-ENDLIST\n',
    'https://cdn.test/sub/en.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nen1.vtt\n#EXTINF:600,\nen2.vtt\n#EXT-X-ENDLIST\n',
    'https://cdn.test/sub/en1.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPart one\n',
    'https://cdn.test/sub/en2.vtt': 'WEBVTT\n\n00:10:01.000 --> 00:10:02.000\nPart two\n',
  };
  const fetchText = async (url: string) => {
    if (!(url in files)) throw new Error(`404 ${url}`);
    return files[url];
  };
  const plan = await planStream('https://cdn.test/master.m3u8', fetchText);
  assert.equal(plan.subtitle?.language, 'en');
  const vtt = await loadSubtitles(plan.subtitle!, fetchText);
  assert.deepEqual(
    parseCues(vtt).map((c) => c.text),
    ['Part one', 'Part two']
  );

  delete files['https://cdn.test/sub/en.m3u8'];
  files['https://cdn.test/master.m3u8'] = files['https://cdn.test/master.m3u8'].replace(/^.*LANGUAGE="en".*\n/m, '');
  assert.equal((await planStream('https://cdn.test/master.m3u8', fetchText)).subtitle, undefined);
});
