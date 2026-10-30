/**
 * Soft subtitles saved next to a video (WebVTT, or SRT): reading the cues and
 * finding the one on screen. Pure functions, so they can be tested on their own.
 */

export type Cue = { start: number; end: number; text: string };

/** Subtitle files bigger than this are not subtitles. */
export const MAX_SUBTITLE_CHARS = 5_000_000;

/** "01:02:03.450", "02:03,450" or "02:03.45" -> seconds. */
function parseTime(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + Number(frac.padEnd(3, '0')) / 1000;
}

/** Cue text as plain lines: tags (<i>, <c.yellow>, {\an8}) and entities removed. */
function cleanText(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** All cues of a WebVTT or SRT file, in time order. Anything unreadable is skipped. */
export function parseCues(text: string): Cue[] {
  if (text.length > MAX_SUBTITLE_CHARS) text = text.slice(0, MAX_SUBTITLE_CHARS);
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue; // header, NOTE, STYLE or REGION blocks
    const [from, rest] = lines[at].split('-->');
    const start = parseTime(from);
    const end = parseTime(rest.trim().split(/\s+/)[0] ?? '');
    const cueText = cleanText(lines.slice(at + 1));
    if (start === null || end === null || end <= start || !cueText) continue;
    cues.push({ start, end, text: cueText });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * One WebVTT file from the pieces of an HLS subtitle track. Each piece has its
 * own header; the cue times are already counted from the start of the video.
 */
export function joinVtt(pieces: string[]): string {
  const cues = pieces.flatMap((p) => parseCues(p));
  // Pieces can overlap at their edges and repeat a cue.
  const seen = new Set<string>();
  const unique = cues
    .sort((a, b) => a.start - b.start)
    .filter((c) => {
      const key = `${c.start}|${c.end}|${c.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return toVtt(unique);
}

function formatTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

export function toVtt(cues: Cue[]): string {
  return ['WEBVTT', '', ...cues.map((c) => `${formatTime(c.start)} --> ${formatTime(c.end)}\n${c.text}\n`)].join('\n');
}

/** The text on screen at `time` (cues that overlap are shown together), or ''. */
export function cueTextAt(cues: Cue[], time: number): string {
  // Last cue starting at or before `time`.
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const showing: string[] = [];
  // Overlapping cues are rare and short; looking back a few is enough.
  for (let i = last; i >= 0 && i > last - 8; i--) {
    if (cues[i].end > time) showing.unshift(cues[i].text);
  }
  return showing.join('\n');
}

/** "12.mp4" -> "12.vtt": subtitles sit next to their video. */
export function subtitleFileName(videoFileName: string): string {
  return videoFileName.replace(/\.[^.]+$/, '') + '.vtt';
}
