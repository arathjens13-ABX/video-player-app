/** The pure parts of following shows (lib/follows.ts), testable without the app's database. */
import type { OnlineEpisode } from './catalog/parse';
import { seasonEpisodes, type SeasonEpisode } from './season';

export type FollowCheck<F extends { title: string }> = { follow: F; fresh: SeasonEpisode[]; queued: number };

/** Episodes on the show's page not seen before (in watching order), and the updated seen list. */
export function freshEpisodes(seen: string[], episodes: OnlineEpisode[]): { fresh: SeasonEpisode[]; seen: string[] } {
  const known = new Set(seen);
  const fresh = seasonEpisodes(episodes.filter((e) => !known.has(e.url)));
  return { fresh, seen: [...new Set([...seen, ...episodes.map((e) => e.url)])] };
}

/** "2 new episodes of …", for a notification. Null when nothing is new. */
export function describeNew<F extends { title: string }>(results: FollowCheck<F>[]): { title: string; body: string } | null {
  const withNew = results.filter((r) => r.fresh.length > 0);
  if (withNew.length === 0) return null;
  if (withNew.length === 1) {
    const r = withNew[0];
    const downloading = r.queued ? ' Downloading when you open VidStash.' : '';
    return {
      title: r.follow.title,
      body: r.fresh.length === 1 ? `${r.fresh[0].name} is out.${downloading}` : `${r.fresh.length} new episodes are out.${downloading}`,
    };
  }
  const total = withNew.reduce((n, r) => n + r.fresh.length, 0);
  return { title: `${total} new episodes`, body: withNew.map((r) => `${r.follow.title} (${r.fresh.length})`).join(', ') };
}
