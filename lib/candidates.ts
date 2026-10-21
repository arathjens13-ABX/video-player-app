import type { Candidate, ProbeResult } from './probe';
import { baseDomain } from './browser';
import { URL } from './url';

/** A video found on the page, with the other links that carry the same video. */
export type VideoGroup = {
  best: Candidate;
  result: Extract<ProbeResult, { status: 'ok' }>;
  /** Other links for the same video (single-quality copies of a stream, repeats). */
  copies: Candidate[];
};

type Checked = { c: Candidate; r: Extract<ProbeResult, { status: 'ok' }> };

/** Long enough to be an episode rather than an ad or a preview. */
const EPISODE_SEC = 120;
const EPISODE_BYTES = 30e6;

function durationOf(r: Checked['r']) {
  return r.kind === 'hls' ? r.info.duration : null;
}

function topHeight(r: Checked['r']) {
  return r.kind === 'hls' ? (r.info.qualities[0]?.height ?? 0) : 0;
}

export function isEpisodeLength(r: Checked['r']) {
  return r.kind === 'hls' ? r.info.duration >= EPISODE_SEC : (r.size ?? 0) >= EPISODE_BYTES;
}

/** Which link to offer for a video: a stream with a choice of qualities, then the highest quality. */
function better(a: Checked, b: Checked): number {
  const qa = a.r.kind === 'hls' ? a.r.info.qualities.length : 0;
  const qb = b.r.kind === 'hls' ? b.r.info.qualities.length : 0;
  return Number(qb > 0) - Number(qa > 0) || topHeight(b.r) - topHeight(a.r) || qb - qa;
}

function sameVideo(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(2, a * 0.01);
}

/**
 * Turns the links a page loaded into the videos it contains. A player usually
 * requests one stream several ways (the playlist with every quality, then each
 * quality's own playlist), which would otherwise show up as many identical
 * "videos". Streams of the same length count as one video; the link offered for
 * it is the one with a choice of qualities. Episode-length videos come first.
 */
export function groupVideos(candidates: Candidate[], results: (url: string) => ProbeResult | 'pending' | undefined): VideoGroup[] {
  const checked: Checked[] = [];
  for (const c of candidates) {
    const r = results(c.url);
    if (r && r !== 'pending' && r.status === 'ok') checked.push({ c, r });
  }

  const groups: { members: Checked[]; duration: number | null }[] = [];
  for (const item of checked) {
    const d = durationOf(item.r);
    const group = d === null ? undefined : groups.find((g) => g.duration !== null && sameVideo(g.duration, d));
    if (group) group.members.push(item);
    else groups.push({ members: [item], duration: d });
  }

  return groups
    .map((g) => {
      const [top, ...rest] = [...g.members].sort(better);
      return { best: top.c, result: top.r, copies: rest.map((m) => m.c) };
    })
    .sort(
      (a, b) =>
        Number(isEpisodeLength(b.result)) - Number(isEpisodeLength(a.result)) ||
        (durationOf(b.result) ?? 0) - (durationOf(a.result) ?? 0) ||
        (b.result.kind === 'file' ? (b.result.size ?? 0) : 0) - (a.result.kind === 'file' ? (a.result.size ?? 0) : 0)
    );
}

/** Rough download size of a stream at its best quality, from the playlist's advertised bitrate. */
export function estimatedSize(r: Extract<ProbeResult, { status: 'ok' }>): number | null {
  if (r.kind === 'file') return r.size;
  const q = r.info.qualities[0];
  return q?.bandwidth ? (q.bandwidth * r.info.duration) / 8 : null;
}

/** Where a video plays from, for telling servers apart: the player frame's site ("dailymotion.com"). */
export function sourceLabel(c: Candidate): string {
  for (const url of [c.frame, c.url]) {
    try {
      const host = new URL(url).hostname;
      if (host) return baseDomain(host);
    } catch {
      // Try the next one.
    }
  }
  return 'this page';
}
