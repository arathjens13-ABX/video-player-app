/** Messages the injected detector script (lib/detector.ts) posts to the app. */

export type Server = { label: string; url: string };

/** One entry of a season's episode list, as the site shows it ("32 [464]", "… Episode 32 [464] Subtitle"). */
export type ListedEpisode = { url: string; num: string; title: string };

export type DetectorMessage =
  | { type: 'media'; url: string; kind: 'hls' | 'file'; via: string; frame: string }
  | { type: 'servers'; servers: Server[] }
  | { type: 'page'; title: string; url: string }
  /** A season page's episodes, or (on an episode page) just where that list is. */
  | { type: 'episodes'; series: string; listUrl: string; episodes: ListedEpisode[] };

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

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
  if (o.type === 'media' && isString(o.url) && (o.kind === 'hls' || o.kind === 'file') && isString(o.frame)) {
    return { type: 'media', url: o.url, kind: o.kind, via: isString(o.via) ? o.via : '?', frame: o.frame };
  }
  if (o.type === 'servers' && Array.isArray(o.servers)) {
    const servers = o.servers.filter(
      (x): x is Server => !!x && typeof x === 'object' && isString((x as Server).url) && typeof (x as Server).label === 'string'
    );
    return { type: 'servers', servers };
  }
  if (o.type === 'episodes' && isString(o.listUrl) && Array.isArray(o.episodes)) {
    const episodes = o.episodes.filter(
      (x): x is ListedEpisode =>
        !!x && typeof x === 'object' && isString((x as ListedEpisode).url) && typeof (x as ListedEpisode).num === 'string' && typeof (x as ListedEpisode).title === 'string'
    );
    return { type: 'episodes', series: typeof o.series === 'string' ? o.series : '', listUrl: o.listUrl, episodes };
  }
  if (o.type === 'page' && typeof o.title === 'string' && isString(o.url)) return { type: 'page', title: o.title, url: o.url };
  return null;
}

