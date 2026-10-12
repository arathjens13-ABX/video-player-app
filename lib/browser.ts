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

/**
 * Ad scripts on streaming sites love to redirect the whole page to another site
 * without the user tapping anything. Block top-frame navigations to a different
 * site unless the user tapped a link or typed the address.
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
  if (navigationType !== 'other') return false; // clicks, back/forward, reloads, form posts are the user's
  return !sameSite(url, currentUrl);
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
