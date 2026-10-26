/**
 * Show posters, taken from the page an episode was downloaded from and kept on
 * the phone so the Library shows them offline. One per show name (so each
 * season keeps its own); a series uses its latest season's.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { db, notify } from './db';
import { showKey } from './library';
import { logWarn, shortUrl } from './log';
import { USER_AGENT } from './ua';

const coversDir = new Directory(Paths.document, '.covers');
const MAX_BYTES = 5e6;

type Row = { key: string; url: string; file: string | null };

function fileName(key: string) {
  let h = 0x811c9dc5;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${h.toString(16)}.img`;
}

/** Remembers a show's poster and saves a copy (once per show, or when the site's picture changes). */
export function setShowCover(show: string, url: string | null | undefined, referer?: string | null) {
  if (!url) return;
  const key = showKey(show);
  const existing = db.getFirstSync<Row>('SELECT * FROM show_covers WHERE key = ?', key);
  if (existing?.url === url && existing.file && new File(coversDir, existing.file).exists) return;
  db.runSync('INSERT OR REPLACE INTO show_covers (key, url, file) VALUES (?, ?, ?)', key, url, existing?.file ?? null);
  saveCover(key, url, referer).catch((e: unknown) => logWarn('covers', `couldn't save ${shortUrl(url)}:`, e));
}

async function saveCover(key: string, url: string, referer?: string | null) {
  // As the page's own <img> would ask: without the Referer, Cloudflare-fronted sites answer with a challenge page.
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`Not an image (${type || 'unknown type'})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`Unexpected size (${bytes.length} bytes)`);
  coversDir.create({ idempotent: true, intermediates: true });
  const name = fileName(key);
  const file = new File(coversDir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  db.runSync('UPDATE show_covers SET file = ? WHERE key = ?', name, key);
  notify();
}

/** The saved poster for the first of these show names that has one, as a file URI. */
export function coverFor(shows: string[]): string | null {
  for (const show of shows) {
    const row = db.getFirstSync<Row>('SELECT * FROM show_covers WHERE key = ?', showKey(show));
    if (row?.file) {
      const file = new File(coversDir, row.file);
      if (file.exists) return file.uri;
    }
  }
  return null;
}

/** Moves a poster along when a show is renamed (a merge keeps the target's own poster if it has one). */
export function renameShowCover(from: string, to: string) {
  const a = showKey(from);
  const b = showKey(to);
  if (a === b) return;
  const target = db.getFirstSync<Row>('SELECT * FROM show_covers WHERE key = ?', b);
  if (target) db.runSync('DELETE FROM show_covers WHERE key = ?', a);
  else db.runSync('UPDATE show_covers SET key = ? WHERE key = ?', b, a);
}
