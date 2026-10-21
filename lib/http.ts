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

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Settles as soon as `signal` aborts, whether or not `work` notices. Some
 * fetch implementations keep reading a response body after its request is
 * cancelled; a stopped download must not wait on them.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * A signal that aborts when `outer` does or after `ms` without finishing.
 * `timedOut()` tells the two apart.
 */
export function deadline(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    done() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}
