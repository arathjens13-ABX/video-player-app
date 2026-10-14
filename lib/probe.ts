import { describeStream, type StreamInfo } from './hls';
import { requestHeaders, withTimeout } from './http';
import { URL } from './url';

export type Candidate = {
  url: string;
  kind: 'hls' | 'file';
  /** URL of the frame that requested it, sent as the Referer when downloading. */
  frame: string;
  via: string;
};

export type ProbeResult =
  | { status: 'ok'; kind: 'hls'; info: StreamInfo }
  | { status: 'ok'; kind: 'file'; size: number | null; contentType: string | null }
  | { status: 'invalid'; reason: string };

/**
 * Checks a detected URL before offering it: streams must parse as real
 * playlists (players also request ad configs from ".m3u8" URLs), and files must
 * not be web pages. Also gathers the duration, qualities or size to show.
 */
export async function probe(c: Candidate, userAgent: string): Promise<ProbeResult> {
  const headers = requestHeaders(c.frame, userAgent);
  try {
    if (c.kind === 'hls') {
      const info = await describeStream(c.url, (url) =>
        withTimeout(10000, async (signal) => {
          const res = await fetch(url, { headers, signal });
          if (!res.ok) throw new Error(`The server answered ${res.status}`);
          return { text: await res.text(), url: res.url || url };
        })
      );
      if (info.duration <= 0) return { status: 'invalid', reason: 'Empty stream' };
      if (info.unsupportedEncryption) return { status: 'invalid', reason: 'Protected stream (DRM)' };
      return { status: 'ok', kind: 'hls', info };
    }
    const res = await withTimeout(10000, (signal) => fetch(c.url, { headers: { ...headers, Range: 'bytes=0-0' }, signal }));
    const contentType = res.headers.get('content-type');
    // Don't download the body; one byte (or a whole small error page) is plenty.
    res.body?.cancel?.().catch(() => {});
    if (!res.ok) return { status: 'invalid', reason: `The server answered ${res.status}` };
    if (contentType && /text\/html|json|xml/i.test(contentType)) {
      return { status: 'invalid', reason: 'Not a video (web page)' };
    }
    const range = res.headers.get('content-range');
    const total = range?.match(/\/(\d+)$/)?.[1] ?? (res.status === 200 ? res.headers.get('content-length') : null);
    return { status: 'ok', kind: 'file', size: total ? Number(total) : null, contentType };
  } catch (e) {
    return { status: 'invalid', reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Identity of a detected link for de-duplication. Players often request the
 * same stream twice with fresh tokens in the query string; those count as one.
 * Short generic paths ("/video.m3u8") keep their query, which is what tells
 * videos apart there.
 */
export function candidateKey(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    return u.host + u.pathname + (segments.length < 2 ? u.search : '');
  } catch {
    return url;
  }
}
