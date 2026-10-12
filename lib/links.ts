export type LinkKind = 'mp4' | 'hls' | 'page';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)(?:$|[?#])/i;
const HLS_EXT = /\.m3u8(?:$|[?#])/i;

/** Normalizes user input into an http(s) URL, or returns null if it can't be one. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

function kindFromContentType(type: string | null): LinkKind | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes('mpegurl')) return 'hls';
  if (t.startsWith('video/')) return 'mp4';
  return null;
}

/**
 * Works out what a link points to. The extension is checked first; when that is
 * inconclusive a HEAD request asks the server for its Content-Type.
 */
export async function classifyLink(url: string, headers: Record<string, string>): Promise<LinkKind> {
  const path = new URL(url).pathname;
  if (HLS_EXT.test(path)) return 'hls';
  if (VIDEO_EXT.test(path)) return 'mp4';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: 'HEAD', headers, signal: controller.signal });
    clearTimeout(timer);
    return kindFromContentType(res.headers.get('content-type')) ?? 'page';
  } catch {
    return 'page';
  }
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Guesses a show name and episode title from a URL or page title, for example
 * ".../renegade-immortal-episode-12-subtitles.mp4" -> { show: "Renegade Immortal", title: "Episode 12" }.
 */
export function guessNames(source: string): { show: string; title: string } {
  let text = source;
  try {
    const url = new URL(source);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (!last) return { show: 'Unsorted', title: url.hostname };
    text = safeDecode(last).replace(/\.[a-z0-9]{2,4}$/i, '');
  } catch {
    // Not a URL; treat it as a page title.
  }
  text = text
    .replace(/%[0-9a-f]{0,2}/gi, ' ')
    .replace(/[-_.+]+/g, ' ')
    .replace(/\b(english|indonesian|eng|indo)?\s*sub(title)?s?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Most specific marker first, so "E0" inside other text isn't mistaken for an episode.
  const patterns = [/^(.*?)\s*\bepisode\s*(\d+)\b/i, /^(.*?)\s*\bep\s*(\d+)\b/i, /^(.*?)\s+e(\d+)\b/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1].trim()) {
      return { show: titleCase(match[1].trim()), title: `Episode ${match[2]}` };
    }
  }
  return { show: 'Unsorted', title: titleCase(text) || 'Untitled' };
}
