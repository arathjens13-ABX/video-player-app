import { probe, type Candidate, type ProbeResult } from './probe';
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
