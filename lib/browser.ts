import { normalizeUrl } from './links';
import { URL } from './url';

/** "www.animexin.dev" -> "animexin.dev". Good enough for telling sites apart; not public-suffix aware. */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  return parts.slice(-2).join('.');
}

export function sameSite(a: string, b: string): boolean {
  try {
    return baseDomain(new URL(a).hostname) === baseDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}

/** Sites whose links lead elsewhere by design: following a result is never an ad hijack. */
const LINK_HUBS = new Set(['duckduckgo.com', 'google.com', 'bing.com']);

/**
 * Ad scripts on streaming sites send the whole page to another site, either on
 * their own or by laying invisible links over the player so a tap on Play
 * leaves the site (seen on animexin). Block every top-frame move to a different
 * site unless the user typed the address, went back/forward or reloaded, or
 * tapped a search result; the banner offers "Open anyway".
 */
export function shouldBlockNavigation(opts: {
  url: string;
  currentUrl: string | null;
  isTopFrame: boolean;
  navigationType?: string;
  userTyped: boolean;
}): boolean {
  const { url, currentUrl, isTopFrame, navigationType, userTyped } = opts;
  if (!isTopFrame || userTyped || !currentUrl) return false;
  if (!/^https?:/i.test(url)) return !/^(about|blob|data):/i.test(url); // block app-store and other scheme jumps
  // Android doesn't say how a navigation started, so it can't tell a tap from a script.
  if (navigationType === undefined) return false;
  if (navigationType === 'backforward' || navigationType === 'reload') return false;
  if (sameSite(url, currentUrl)) return false;
  try {
    if (navigationType === 'click' && LINK_HUBS.has(baseDomain(new URL(currentUrl).hostname))) return false;
  } catch {
    // An unparseable current address is treated like any other site.
  }
  return true;
}

/** Address bar input: a URL, or a search for anything else. */
export function addressToUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed) || !trimmed.includes('.')) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }
  return normalizeUrl(trimmed);
}
