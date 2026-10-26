/**
 * Followed shows: their page is checked for new episodes (when the app opens,
 * every 30 minutes while it's open, and in the background when iOS allows);
 * new ones go into the season-download queue on the show's server and quality,
 * within the free-space rule. Following doesn't download what's already out.
 */
import { addBatch, listBatch } from './batch';
import { baseDomain } from './browser';
import { loadSeries } from './catalog/client';
import type { Series } from './catalog/parse';
import { siteForUrl } from './catalog/sites';
import { setShowCover } from './covers';
import { db, listEpisodes, notify } from './db';
import { logInfo, logWarn, shortUrl } from './log';
import { freshEpisodes, type FollowCheck } from './follow-logic';
import { seasonEpisodes } from './season';
import { preferredServer } from './season-draft';
import { getStreamQuality } from './settings';
import { URL } from './url';

export type Follow = {
  id: number;
  url: string;
  site: string;
  title: string;
  /** The Library show name its episodes download under. */
  show: string;
  cover: string | null;
  server: string | null;
  maxHeight: number;
  /** Episode page URLs already known (JSON array). */
  seen: string;
  autoDownload: number;
  createdAt: number;
  checkedAt: number | null;
  lastNewAt: number | null;
  lastError: string | null;
};

/** Followed shows download at most 720p (half the space of 1080p), like season downloads. */
const FOLLOW_QUALITY = 720;

/** How often a show is checked at most, unless asked to check now. */
const RECHECK_MS = 25 * 60_000;

export function listFollows(): Follow[] {
  return db.getAllSync<Follow>('SELECT * FROM follows ORDER BY title COLLATE NOCASE');
}

export function getFollow(url: string): Follow | null {
  return db.getFirstSync<Follow>('SELECT * FROM follows WHERE url = ?', url);
}

/** The Library name a show's episodes get, the same way single and season downloads name them. */
export function libraryShowName(series: Series): string {
  const named = seasonEpisodes(series.episodes).find((e) => e.show !== 'Unsorted');
  return named?.show ?? series.title;
}

/** The server last picked on this show's site (remembered by the Browser), for its downloads. */
export function serverFor(url: string): string | null {
  try {
    return preferredServer(baseDomain(new URL(url).hostname));
  } catch {
    return null;
  }
}

export function follow(series: Series): Follow {
  const site = siteForUrl(series.url);
  const show = libraryShowName(series);
  db.runSync(
    `INSERT OR REPLACE INTO follows (url, site, title, show, cover, server, maxHeight, seen, autoDownload, createdAt, checkedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    series.url,
    site?.id ?? '',
    series.title,
    show,
    series.poster,
    serverFor(series.url),
    Math.min(getStreamQuality(), FOLLOW_QUALITY),
    JSON.stringify(series.episodes.map((e) => e.url)),
    Date.now(),
    Date.now()
  );
  setShowCover(show, series.poster, series.url);
  logInfo('follow', `following ${series.title} (${series.episodes.length} episodes known) as "${show}"`);
  notify();
  return getFollow(series.url)!;
}

export function unfollow(url: string) {
  db.runSync('DELETE FROM follows WHERE url = ?', url);
  logInfo('follow', `unfollowed ${shortUrl(url)}`);
  notify();
}

export function setAutoDownload(url: string, on: boolean) {
  db.runSync('UPDATE follows SET autoDownload = ? WHERE url = ?', on ? 1 : 0, url);
  notify();
}

/** Episodes not yet in the Library or the download queue (matched by their page). */
export function notYetDownloaded<T extends { url: string }>(episodes: T[]): T[] {
  const have = new Set<string>();
  for (const e of listEpisodes()) if (e.pageUrl && e.status !== 'error') have.add(e.pageUrl);
  for (const b of listBatch()) have.add(b.pageUrl);
  return episodes.filter((e) => !have.has(e.url));
}

export type CheckResult = FollowCheck<Follow>;

/** Checks followed shows for new episodes and queues them. Returns what was new, per show. */
export async function checkFollows({ force = false } = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const f of listFollows()) {
    if (!force && f.checkedAt && Date.now() - f.checkedAt < RECHECK_MS) continue;
    try {
      const series = await loadSeries(f.url, true);
      const { fresh, seen: allSeen } = freshEpisodes(JSON.parse(f.seen) as string[], series.episodes);
      let queued = 0;
      if (fresh.length && f.autoDownload) {
        const toGet = notYetDownloaded(fresh);
        if (toGet.length) {
          addBatch(toGet.map((e) => ({ show: f.show, title: e.name, pageUrl: e.url, server: f.server, maxHeight: f.maxHeight })));
          queued = toGet.length;
        }
      }
      db.runSync(
        'UPDATE follows SET seen = ?, checkedAt = ?, lastError = NULL, lastNewAt = COALESCE(?, lastNewAt), cover = COALESCE(?, cover) WHERE id = ?',
        JSON.stringify(allSeen),
        Date.now(),
        fresh.length ? Date.now() : null,
        series.poster,
        f.id
      );
      if (fresh.length) logInfo('follow', `${f.title}: ${fresh.length} new (${fresh.map((e) => e.name).join(', ')}), ${queued} queued`);
      results.push({ follow: f, fresh, queued });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logWarn('follow', `${f.title}: check failed:`, message);
      db.runSync('UPDATE follows SET checkedAt = ?, lastError = ? WHERE id = ?', Date.now(), message, f.id);
    }
  }
  if (results.length) notify();
  return results;
}
