import './polyfill';
// Runs the stream pipeline fully in memory, so it can run in Hermes (no file system) and in Node.
import FIXTURES from './fixtures.gen.js';
import { assemble, downloadParts, planStream, type PartStore } from '../../lib/hls-download';
import type { OutputSink } from '../../lib/mp4/flatten';
import { URL } from '../../lib/url';
import { pickSubtitle, parsePlaylist } from '../../lib/hls';
import { cueTextAt, joinVtt, parseCues } from '../../lib/subtitles';
import { dailymotionId, serverOrder } from '../../lib/finder';
import { nextMediafirePage, parseMediafirePage, parseSizeText } from '../../lib/mediafire';

declare const print: ((s: string) => void) | undefined;
const log = (s: string) => (typeof print === 'function' ? print(s) : console.log(s));

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function fromB64(s: string) {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0, bits = 0, j = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (buf >> bits) & 0xff; }
  }
  return out;
}
function toB64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
function textOf(b: Uint8Array) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }

const files = FIXTURES as Record<string, string>;
const get = (url: string, headers: Record<string, string> = {}) => {
  const key = new URL(url).pathname.replace(/^\//, '');
  if (!(key in files)) throw new Error('404 ' + key);
  let b = fromB64(files[key]);
  const r = headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
  if (r) b = b.slice(Number(r[1]), Number(r[2]) + 1);
  return b;
};

class MemStore implements PartStore {
  m = new Map<string, Uint8Array>();
  has(n: string) { return this.m.has(n); }
  write(n: string, b: Uint8Array) { this.m.set(n, b); }
  read(n: string) { return this.m.get(n)!; }
  remove(n: string) { this.m.delete(n); }
  size(n: string) { return this.m.get(n)?.length ?? 0; }
}
class MemSink implements OutputSink {
  buf = new Uint8Array(1 << 20); position = 0; end = 0;
  private grow(n: number) { if (n > this.buf.length) { const b = new Uint8Array(Math.max(n, this.buf.length * 2)); b.set(this.buf); this.buf = b; } }
  write(b: Uint8Array) { this.grow(this.position + b.length); this.buf.set(b, this.position); this.position += b.length; this.end = Math.max(this.end, this.position); }
  writeAt(o: number, b: Uint8Array) { this.grow(o + b.length); this.buf.set(b, o); this.end = Math.max(this.end, o + b.length); }
  result() { return this.buf.slice(0, this.end); }
}

async function run(name: string, url: string) {
  log('step plan ' + name);
  const plan = await planStream(url, async (u) => textOf(get(u)));
  log('step download ' + name);
  const store = new MemStore();
  await downloadParts(plan, store, async (u, h) => get(u, h), {}, { concurrency: 2 });
  log('step assemble ' + name);
  const sink = new MemSink();
  const duration = await assemble(plan, store, sink, { consumeParts: true });
  const out = sink.result();
  let h = 0x811c9dc5;
  for (let i = 0; i < out.length; i++) h = Math.imul(h ^ out[i], 0x01000193) >>> 0;
  log(`RESULT ${name} bytes=${out.length} duration=${duration.toFixed(3)} fnv=${h.toString(16)} left=${store.m.size}`);
  log(`B64 ${name} ${toB64(out)}`);
}

// Subtitles and server choice use regexes and URL parsing that Hermes must handle the same way as Node.
function checkSubtitles() {
  const master = parsePlaylist(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="es",NAME="Español",URI="es.m3u8"\n' +
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="en",NAME="English",URI="en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,SUBTITLES="s"\nv.m3u8\n',
    'https://cdn.test/m.m3u8'
  );
  const pick = master.type === 'master' ? pickSubtitle(master.subtitles)?.url : 'not a master';
  const vtt = joinVtt(['WEBVTT\n\n00:00:01.000 --> 00:00:02.500 line:90%\n<i>One</i> &amp; two\n', '1\r\n00:01:00,000 --> 00:01:01,000\r\n{\\an8}Three\r\n']);
  const cues = parseCues(vtt);
  const order = serverOrder(
    [
      { label: 'Hardsub English Mega', url: 'https://mega.nz/e/1' },
      { label: 'All Sub Player Dailymotion', url: 'https://geo.dailymotion.com/player/x.html?video=k2' },
      { label: 'Hardsub English Ok.ru', url: 'https://ok.ru/videoembed/1' },
    ],
    null
  ).map((s) => s.label);
  log(`RESULT subtitles pick=${pick} cues=${cues.length} at1=${cueTextAt(cues, 1.5)} at60=${cueTextAt(cues, 60.2)} order=${order.join('|')} dm=${dailymotionId('https://geo.dailymotion.com/player/x.html?video=k2')}`);
}

function checkMediafire() {
  const page = 'https://www.mediafire.com/file/abc123/ep_1_eng.mp4/file';
  const mobile = '<a aria-label="Download file" href="//www.mediafire.com/file/abc123/ep_1_eng.mp4/file?dkey=k&amp;r=5" onclick="setTimeout(() => {f()}, 1000)" id="downloadButton">x</a>';
  const desktop = '<div class="filename">ep 1 eng.mp4</div><li>File size: <span>171.4MB</span></li><a class="input" href="https://download12.mediafire.com/k/abc123/ep_1_eng.mp4" id="downloadButton" rel="nofollow">x</a>';
  const file = parseMediafirePage(desktop);
  log(`RESULT mediafire next=${nextMediafirePage(mobile, page)} mobileFile=${parseMediafirePage(mobile)} file=${file?.url} name=${file?.fileName} size=${parseSizeText(file?.sizeText ?? null)}`);
}

(async () => {
  checkSubtitles();
  checkMediafire();
  await run('ts-aes', 'https://cdn.test/ts-aes/index.m3u8');
  await run('fmp4-split', 'https://cdn.test/fmp4-split/master.m3u8');
  await run('ts-ranges', 'https://cdn.test/ts-ranges/index.m3u8');
  log('DONE');
})().catch((e) => log('FAILED ' + e + '\n' + (e && e.stack)));
