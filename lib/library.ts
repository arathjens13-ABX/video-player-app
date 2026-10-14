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
