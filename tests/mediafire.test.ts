/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isEnglishDownload, parseDownloads } from '../lib/catalog/parse';
import { isMediafirePage, nextMediafirePage, parseMediafirePage, parseSizeText } from '../lib/mediafire';

const EPISODE = readFileSync(new URL('./fixtures/sites/animexin-episode.html', import.meta.url), 'utf8');

test('reads the downloads box of an AnimeXin episode', () => {
  const links = parseDownloads(EPISODE, 'https://animexin.dev/x/');
  const mediafire = links.filter((d) => isMediafirePage(d.url));
  assert.deepEqual(
    mediafire.map((d) => [d.group, d.quality, d.host, isEnglishDownload(d)]),
    [
      ['Subtitle Indonesia', '1080', 'Mediafire', false],
      ['Subtitle English', '1080', 'Mediafire', true],
    ]
  );
  assert.equal(mediafire[1].url, 'https://www.mediafire.com/file/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4/file');
  assert.ok(links.some((d) => d.host === 'Terabox'));
  assert.deepEqual(parseDownloads('<html><body>no downloads</body></html>', 'https://a.test/'), []);
});

test('recognises MediaFire file pages', () => {
  assert.ok(isMediafirePage('https://www.mediafire.com/file/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4/file'));
  assert.ok(isMediafirePage('https://mediafire.com/file/abc123/x.mp4'));
  assert.ok(!isMediafirePage('https://www.mediafire.com/'));
  assert.ok(!isMediafirePage('https://www.mediafire.com/folder/abc123/x'));
  assert.ok(!isMediafirePage('https://evilmediafire.com/file/abc123/x.mp4'));
  assert.ok(!isMediafirePage('not a url'));
});

// Trimmed from a real file page (October 2026): the button, the name and the size.
const PAGE = `<html><body>
<div class="dl-info"><div class="filename">AX todg ep 464 eng.mp4</div>
<ul class="details"><li>File size: <span>171.4MB</span></li></ul></div>
<a class="input popsok"
   aria-label="Download file"
   href="https://download2388.mediafire.com/abcDEF123/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4"
   id="downloadButton"
   rel="nofollow">Download (171.4MB)</a>
</body></html>`;

test('takes the direct link, name and size from a file page', () => {
  assert.deepEqual(parseMediafirePage(PAGE), {
    url: 'https://download2388.mediafire.com/abcDEF123/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4',
    fileName: 'AX todg ep 464 eng.mp4',
    sizeText: '171.4MB',
  });
  const scrambled = PAGE.replace(/href="[^"]+"/, `href="javascript:void(0)" data-scrambled-url="${Buffer.from('https://download99.mediafire.com/k/f.mp4').toString('base64')}"`);
  assert.equal(parseMediafirePage(scrambled)?.url, 'https://download99.mediafire.com/k/f.mp4');
  // Only MediaFire's own file servers, over HTTPS.
  assert.equal(parseMediafirePage(PAGE.replace('https://download2388.mediafire.com', 'https://evil.test')), null);
  assert.equal(parseMediafirePage(PAGE.replace('https://download2388', 'http://download2388')), null);
  assert.equal(parseMediafirePage('<html>File removed</html>'), null);
});

test('on phones, the button leads to a second page first', () => {
  const mobile = `<a class="input popsok" aria-label="Download file" href="//www.mediafire.com/file/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4/file?dkey=abc&amp;r=502" target="_download107" onclick="setTimeout(() => {if (typeof f === 'function') f();}, 1000)" id="downloadButton" rel="nofollow"> Download in a new tab (171.4MB) </a>`;
  const page = 'https://www.mediafire.com/file/fdkqyhd19e5350v/AX_todg_ep_464_eng.mp4/file';
  assert.equal(parseMediafirePage(mobile), null);
  assert.equal(nextMediafirePage(mobile, page), `${page}?dkey=abc&r=502`);
  // Never anywhere but another MediaFire file page.
  assert.equal(nextMediafirePage(mobile.replace('//www.mediafire.com', 'https://evil.test'), page), null);
  assert.equal(nextMediafirePage(PAGE, page), null); // the desktop page links the file itself
});

test('reads MediaFire sizes', () => {
  assert.equal(parseSizeText('171.4MB'), 171_400_000);
  assert.equal(parseSizeText('1.2 GB'), 1_200_000_000);
  assert.equal(parseSizeText(null), null);
  assert.equal(parseSizeText('big'), null);
});
