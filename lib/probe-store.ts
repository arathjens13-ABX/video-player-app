import { probe, type Candidate, type ProbeResult } from './probe';
import { logInfo, shortUrl } from './log';
import { USER_AGENT } from './ua';

// Probe results per URL, shared by the browser toolbar and the detected-videos sheet.
const results = new Map<string, ProbeResult | 'pending'>();
const listeners = new Set<() => void>();

export function probeStatus(url: string): ProbeResult | 'pending' | undefined {
  return results.get(url);
}

export function startProbe(c: Candidate) {
  if (results.has(c.url)) return;
  results.set(c.url, 'pending');
  probe(c, USER_AGENT).then((r) => {
    if (r.status === 'invalid') logInfo('probe', `rejected ${shortUrl(c.url)}: ${r.reason}`);
    else if (r.kind === 'hls')
      logInfo('probe', `ok stream ${Math.round(r.info.duration)}s ${r.info.qualities.map((q) => q.label).join('/') || 'single'}${r.info.encrypted ? ' encrypted' : ''}: ${shortUrl(c.url)}`);
    else logInfo('probe', `ok file ${r.size ?? '?'} bytes ${r.contentType ?? ''}: ${shortUrl(c.url)}`);
    results.set(c.url, r);
    listeners.forEach((l) => l());
  });
}

export function subscribeProbes(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
