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

/** Downloaded episodes grouped by show, shows A–Z, episodes in order. */
export function groupByShow<T extends Pick<Episode, 'show' | 'title' | 'createdAt' | 'status'>>(episodes: T[]) {
  const byShow = new Map<string, T[]>();
  for (const e of episodes) {
    if (e.status !== 'done') continue;
    const list = byShow.get(e.show) ?? [];
    list.push(e);
    byShow.set(e.show, list);
  }
  return [...byShow.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([title, data]) => ({ title, data: data.sort(compareEpisodes) }));
}

/** The downloaded episode that comes after `current` in its show, if there is one. */
export function nextEpisode<T extends Pick<Episode, 'id' | 'show' | 'title' | 'createdAt' | 'status'>>(
  episodes: T[],
  current: T
): T | null {
  const show = groupByShow(episodes).find((g) => g.title === current.show);
  if (!show) return null;
  const i = show.data.findIndex((e) => e.id === current.id);
  return i >= 0 && i + 1 < show.data.length ? show.data[i + 1] : null;
}
