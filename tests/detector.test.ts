/// <reference types="node" />
/**
 * Runs the injected detector in headless Chromium against fake pages served
 * offline through request interception. The detector is injected into every
 * frame, like iOS does, and messages go through the same
 * window.webkit.messageHandlers path the app uses inside iframes.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

import { DETECTOR_JS, switchServerJs } from '../lib/detector';

type Msg = {
  type: string;
  series?: string;
  listUrl?: string;
  episodes?: { url: string; num: string; title: string }[];
  url?: string;
  kind?: string;
  via?: string;
  servers?: { label: string; url: string }[];
  title?: string;
  cover?: string | null;
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const SITE = `<!doctype html><html><head><title>Soul Land 2 Episode 61 Indonesia, English Sub - AnimeXin</title></head><body>
<select class="mirror">
  <option value="">Select Video Server</option>
  <option value="${b64('<iframe src="https://player.test/embed/a" allowfullscreen></iframe>')}">Hardsub English Player A</option>
  <option value="${b64('<div><iframe width="640" src="//player.test/embed/b"></iframe></div>')}">Hardsub Indonesia Player B</option>
</select>
<div class="naveps bignav"><div class="nvs nvsc"><a href='https://series.test/soul-land-2/' aria-label='All Episodes'>All Episodes</a></div></div>
<div id="pembed"><iframe src="https://player.test/embed/a" width="360" height="200"></iframe></div>
<iframe src="https://ads.test/banner" width="1" height="1"></iframe>
<script>
  var cfg = {"file":"https:\\/\\/cdn.test\\/inline\\/ep61.mp4"};
  fetch('https://stats.test/collect?title=soul%20land%20ep%2061.mp4&ref=x.mp4');
  document.getElementById('pembed').addEventListener('change', function () {});
  document.querySelector('select.mirror').addEventListener('change', function (e) {
    var html = atob(e.target.value);
    document.getElementById('pembed').innerHTML = html;
  });
</script>
</body></html>`;

const EMBED = `<!doctype html><html><body>
<div data-options='{"flashvars":{"metadata":"{\\"hlsManifestUrl\\":\\"https://cdn.test/okstyle/video.m3u8?cmd=play\\u0026expires=1\\u0026sig=abc\\"}"}}'></div>
<video id="v" src="https://cdn.test/thumbs/preview.mp4" muted></video>
<script>
  fetch('https://cdn.test/hls/master.m3u8');
  var x = new XMLHttpRequest(); x.open('GET', 'https://cdn.test/hls/720/seg-1.ts'); x.send();
  var y = new XMLHttpRequest(); y.open('GET', 'https://cdn.test/hls/720/fragment_3.mp4'); y.send();
  fetch('https://cdn.test/api/sources').then(function (r) { return r.json(); });
  fetch('https://cdn.test/noext/stream?id=1');
  var later = document.createElement('video');
  later.src = 'https://cdn.test/files/episode-61-1080p.mp4';
</script>
</body></html>`;

// Season page (animestream theme), as on animexin.dev, newest first.
const SERIES = `<!doctype html><html><head><title>Soul Land 2 - AnimeXin</title></head><body>
<div class="bigcontent"><div class="thumb" itemprop="image"><img src="/wp-content/uploads/soul-land-2.jpg" width="404" height="548"></div>
<div class="infox"><h1 class="entry-title">Soul Land 2:  The Peerless Tang Sect</h1></div></div>
<div class="eplister"><ul>
  <li data-index="0"><a href="https://site.test/soul-land-2-episode-62/"><div class="epl-num">62 [111]</div>
    <div class="epl-title">Soul Land 2 Episode 62 [111] Subtitle</div><div class="epl-date">October 19, 2026</div></a></li>
  <li data-index="1"><a href="/soul-land-2-episode-61/"><div class="epl-num">61</div>
    <div class="epl-title">Soul Land 2 Episode 61 Subtitle</div></a></li>
  <li data-index="2"><a href="/soul-land-2-episode-61/"><div class="epl-num">61</div><div class="epl-title">duplicate</div></a></li>
</ul></div>
</body></html>`;

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function openSite(address = 'https://site.test/soul-land-2-episode-61/'): Promise<{ page: Page; msgs: Msg[] }> {
  const context = await browser.newContext();
  const msgs: Msg[] = [];
  await context.exposeBinding('__vsReport', (_src, s: string) => {
    msgs.push(JSON.parse(s));
  });
  await context.addInitScript(
    'window.webkit={messageHandlers:{ReactNativeWebView:{postMessage:function(s){window.__vsReport(s)}}}};'
  );
  await context.addInitScript(DETECTOR_JS);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html', body });
    if (url.host === 'site.test') return html(SITE);
    if (url.host === 'series.test') return html(SERIES);
    if (url.host === 'player.test') return html(EMBED);
    if (url.pathname === '/api/sources') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sources: [{ src: 'https://cdn.test/api/720.mp4?token=t&e=2', label: '720p' }] }),
      });
    }
    if (url.pathname === '/noext/stream') return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
    if (url.pathname.endsWith('.m3u8')) {
      return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  await page.goto(address);
  await page.waitForTimeout(1500);
  return { page, msgs };
}

function mediaUrls(msgs: Msg[]) {
  return msgs.filter((m) => m.type === 'media').map((m) => m.url!);
}

test('finds streams and files inside the embedded player', async () => {
  const { page, msgs } = await openSite();
  const urls = mediaUrls(msgs);
  const expected = [
    'https://cdn.test/hls/master.m3u8',
    'https://cdn.test/okstyle/video.m3u8?cmd=play&expires=1&sig=abc',
    'https://cdn.test/api/720.mp4?token=t&e=2',
    'https://cdn.test/noext/stream?id=1',
    'https://cdn.test/files/episode-61-1080p.mp4',
    'https://cdn.test/inline/ep61.mp4',
  ];
  for (const url of expected) assert.ok(urls.includes(url), `missing ${url}\n got: ${urls.join('\n      ')}`);
  await page.context().close();
});

test('ignores analytics, stream segments and preview clips', async () => {
  const { page, msgs } = await openSite();
  const urls = mediaUrls(msgs);
  for (const bad of ['stats.test', 'seg-1.ts', 'fragment_3.mp4', 'preview.mp4']) {
    assert.ok(!urls.some((u) => u.includes(bad)), `should not report ${bad}`);
  }
  // Each URL is reported once.
  assert.equal(new Set(urls).size, urls.length);
  await page.context().close();
});

test('lists mirror servers and the page title', async () => {
  const { page, msgs } = await openSite();
  const servers = msgs.filter((m) => m.type === 'servers').pop()?.servers ?? [];
  assert.deepEqual(
    servers.map((s) => s.url),
    ['https://player.test/embed/a', 'https://player.test/embed/b']
  );
  assert.equal(servers[0].label, 'Hardsub English Player A');
  const title = msgs.filter((m) => m.type === 'page').pop()?.title;
  assert.match(title ?? '', /Soul Land 2 Episode 61/);
  await page.context().close();
});

test('switching server swaps the player through the site’s own picker', async () => {
  const { page } = await openSite();
  await page.evaluate(switchServerJs('https://player.test/embed/b'));
  await page.waitForTimeout(1200);
  const src = await page.$eval('#pembed iframe', (f) => (f as HTMLIFrameElement).src);
  assert.equal(src, 'https://player.test/embed/b');
  await page.context().close();
});

test('switching server falls back to replacing the player iframe', async () => {
  const { page } = await openSite();
  await page.evaluate(switchServerJs('https://player.test/embed/not-in-list'));
  await page.waitForTimeout(1200);
  const src = await page.$eval('#pembed iframe', (f) => (f as HTMLIFrameElement).src);
  assert.equal(src, 'https://player.test/embed/not-in-list');
  await page.context().close();
});

const PLAIN_MIRRORS = `<!doctype html><html><head><title>Jade Dynasty Episode 10 English Sub</title></head><body>
<select class="mirror" name="mirror" onchange="window.picked = this.value">
  <option value="">Select Video Server</option>
  <option value="https://site2.test/jade-dynasty-episode-10/v/1/">[4K] Eng [Dailymotion]</option>
  <option value="https://site2.test/jade-dynasty-episode-10/v/2/">[4K] Eng [OK.RU]</option>
</select>
<select name="sort"><option value="https://site2.test/a-very-long-sorting-link/">Newest</option></select>
<iframe src="https://t.co/abcdef" width="400" height="300"></iframe>
</body></html>`;

test('plain-URL mirror pickers are listed and t.co frames are not', async () => {
  const context = await browser.newContext();
  const msgs: Msg[] = [];
  await context.exposeBinding('__vsReport', (_src, s: string) => {
    msgs.push(JSON.parse(s));
  });
  await context.addInitScript(
    'window.webkit={messageHandlers:{ReactNativeWebView:{postMessage:function(s){window.__vsReport(s)}}}};'
  );
  await context.addInitScript(DETECTOR_JS);
  await context.route('**/*', (route) =>
    new URL(route.request().url()).host === 'site2.test'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: PLAIN_MIRRORS })
      : route.fulfill({ status: 204, body: '' })
  );
  const page = await context.newPage();
  await page.goto('https://site2.test/jade-dynasty-episode-10/');
  await page.waitForTimeout(1200);
  const servers = msgs.filter((m) => m.type === 'servers').pop()?.servers ?? [];
  assert.deepEqual(servers.map((s) => s.label), ['[4K] Eng [Dailymotion]', '[4K] Eng [OK.RU]']);

  // Switching uses the site's own picker (its onchange handler runs).
  await page.evaluate(switchServerJs('https://site2.test/jade-dynasty-episode-10/v/2/'));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => (window as unknown as { picked?: string }).picked), 'https://site2.test/jade-dynasty-episode-10/v/2/');
  await context.close();
});

test('reads a season page’s episode list', async () => {
  const { page, msgs } = await openSite('https://series.test/soul-land-2/');
  const list = msgs.filter((m) => m.type === 'episodes').pop();
  assert.equal(list?.series, 'Soul Land 2: The Peerless Tang Sect');
  assert.equal(list?.listUrl, 'https://series.test/soul-land-2/');
  assert.equal(msgs.filter((m) => m.type === 'page').pop()?.cover, 'https://series.test/wp-content/uploads/soul-land-2.jpg');
  assert.deepEqual(list?.episodes, [
    { url: 'https://site.test/soul-land-2-episode-62/', num: '62 [111]', title: 'Soul Land 2 Episode 62 [111] Subtitle' },
    { url: 'https://series.test/soul-land-2-episode-61/', num: '61', title: 'Soul Land 2 Episode 61 Subtitle' },
  ]);
  await page.context().close();
});

test('an episode page points to its season’s episode list', async () => {
  const { page, msgs } = await openSite();
  const list = msgs.filter((m) => m.type === 'episodes').pop();
  assert.equal(list?.listUrl, 'https://series.test/soul-land-2/');
  assert.equal(msgs.filter((m) => m.type === 'page').pop()?.cover, null);
  assert.deepEqual(list?.episodes, []);
  await page.context().close();
});
