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

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/**
 * Splits a show name into its series and season: "Tales Of Demons And Gods
 * Season 10" -> { series: "Tales Of Demons And Gods", season: 10 }. Names
 * without a season marker are the whole series ("Soul Land 2" is a sequel's
 * name, not a season).
 */
export function seriesOf(show: string): { series: string; season: number | null } {
  const name = show.trim().replace(/\s+/g, ' ');
  const patterns: [RegExp, (m: RegExpMatchArray) => number | undefined][] = [
    [/^(.*?)[\s:,(-]*\bseason\s*(\d+)\b\)?(.*)$/i, (m) => Number(m[2])],
    [/^(.*?)[\s:,(-]*\b(\d+)(?:st|nd|rd|th)\s+season\b\)?(.*)$/i, (m) => Number(m[2])],
    [/^(.*?)[\s:,(-]*\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b\)?(.*)$/i, (m) => ORDINALS[m[2].toLowerCase()]],
    [/^(.*?)[\s:,(-]*\bs(\d{1,2})\b\)?(.*)$/i, (m) => Number(m[2])],
  ];
  for (const [re, num] of patterns) {
    const m = name.match(re);
    const season = m ? num(m) : undefined;
    if (m && season !== undefined && m[1].trim()) {
      const series = `${m[1]} ${m[3]}`.replace(/[\s:,(-]+$/, '').replace(/\s+/g, ' ').trim();
      return { series, season };
    }
  }
  return { series: name, season: null };
}

export function seriesKey(show: string) {
  return showKey(seriesOf(show).series);
}

export type Season<T> = { show: string; season: number | null; episodes: T[] };
export type Series<T> = { key: string; title: string; seasons: Season<T>[]; episodes: T[] };

/** Shows grouped into series, seasons in order (unnumbered first), episodes in watching order across seasons. */
export function groupBySeries<T extends Pick<Episode, 'show' | 'title' | 'createdAt' | 'status'>>(episodes: T[]): Series<T>[] {
  const bySeries = new Map<string, { title: string; shows: { title: string; data: T[] }[] }>();
  for (const show of groupByShow(episodes)) {
    const { series } = seriesOf(show.title);
    const key = showKey(series);
    const entry = bySeries.get(key) ?? { title: series, shows: [] };
    entry.shows.push(show);
    bySeries.set(key, entry);
  }
  return [...bySeries.entries()]
    .map(([key, { title, shows }]) => {
      const seasons = shows
        .map((s) => ({ show: s.title, season: seriesOf(s.title).season, episodes: s.data }))
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0));
      return { key, title, seasons, episodes: seasons.flatMap((s) => s.episodes) };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** The downloaded episode that comes after `current`, carrying on into the next season. */
export function nextEpisode<T extends Pick<Episode, 'id' | 'show' | 'title' | 'createdAt' | 'status'>>(
  episodes: T[],
  current: T
): T | null {
  const series = groupBySeries(episodes).find((g) => g.key === seriesKey(current.show));
  if (!series) return null;
  const i = series.episodes.findIndex((e) => e.id === current.id);
  return i >= 0 && i + 1 < series.episodes.length ? series.episodes[i + 1] : null;
}

type Playable = Pick<Episode, 'id' | 'show' | 'title' | 'createdAt' | 'status' | 'positionSec' | 'watched' | 'lastPlayedAt'>;

/** Where to pick a series back up: the episode stopped partway through, or the next unwatched one. */
function pickUp<T extends Playable>(ordered: T[]): { next: T | null; resume: boolean; last: T | null } {
  const played = ordered.filter((e) => e.lastPlayedAt);
  const last = played.length ? played.reduce((a, b) => ((b.lastPlayedAt ?? 0) > (a.lastPlayedAt ?? 0) ? b : a)) : null;
  if (last && last.positionSec > 0 && !last.watched) return { next: last, resume: true, last };
  const from = last ? ordered.indexOf(last) + 1 : 0;
  const next = ordered.slice(from).find((e) => !e.watched) ?? (last ? null : (ordered.find((e) => !e.watched) ?? null));
  return { next, resume: !!next && next.positionSec > 0, last };
}

/**
 * One episode per series you've been watching, most recently played first: the
 * one you stopped partway through, or else the next one after the last you
 * played. Series you're caught up on (or never started) don't appear.
 */
export function continueWatching<T extends Playable>(episodes: T[]): { episode: T; resume: boolean }[] {
  const out: { episode: T; resume: boolean; at: number }[] = [];
  for (const series of groupBySeries(episodes)) {
    const { next, resume, last } = pickUp(series.episodes);
    if (last && next) out.push({ episode: next, resume, at: last.lastPlayedAt ?? 0 });
  }
  return out.sort((a, b) => b.at - a.at).map(({ episode, resume }) => ({ episode, resume }));
}

/** Downloaded but never opened. */
export function isNew(e: Pick<Episode, 'status' | 'watched' | 'lastPlayedAt' | 'positionSec'>): boolean {
  return e.status === 'done' && !e.watched && !e.lastPlayedAt && e.positionSec === 0;
}

/** Space a show's downloaded episodes take on the phone. */
export function showBytes(list: Pick<Episode, 'bytesWritten' | 'status'>[]): number {
  return list.reduce((n, e) => n + (e.status === 'done' ? Math.max(0, e.bytesWritten) : 0), 0);
}

export type ShowSort = 'recent' | 'az' | 'added';

export type ShowSummary<T> = {
  key: string;
  title: string;
  seasons: Season<T>[];
  /** Every episode, in watching order across seasons. */
  episodes: T[];
  unwatched: number;
  fresh: number;
  bytes: number;
  /** What tapping "play" starts: where you stopped, or the next unwatched episode. */
  next: T | null;
  resume: boolean;
  lastPlayedAt: number;
  lastAddedAt: number;
};

type Summarizable = Playable & Pick<Episode, 'bytesWritten'>;

/** One entry per series for the Library's list. */
export function showSummaries<T extends Summarizable>(episodes: T[]): ShowSummary<T>[] {
  return groupBySeries(episodes).map((g) => {
    const { next, resume, last } = pickUp(g.episodes);
    return {
      key: g.key,
      title: g.title,
      seasons: g.seasons,
      episodes: g.episodes,
      unwatched: g.episodes.filter((e) => !e.watched).length,
      fresh: g.episodes.filter(isNew).length,
      bytes: showBytes(g.episodes),
      next,
      resume,
      lastPlayedAt: last?.lastPlayedAt ?? 0,
      lastAddedAt: Math.max(...g.episodes.map((e) => e.createdAt)),
    };
  });
}

/** Series matching a search (every word, anywhere in the name or a season's name), in the chosen order. */
export function findShows<T>(shows: ShowSummary<T>[], query: string, sort: ShowSort): ShowSummary<T>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = shows.filter((s) => {
    const text = [s.key, ...s.seasons.map((x) => x.show.toLowerCase())].join(' ');
    return words.every((w) => text.includes(w));
  });
  const byName = (a: ShowSummary<T>, b: ShowSummary<T>) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  return [...matching].sort((a, b) => {
    if (sort === 'recent') return b.lastPlayedAt - a.lastPlayedAt || b.lastAddedAt - a.lastAddedAt || byName(a, b);
    if (sort === 'added') return b.lastAddedAt - a.lastAddedAt || byName(a, b);
    return byName(a, b);
  });
}

/** A season's show name after its series is renamed: "New Name Season 3", or just the name. */
export function renamedShow(season: number | null, seriesName: string): string {
  const name = seriesName.trim().replace(/\s+/g, ' ');
  return season === null ? name : `${name} Season ${season}`;
}
