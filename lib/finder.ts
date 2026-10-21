/**
 * The decisions behind finding an episode's video without the user: which
 * server to switch to, which detected links belong to it, and when the video
 * has been found. The hidden browser (components/VideoFinder.tsx) feeds it
 * what the page reports; kept free of React so it can be tested.
 */
import type { Found } from './batch';
import { baseDomain } from './browser';
import { groupVideos, isEpisodeLength } from './candidates';
import type { Server } from './detector-messages';
import type { Candidate, ProbeResult } from './probe';
import { URL } from './url';

function site(url: string): string | null {
  try {
    return baseDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

/**
 * Whether a mirror's label names the wanted server. Sites tack tags onto labels
 * that come and go ("Hardsub English Dailymotion" vs "… Dailymotion AX"), so
 * the shorter label's words all appearing in the longer one counts as a match.
 */
export function sameServer(label: string, wanted: string): boolean {
  const a = words(label);
  const b = words(wanted);
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return short.every((w) => long.has(w));
}

export class FinderSession {
  /** The player's site once decided ("dailymotion.com"); links from other frames are someone else's. */
  private target: string | null | undefined = undefined;
  private early: Candidate[] = [];
  readonly accepted: Candidate[] = [];
  private seen = new Set<string>();
  foundAt: number | null = null;
  /** The server actually used, for messages ("page default" when the wanted one isn't on this page). */
  serverUsed: string | null = null;

  constructor(readonly wanted: string | null) {}

  /** The page's server list arrived. Returns the mirror URL to switch the player to, if any. */
  onServers(servers: Server[]): string | null {
    if (this.target !== undefined) return null;
    const wanted = this.wanted;
    const match = wanted
      ? (servers.find((s) => s.label.trim().toLowerCase() === wanted.trim().toLowerCase()) ??
        servers.find((s) => !s.label.startsWith('Current player') && sameServer(s.label, wanted)))
      : undefined;
    if (match) {
      this.target = site(match.url);
      this.serverUsed = match.label;
      this.flushEarly();
      return match.url;
    }
    // The full mirror list can arrive after a first list holding only the current player,
    // so a missing server is only given up on by settleWithoutServers.
    if (this.wanted) return null;
    this.target = null;
    this.flushEarly();
    return null;
  }

  /** The wanted server hasn't shown up after a while: take the page's default player. */
  settleWithoutServers() {
    if (this.target !== undefined) return;
    this.target = null;
    this.flushEarly();
  }

  /** A link the page loaded. Returns true when it should be checked (probed). */
  onMedia(c: Candidate): boolean {
    if (this.seen.has(c.url)) return false;
    if (this.target === undefined) {
      this.early.push(c);
      return false;
    }
    return this.accept(c);
  }

  private flushEarly() {
    const early = this.early;
    this.early = [];
    for (const c of early) this.accept(c);
  }

  private accept(c: Candidate) {
    if (this.target && site(c.frame) !== this.target && site(c.url) !== this.target) return false;
    this.seen.add(c.url);
    this.accepted.push(c);
    return true;
  }

  /**
   * The video, once an episode-length one has checked out and the other links
   * have had `settleMs` to finish checking (a better copy may still be coming).
   */
  pick(status: (url: string) => ProbeResult | 'pending' | undefined, now: number, settleMs = 2500): Found | null {
    const groups = groupVideos(this.accepted, status);
    const best = groups.find((g) => isEpisodeLength(g.result));
    if (!best) return null;
    this.foundAt ??= now;
    const pending = this.accepted.some((c) => {
      const s = status(c.url);
      return s === undefined || s === 'pending';
    });
    if (pending && now - this.foundAt < settleMs) return null;
    return { candidate: best.best, result: best.result };
  }
}
