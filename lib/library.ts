import type { Episode } from './db';

/** The episode number in a title like "Episode 12" or "Ep 12.5", if any. */
export function episodeNumber(title: string): number | null {
  const m = title.match(/\b(?:episode|ep|e)\s*(\d+(?:\.\d+)?)\b/i) ?? title.match(/(\d+(?:\.\d+)?)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}

/** Orders a show's episodes by number (numbered ones first), then by when they were added. */
export function compareEpisodes(a: Pick<Episode, 'title' | 'createdAt'>, b: Pick<Episode, 'title' | 'createdAt'>) {
  const na = episodeNumber(a.title);
  const nb = episodeNumber(b.title);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  return a.createdAt - b.createdAt;
}

/** "Renegade  immortal " and "Renegade Immortal" are the same show. */
export function showKey(show: string) {
  return show.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Downloaded episodes grouped by show (named as first added), shows A–Z, episodes in order. */
export function groupByShow<T extends Pick<Episode, 'show' | 'title' | 'createdAt' | 'status'>>(episodes: T[]) {
  const byShow = new Map<string, { title: string; data: T[] }>();
  for (const e of [...episodes].sort((a, b) => a.createdAt - b.createdAt)) {
    if (e.status !== 'done') continue;
    const key = showKey(e.show);
    const group = byShow.get(key) ?? { title: e.show.trim(), data: [] };
    group.data.push(e);
    byShow.set(key, group);
  }
  return [...byShow.values()]
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    .map((g) => ({ title: g.title, data: g.data.sort(compareEpisodes) }));
}

/** The downloaded episode that comes after `current` in its show, if there is one. */
export function nextEpisode<T extends Pick<Episode, 'id' | 'show' | 'title' | 'createdAt' | 'status'>>(
  episodes: T[],
  current: T
): T | null {
  const show = groupByShow(episodes).find((g) => showKey(g.title) === showKey(current.show));
  if (!show) return null;
  const i = show.data.findIndex((e) => e.id === current.id);
  return i >= 0 && i + 1 < show.data.length ? show.data[i + 1] : null;
}

type Playable = Pick<Episode, 'id' | 'show' | 'title' | 'createdAt' | 'status' | 'positionSec' | 'watched' | 'lastPlayedAt'>;

/**
 * One episode per show you've been watching, most recently played first: the
 * one you stopped partway through, or else the next one after the last you
 * played. Shows you're caught up on (or never started) don't appear.
 */
export function continueWatching<T extends Playable>(episodes: T[]): { episode: T; resume: boolean }[] {
  const out: { episode: T; resume: boolean; at: number }[] = [];
  for (const show of groupByShow(episodes)) {
    const played = show.data.filter((e) => e.lastPlayedAt);
    if (played.length === 0) continue;
    const last = played.reduce((a, b) => ((b.lastPlayedAt ?? 0) > (a.lastPlayedAt ?? 0) ? b : a));
    const at = last.lastPlayedAt ?? 0;
    if (last.positionSec > 0 && !last.watched) {
      out.push({ episode: last, resume: true, at });
      continue;
    }
    const next = show.data.slice(show.data.indexOf(last) + 1).find((e) => !e.watched);
    if (next) out.push({ episode: next, resume: next.positionSec > 0, at });
  }
  return out.sort((a, b) => b.at - a.at).map(({ episode, resume }) => ({ episode, resume }));
}

/** Space a show's downloaded episodes take on the phone. */
export function showBytes(list: Pick<Episode, 'bytesWritten' | 'status'>[]): number {
  return list.reduce((n, e) => n + (e.status === 'done' ? Math.max(0, e.bytesWritten) : 0), 0);
}

export type ShowSort = 'recent' | 'az' | 'added';

export type ShowSummary<T> = {
  key: string;
  title: string;
  episodes: T[];
  unwatched: number;
  bytes: number;
  /** What tapping "play" on the show starts: where you stopped, or the next unwatched episode. */
  next: T | null;
  resume: boolean;
  lastPlayedAt: number;
  lastAddedAt: number;
};

type Summarizable = Playable & Pick<Episode, 'bytesWritten'>;

/** One entry per show for the Library's show list. */
export function showSummaries<T extends Summarizable>(episodes: T[]): ShowSummary<T>[] {
  return groupByShow(episodes).map((g) => {
    const played = g.data.filter((e) => e.lastPlayedAt);
    const last = played.length ? played.reduce((a, b) => ((b.lastPlayedAt ?? 0) > (a.lastPlayedAt ?? 0) ? b : a)) : null;
    let next: T | null = null;
    let resume = false;
    if (last && last.positionSec > 0 && !last.watched) {
      next = last;
      resume = true;
    } else {
      // After the last one played; for a show never played, the first unwatched.
      const from = last ? g.data.indexOf(last) + 1 : 0;
      next = g.data.slice(from).find((e) => !e.watched) ?? g.data.find((e) => !e.watched) ?? null;
      resume = !!next && next.positionSec > 0;
    }
    return {
      key: showKey(g.title),
      title: g.title,
      episodes: g.data,
      unwatched: g.data.filter((e) => !e.watched).length,
      bytes: showBytes(g.data),
      next,
      resume,
      lastPlayedAt: last?.lastPlayedAt ?? 0,
      lastAddedAt: Math.max(...g.data.map((e) => e.createdAt)),
    };
  });
}

/** Shows matching a search (every word, anywhere in the name), in the chosen order. */
export function findShows<T>(shows: ShowSummary<T>[], query: string, sort: ShowSort): ShowSummary<T>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = shows.filter((s) => words.every((w) => s.key.includes(w)));
  const byName = (a: ShowSummary<T>, b: ShowSummary<T>) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  return [...matching].sort((a, b) => {
    if (sort === 'recent') return b.lastPlayedAt - a.lastPlayedAt || b.lastAddedAt - a.lastAddedAt || byName(a, b);
    if (sort === 'added') return b.lastAddedAt - a.lastAddedAt || byName(a, b);
    return byName(a, b);
  });
}
