/**
 * Fetches and reads site pages for Discover and followed shows. Plain HTTP (no
 * hidden browser): fast, and works from a background check. Results are
 * cached briefly so moving between screens doesn't refetch.
 */
import { withTimeout } from '../http';
import { logWarn, shortUrl } from '../log';
import { USER_AGENT } from '../ua';
import { isChallenge, parseHome, parseList, parseSchedule, parseSeries, seriesLinkOf, type Card, type ScheduleDay, type Section, type Series } from './parse';
import { ongoingUrl, scheduleUrl, searchUrl, siteForUrl, type Site } from './sites';

const MAX_PAGE_CHARS = 8_000_000;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; html: string }>();

export class SiteError extends Error {}

/** A page's HTML. `fresh` skips the cache (pull to refresh, follow checks). */
export async function fetchPage(url: string, { fresh = false } = {}): Promise<string> {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.html;
  const html = await withTimeout(20_000, async (signal) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
      signal,
    });
    if (!res.ok) throw new SiteError(`The site answered ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_PAGE_CHARS) throw new SiteError('The page is unexpectedly large');
    const text = await res.text();
    if (text.length > MAX_PAGE_CHARS) throw new SiteError('The page is unexpectedly large');
    return text;
  }).catch((e: unknown) => {
    logWarn('catalog', `couldn't load ${shortUrl(url)}:`, e);
    throw e instanceof SiteError ? e : new SiteError(e instanceof Error && e.name === 'TimeoutError' ? 'The site took too long to answer' : 'Couldn’t reach the site. Check your connection.');
  });
  if (isChallenge(html)) throw new SiteError('The site is checking for bots right now. Open it once in the Browser tab, then try again.');
  cache.set(url, { at: Date.now(), html });
  return html;
}

export async function loadHome(site: Site, fresh = false): Promise<Section[]> {
  return parseHome(await fetchPage(site.base, { fresh }), site.base);
}

export async function search(site: Site, query: string, page = 1): Promise<{ cards: Card[]; hasMore: boolean }> {
  return parseList(await fetchPage(searchUrl(site, query, page)), site.base);
}

export async function loadOngoing(site: Site, page = 1, fresh = false): Promise<{ cards: Card[]; hasMore: boolean }> {
  return parseList(await fetchPage(ongoingUrl(site, page), { fresh }), site.base);
}

export async function loadSchedule(site: Site): Promise<ScheduleDay[]> {
  return site.schedule ? parseSchedule(await fetchPage(scheduleUrl(site)), site.base) : [];
}

export async function loadSeries(url: string, fresh = false): Promise<Series> {
  const series = parseSeries(await fetchPage(url, { fresh }), url);
  if (!series.title) throw new SiteError('This doesn’t look like a show page');
  return series;
}

/**
 * The show page for a link that may be an episode page ("Latest Release"
 * cards link to episodes): episode pages link to their show.
 */
export async function resolveSeriesUrl(url: string): Promise<string> {
  const html = await fetchPage(url);
  if (/class="eplister"/.test(html) && !/aria-label="All Episodes"/.test(html)) return url;
  return seriesLinkOf(html, url) ?? url;
}

export function isKnownSite(url: string) {
  return !!siteForUrl(url);
}
