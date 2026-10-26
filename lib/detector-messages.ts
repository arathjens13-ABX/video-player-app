/** Messages the injected detector script (lib/detector.ts) posts to the app. */
import { sameSite } from './browser';

export type Server = { label: string; url: string };

/** One entry of a season's episode list, as the site shows it ("32 [464]", "… Episode 32 [464] Subtitle"). */
export type ListedEpisode = { url: string; num: string; title: string };

export type DetectorMessage =
  | { type: 'media'; url: string; kind: 'hls' | 'file'; via: string; frame: string }
  | { type: 'servers'; servers: Server[] }
  | { type: 'page'; title: string; url: string; cover: string | null }
  /** A season page's episodes, or (on an episode page) just where that list is. */
  | { type: 'episodes'; series: string; listUrl: string; episodes: ListedEpisode[] };

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
/** Pages only get to hand over ordinary web links (never file:, javascript: or app links), of sane length. */
const isWebUrl = (v: unknown): v is string => isString(v) && v.length <= 8192 && /^https?:\/\//i.test(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** More than any real page lists; caps what a hostile page can make the app hold. */
const MAX_SERVERS = 100;
const MAX_EPISODES = 5000;

/** Any page or iframe can post to the app, so only well-formed detector messages are accepted. */
export function parseDetectorMessage(data: string): DetectorMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.type === 'media' && isWebUrl(o.url) && (o.kind === 'hls' || o.kind === 'file') && isString(o.frame)) {
    return { type: 'media', url: o.url, kind: o.kind, via: isString(o.via) ? text(o.via, 20) : '?', frame: text(o.frame, 8192) };
  }
  if (o.type === 'servers' && Array.isArray(o.servers)) {
    const servers = o.servers
      .filter((x): x is Server => !!x && typeof x === 'object' && isWebUrl((x as Server).url) && typeof (x as Server).label === 'string')
      .slice(0, MAX_SERVERS)
      .map((x) => ({ label: text(x.label, 200), url: x.url }));
    return { type: 'servers', servers };
  }
  if (o.type === 'episodes' && isWebUrl(o.listUrl) && Array.isArray(o.episodes)) {
    const listUrl = o.listUrl;
    // Episode pages are opened by the hidden browser for season downloads: only pages on the list's own site.
    const episodes = o.episodes
      .filter(
        (x): x is ListedEpisode =>
          !!x &&
          typeof x === 'object' &&
          isWebUrl((x as ListedEpisode).url) &&
          sameSite((x as ListedEpisode).url, listUrl) &&
          typeof (x as ListedEpisode).num === 'string' &&
          typeof (x as ListedEpisode).title === 'string'
      )
      .slice(0, MAX_EPISODES)
      .map((x) => ({ url: x.url, num: text(x.num, 50), title: text(x.title, 500) }));
    return { type: 'episodes', series: text(o.series, 500), listUrl, episodes };
  }
  if (o.type === 'page' && typeof o.title === 'string' && isString(o.url)) {
    return { type: 'page', title: text(o.title, 500), url: text(o.url, 8192), cover: isWebUrl(o.cover) ? o.cover : null };
  }
  return null;
}

