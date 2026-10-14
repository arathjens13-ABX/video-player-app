/** Messages the injected detector script (lib/detector.ts) posts to the app. */

export type Server = { label: string; url: string };

export type DetectorMessage =
  | { type: 'media'; url: string; kind: 'hls' | 'file'; via: string; frame: string }
  | { type: 'servers'; servers: Server[] }
  | { type: 'page'; title: string; url: string };

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
  if (o.type === 'page' && typeof o.title === 'string' && isString(o.url)) return { type: 'page', title: o.title, url: o.url };
  return null;
}

