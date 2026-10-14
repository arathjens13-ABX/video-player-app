import { URL } from './url';

/**
 * Headers for fetching a video the way the page's player did: same user agent,
 * and the frame it played in as Referer/Origin (many hosts check them).
 * Frames without a real address (about:blank, srcdoc) send neither.
 */
export function requestHeaders(referer: string | null | undefined, userAgent: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': userAgent };
  if (referer && /^https?:/i.test(referer)) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch {
      // A malformed referer still goes out as Referer alone.
    }
  }
  return headers;
}

export class TimeoutError extends Error {
  constructor() {
    super('Timed out');
    this.name = 'TimeoutError';
  }
}

/**
 * Runs a request (including reading its body) with a time limit. `run` gets the
 * signal to pass to fetch; when time runs out it fails with a TimeoutError,
 * whatever error the cancelled request itself reports.
 */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    return await run(controller.signal);
  } catch (e) {
    throw timedOut ? new TimeoutError() : e;
  } finally {
    clearTimeout(timer);
  }
}
