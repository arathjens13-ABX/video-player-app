/**
 * Planning a season download: which episodes, in what order, and roughly how
 * much space they take. No app state here, so it can be tested on its own.
 */
import type { ListedEpisode } from './detector-messages';
import type { StreamInfo } from './hls';
import { guessNames } from './links';

/** Batch downloads never take the phone below this much free space. */
export const KEEP_FREE_BYTES = 20e9;

export type SeasonEpisode = ListedEpisode & { number: number | null; show: string; name: string };

/** "32 [464]" -> 32 (the season's own count, not the running total in brackets). */
export function listedNumber(num: string): number | null {
  const m = num.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * The site's list (usually newest first) as episodes in watching order, named
 * the way a single download from the episode page would be, so they land in
 * the same show in the Library.
 */
export function seasonEpisodes(list: ListedEpisode[]): SeasonEpisode[] {
  const out = list.map((e) => {
    const names = guessNames(e.title);
    const fromTitle = names.title.match(/^Episode (\d+)$/);
    const number = listedNumber(e.num) ?? (fromTitle ? Number(fromTitle[1]) : null);
    return { ...e, number, show: names.show, name: number !== null ? `Episode ${number}` : names.title };
  });
  // Numbered episodes in order; anything unnumbered (specials) keeps its place at the end.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.number ?? Infinity) - (b.e.number ?? Infinity) || b.i - a.i)
    .map(({ e }) => e);
}

export type Range = { from: number; to: number };

/** Episodes whose number falls in the range (inclusive). */
export function inRange(episodes: SeasonEpisode[], r: Range): SeasonEpisode[] {
  const lo = Math.min(r.from, r.to);
  const hi = Math.max(r.from, r.to);
  return episodes.filter((e) => e.number !== null && e.number >= lo && e.number <= hi);
}

/**
 * Quick picks for the range. "Next" continues after the highest episode
 * already in the Library (or from the start); "Latest" is the newest ones.
 */
export function presets(episodes: SeasonEpisode[], have: Set<number>, count = 10) {
  const numbered = episodes.filter((e) => e.number !== null) as (SeasonEpisode & { number: number })[];
  if (numbered.length === 0) return null;
  const first = numbered[0].number;
  const last = numbered[numbered.length - 1].number;
  const highestHave = Math.max(-Infinity, ...numbered.filter((e) => have.has(e.number)).map((e) => e.number));
  const after = numbered.filter((e) => e.number > highestHave);
  const next = after.length ? { from: after[0].number, to: after[Math.min(count, after.length) - 1].number } : null;
  const latest = { from: numbered[Math.max(0, numbered.length - count)].number, to: last };
  return { next, latest, all: { from: first, to: last }, highestHave: Number.isFinite(highestHave) ? highestHave : null };
}

/** Bytes for a stream at the quality a download capped at `maxHeight` would get. */
export function sizeAtQuality(info: StreamInfo, maxHeight: number): number | null {
  const sized = info.qualities.filter((q) => q.height && q.bandwidth > 0);
  const pick =
    [...sized].sort((a, b) => b.height! - a.height!).find((q) => q.height! <= maxHeight) ??
    sized[sized.length - 1] ??
    info.qualities.find((q) => q.bandwidth > 0);
  return pick ? (pick.bandwidth * info.duration) / 8 : null;
}

/** How many episodes of about `each` bytes fit in `free` while keeping `keep` free. */
export function howManyFit(free: number, each: number, keep = KEEP_FREE_BYTES): number {
  if (each <= 0) return Infinity;
  return Math.max(0, Math.floor((free - keep) / each));
}
