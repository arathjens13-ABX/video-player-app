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
import { isLanguage } from './hls';
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

/** Hosts the finder can't get a video file from (cloud drives), and the "current player" pseudo-entry. */
const NOT_FINDABLE = /\bmega\b|terabox|current player/i;

/** "Hardsub English Ok.ru", "Hardsub Eng Rumble": subtitles burned into the picture. */
export function isEnglishHardsub(label: string): boolean {
  return /hard\s*-?\s*sub/i.test(label) && /\beng(lish)?\b/i.test(label);
}

/** "All Sub Player Dailymotion": one upload with selectable subtitles, English only sometimes. */
export function isAllSub(label: string): boolean {
  return /\b(all|multi|soft)\s*-?\s*subs?\b/i.test(label);
}

/**
 * Servers to try, in order, when the wanted one doesn't produce a video: the
 * wanted one, then other English hardsubs, then All Sub uploads (which only
 * count if they carry English subtitles).
 */
export function serverOrder(servers: Server[], wanted: string | null): Server[] {
  const usable = servers.filter((s) => !NOT_FINDABLE.test(s.label));
  const first = wanted
    ? (usable.find((s) => s.label.trim().toLowerCase() === wanted.trim().toLowerCase()) ?? usable.find((s) => sameServer(s.label, wanted)))
    : undefined;
  const ordered = [...(first ? [first] : []), ...usable.filter((s) => isEnglishHardsub(s.label)), ...usable.filter((s) => isAllSub(s.label))];
  const seen = new Set<string>();
  return ordered.filter((s) => !seen.has(s.url) && !!seen.add(s.url));
}

/** The video id of a Dailymotion player URL (geo.dailymotion.com/player.html?video=x…, dailymotion.com/embed/video/x…). */
export function dailymotionId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)dailymotion\.com$|(^|\.)dai\.ly$/.test(u.hostname)) return null;
    const id = u.searchParams.get('video') ?? u.pathname.match(/\/video\/([a-zA-Z0-9]+)/)?.[1] ?? null;
    return id && /^[a-zA-Z0-9]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Why Dailymotion won't play an upload ("removed by Dailymotion"), from its player metadata; null if it plays. */
export function dailymotionProblem(metadata: unknown): string | null {
  const error = (metadata as { error?: { title?: string; status_code?: number } } | null)?.error;
  if (!error) return null;
  return error.status_code === 410 || /rejected|removed|deleted/i.test(error.title ?? '') ? 'removed by Dailymotion' : 'not playable on Dailymotion';
}

/** How long one server gets to produce its video before the next is tried. */
export const PER_SERVER_MS = 40_000;

type Attempt = { server: Server | null; started: number; needsEnglish: boolean };

export class FinderSession {
  /** The player's site once decided ("dailymotion.com"); links from other frames are someone else's. */
  private target: string | null | undefined = undefined;
  private early: Candidate[] = [];
  readonly accepted: Candidate[] = [];
  private seen = new Set<string>();
  foundAt: number | null = null;
  /** The server actually used, for messages ("page default" when the wanted one isn't on this page). */
  serverUsed: string | null = null;
  private servers: Server[] = [];
  private order: Server[] | null = null;
  private attempt: Attempt | null = null;
  /** What happened on each server tried, for the message when none works. */
  readonly tried: string[] = [];
  private gone = new Map<string, string>();
  private triedUrls = new Set<string>();

  constructor(
    readonly wanted: string | null,
    private readonly started = 0
  ) {}

  /** The page's server list arrived. Returns the mirror URL to switch the player to, if any. */
  onServers(servers: Server[]): string | null {
    this.servers = servers;
    if (this.target !== undefined) return null;
    const wanted = this.wanted;
    const match = wanted
      ? (servers.find((s) => s.label.trim().toLowerCase() === wanted.trim().toLowerCase()) ??
        servers.find((s) => !s.label.startsWith('Current player') && sameServer(s.label, wanted)))
      : undefined;
    if (match) return this.begin(match, this.started);
    // The full mirror list can arrive after a first list holding only the current player,
    // so a missing server is only given up on by settleWithoutServers.
    if (this.wanted) return null;
    this.begin(null, this.started);
    return null;
  }

  /**
   * The wanted server hasn't shown up after a while: try the other servers in
   * order (serverOrder), or the page's default player if none fits. Returns the
   * mirror URL to switch to, if any.
   */
  settleWithoutServers(now = this.started): string | null {
    if (this.target !== undefined) return null;
    const next = serverOrder(this.servers, null)[0];
    if (this.wanted) this.tried.push(`“${this.wanted}” isn’t on this page`);
    return this.begin(next ?? null, now);
  }

  /** The server being tried now: its mirror URL, label and whether it needs English subtitles. */
  get current(): Attempt | null {
    return this.attempt;
  }

  private begin(server: Server | null, now: number): string | null {
    this.attempt = { server, started: now, needsEnglish: !!server && isAllSub(server.label) };
    if (server) this.triedUrls.add(server.url);
    this.target = server ? site(server.url) : null;
    this.serverUsed = server?.label ?? null;
    this.accepted.length = 0;
    this.foundAt = null;
    this.flushEarly();
    return server?.url ?? null;
  }

  /** A check found the server's upload unplayable ("removed by Dailymotion"): move on at the next tick. */
  markGone(url: string, reason: string) {
    this.gone.set(url, reason);
  }

  /**
   * Gives up on the current server when it has had its time, its upload is
   * gone, or (for All Sub) its video has no English subtitles. Returns the next
   * server's mirror URL, `null` to keep waiting, or 'none' when every server has
   * been tried.
   */
  moveOn(status: (url: string) => ProbeResult | 'pending' | undefined, now: number): string | 'none' | null {
    const attempt = this.attempt;
    if (!attempt) return null;
    const why = this.whyNot(attempt, status, now);
    if (!why) return null;
    this.tried.push(`${attempt.server?.label ?? 'the page’s player'} (${why})`);
    this.order ??= serverOrder(this.servers, this.wanted);
    const next = this.order.find((s) => !this.triedUrls.has(s.url));
    if (!next) {
      this.attempt = null;
      return 'none';
    }
    return this.begin(next, now);
  }

  private whyNot(attempt: Attempt, status: (url: string) => ProbeResult | 'pending' | undefined, now: number): string | null {
    const gone = attempt.server && this.gone.get(attempt.server.url);
    if (gone) return gone;
    if (attempt.needsEnglish) {
      const groups = groupVideos(this.accepted, status);
      const settled = !this.accepted.some((c) => {
        const s = status(c.url);
        return s === undefined || s === 'pending';
      });
      if (settled && groups.some((g) => isEpisodeLength(g.result)) && !groups.some((g) => isEpisodeLength(g.result) && hasEnglish(g.result))) {
        return 'no English subtitles';
      }
    }
    return now - attempt.started > PER_SERVER_MS ? `no video in ${PER_SERVER_MS / 1000} s` : null;
  }

  /** The message when no server worked. */
  failure(): string {
    return this.tried.length ? `No video found. Tried: ${this.tried.join('; ')}` : 'No video found on the page’s player';
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
    const needsEnglish = this.attempt?.needsEnglish ?? false;
    const groups = groupVideos(this.accepted, status);
    const best = groups.find((g) => isEpisodeLength(g.result) && (!needsEnglish || hasEnglish(g.result)));
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

function hasEnglish(result: ProbeResult): boolean {
  return result.status === 'ok' && result.kind === 'hls' && result.info.subtitles.some((t) => isLanguage(t, 'en'));
}
