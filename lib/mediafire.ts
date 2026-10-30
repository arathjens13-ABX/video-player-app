/**
 * MediaFire file pages ("mediafire.com/file/<key>/<name>/file"): AnimeXin-style
 * sites list them under an episode's downloads. The page carries the direct
 * link to the file, so the video downloads like any other MP4.
 */
import { withTimeout } from './http';
import { URL } from './url';

export type MediafireFile = { url: string; fileName: string | null; sizeText: string | null };

const MAX_PAGE_CHARS = 2_000_000;

/** Whether a link is a MediaFire file page (not a folder or the home page). */
export function isMediafirePage(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)mediafire\.com$/i.test(u.hostname) && /^\/(file|file_premium|view)\/[a-z0-9]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The page's Download button tag. */
function downloadButton(html: string): string | undefined {
  // Whole <a …> tags, quotes respected: attribute values (onclick code) can contain ">".
  const tags = html.match(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  return tags.find((t) => /\bid="downloadButton"/i.test(t)) ?? tags.find((t) => /aria-label="Download file"/i.test(t));
}

/**
 * Where the button leads when it isn't the file itself: on phones MediaFire
 * first sends you to the same page with a one-time key ("…/file?dkey=…"),
 * and that page has the direct link.
 */
export function nextMediafirePage(html: string, pageUrl: string): string | null {
  const href = downloadButton(html)?.match(/\bhref="([^"]+)"/i)?.[1];
  if (!href) return null;
  try {
    const next = new URL(decodeEntities(href), pageUrl).toString();
    return isMediafirePage(next) && next !== pageUrl ? next : null;
  } catch {
    return null;
  }
}

/** The direct file link, name and size from a MediaFire file page; null if the page has none (removed, private…). */
export function parseMediafirePage(html: string): MediafireFile | null {
  const button = downloadButton(html);
  const href = button?.match(/\bhref="([^"]+)"/i)?.[1];
  let url: string | null = href ? decodeEntities(href) : null;
  // Some pages scramble the link into base64 for scripts to unpack.
  const scrambled = button?.match(/\bdata-scrambled-url="([^"]+)"/i)?.[1];
  if ((!url || !/^https:/i.test(url)) && scrambled) {
    try {
      url = atob(scrambled);
    } catch {
      url = null;
    }
  }
  if (!url || !isDirectLink(url)) return null;
  const fileName = html.match(/<div class="filename">([^<]+)<\/div>/i)?.[1]?.trim() ?? null;
  const sizeText = html.match(/File size:\s*<span>([^<]+)<\/span>/i)?.[1]?.trim() ?? null;
  return { url, fileName: fileName && decodeEntities(fileName), sizeText };
}

/** MediaFire's file servers: download1234.mediafire.com. */
function isDirectLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^download\d*\.mediafire\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function loadPage(url: string, userAgent: string, referer?: string): Promise<string> {
  return withTimeout(20_000, async (signal) => {
    const headers: Record<string, string> = { 'User-Agent': userAgent, Accept: 'text/html' };
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { headers, signal });
    if (res.status === 404) throw new Error('This MediaFire file no longer exists');
    if (!res.ok) throw new Error(`MediaFire answered ${res.status}`);
    const text = await res.text();
    return text.slice(0, MAX_PAGE_CHARS);
  });
}

/** Opens a MediaFire file page (and the one step phones get after it) and returns its direct link. */
export async function resolveMediafire(pageUrl: string, userAgent: string): Promise<MediafireFile> {
  let url = pageUrl;
  let html = await loadPage(url, userAgent);
  let file = parseMediafirePage(html);
  const next = file ? null : nextMediafirePage(html, url);
  if (next) {
    html = await loadPage(next, userAgent, url);
    url = next;
    file = parseMediafirePage(html);
  }
  if (!file) throw new Error('This MediaFire page has no download (the file may have been removed)');
  return file;
}

/** "171.4MB" -> bytes (MediaFire's sizes are decimal-ish; close enough for space checks). */
export function parseSizeText(text: string | null): number | null {
  const m = text?.match(/^([\d.]+)\s*(KB|MB|GB)$/i);
  if (!m) return null;
  const unit = { KB: 1e3, MB: 1e6, GB: 1e9 }[m[2].toUpperCase() as 'KB' | 'MB' | 'GB'];
  return Math.round(Number(m[1]) * unit);
}
