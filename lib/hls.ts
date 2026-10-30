/** Minimal HLS (.m3u8) parsing: enough to pick a quality, total the duration and list segments. */

import { URL } from './url';

export type Variant = {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  /** GROUP-ID of the separate audio rendition this variant plays with, if any. */
  audioGroup?: string;
};

export type AudioRendition = { groupId: string; url?: string; isDefault: boolean; name?: string; language?: string };

/** A subtitle track offered alongside the video (soft subs, e.g. Dailymotion's "All Sub" uploads). */
export type SubtitleTrack = { url: string; language?: string; name?: string; isDefault: boolean; forced: boolean };

export type Key = { method: 'NONE' | 'AES-128' | 'SAMPLE-AES' | string; url?: string; iv?: string };

export type Segment = {
  url: string;
  duration: number;
  key?: Key;
  /** EXT-X-MAP init section (fMP4 streams), with the key in force where it was declared. */
  map?: { url: string; byterange?: string; key?: Key };
  byterange?: string;
  /** Media sequence number, used as the default AES IV. */
  sequence: number;
};

export type MasterPlaylist = { type: 'master'; variants: Variant[]; audio: AudioRendition[]; subtitles: SubtitleTrack[] };
export type MediaPlaylist = { type: 'media'; segments: Segment[]; duration: number; ended: boolean };
export type Playlist = MasterPlaylist | MediaPlaylist;

function resolve(uri: string, base: string) {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

/** Parses `KEY=VALUE,KEY="quoted,value"` attribute lists. */
export function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

/** Far beyond any real playlist; a server sending more is broken or hostile, and reading it would freeze the app. */
export const MAX_PLAYLIST_CHARS = 10_000_000;
/** About 27 hours of 2-second pieces. */
export const MAX_SEGMENTS = 50_000;

export function parsePlaylist(text: string, baseUrl: string): Playlist {
  if (text.length > MAX_PLAYLIST_CHARS) throw new Error('Playlist is too large');
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('Not an HLS playlist');

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: Variant[] = [];
    const audio: AudioRendition[] = [];
    const subtitles: SubtitleTrack[] = [];
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      if (a.TYPE === 'SUBTITLES' && a.URI) {
        subtitles.push({ url: resolve(a.URI, baseUrl), language: a.LANGUAGE, name: a.NAME, isDefault: a.DEFAULT === 'YES', forced: a.FORCED === 'YES' });
        continue;
      }
      if (a.TYPE !== 'AUDIO') continue;
      audio.push({
        groupId: a['GROUP-ID'],
        url: a.URI ? resolve(a.URI, baseUrl) : undefined,
        isDefault: a.DEFAULT === 'YES',
        name: a.NAME,
        language: a.LANGUAGE,
      });
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const attrs = parseAttributes(lines[i].slice('#EXT-X-STREAM-INF:'.length));
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('#')) j++;
      if (j >= lines.length) break;
      const [w, h] = (attrs.RESOLUTION ?? '').split('x').map(Number);
      variants.push({
        url: resolve(lines[j], baseUrl),
        bandwidth: Number(attrs['AVERAGE-BANDWIDTH'] ?? attrs.BANDWIDTH ?? 0),
        width: w || undefined,
        height: h || undefined,
        codecs: attrs.CODECS,
        audioGroup: attrs.AUDIO,
      });
    }
    return { type: 'master', variants, audio, subtitles };
  }

  const segments: Segment[] = [];
  let sequence = 0;
  let key: Key | undefined;
  let map: Segment['map'];
  let duration = 0;
  let pendingDuration: number | null = null;
  let pendingRange: string | undefined;
  let ended = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.split(':')[1]) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      key = a.METHOD === 'NONE' ? undefined : { method: a.METHOD, url: a.URI && resolve(a.URI, baseUrl), iv: a.IV };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      map = { url: resolve(a.URI, baseUrl), byterange: a.BYTERANGE, key };
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice('#EXTINF:'.length)) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      ended = true;
    } else if (!line.startsWith('#') && pendingDuration !== null) {
      if (segments.length >= MAX_SEGMENTS) throw new Error('Playlist has too many pieces');
      segments.push({
        url: resolve(line, baseUrl),
        duration: pendingDuration,
        key,
        map,
        byterange: pendingRange,
        sequence: sequence + segments.length,
      });
      duration += pendingDuration;
      pendingDuration = null;
      pendingRange = undefined;
    }
  }
  return { type: 'media', segments, duration, ended };
}

/** The separate audio playlist a variant needs, preferring the default rendition. */
export function audioFor(master: MasterPlaylist, variant: Variant): AudioRendition | undefined {
  if (!variant.audioGroup) return undefined;
  const group = master.audio.filter((a) => a.groupId === variant.audioGroup);
  const preferred = group.find((a) => a.isDefault) ?? group[0];
  // A rendition without a URI means its audio is already inside the video stream.
  if (!preferred?.url) return undefined;
  return preferred;
}

function isAudioOnly(v: Variant) {
  return !v.height && !!v.codecs && !/avc|hvc|hev|vp0?9|av01|mp4v/i.test(v.codecs);
}

/**
 * Picks the best variant at or below `maxHeight` (the closest lower one if none
 * fit). Audio-only variants are never picked while video ones exist; when no
 * variant states its resolution, the highest bitrate wins.
 */
export function pickVariant(variants: Variant[], maxHeight = Infinity): Variant | undefined {
  const video = variants.filter((v) => !isAudioOnly(v));
  const pool = video.length ? video : variants;
  const sized = pool.filter((v) => v.height);
  if (sized.length === 0) return [...pool].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const sorted = [...sized].sort((a, b) => b.height! - a.height! || b.bandwidth - a.bandwidth);
  return sorted.find((v) => v.height! <= maxHeight) ?? sorted[sorted.length - 1];
}

export type StreamInfo = {
  /** Total duration in seconds of the best variant (or the playlist itself). */
  duration: number;
  qualities: { label: string; url: string; height?: number; bandwidth: number }[];
  /** Soft subtitle languages offered ("English", "Español"…), if any. */
  subtitles: { language?: string; name?: string }[];
  encrypted: boolean;
  /** SAMPLE-AES and other DRM-ish schemes can't be downloaded. */
  unsupportedEncryption: boolean;
};

/**
 * Fetches a playlist's text. May also return the final URL after redirects,
 * which relative links in the playlist must be resolved against.
 */
export type FetchText = (url: string) => Promise<string | { text: string; url: string }>;

export async function loadPlaylist(url: string, fetchText: FetchText): Promise<Playlist> {
  const res = await fetchText(url);
  return typeof res === 'string' ? parsePlaylist(res, url) : parsePlaylist(res.text, res.url || url);
}

/** Loads a playlist (following a master to its best variant) to describe the stream. */
export async function describeStream(url: string, fetchText: FetchText): Promise<StreamInfo> {
  let playlist = await loadPlaylist(url, fetchText);
  let qualities: StreamInfo['qualities'] = [];
  let subtitles: StreamInfo['subtitles'] = [];
  if (playlist.type === 'master') {
    subtitles = playlist.subtitles.filter((t) => !t.forced).map((t) => ({ language: t.language, name: t.name }));
    qualities = [...playlist.variants]
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)
      .map((v) => ({
        label: v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`,
        url: v.url,
        height: v.height,
        bandwidth: v.bandwidth,
      }));
    const best = pickVariant(playlist.variants);
    if (!best) throw new Error('Playlist has no streams');
    playlist = await loadPlaylist(best.url, fetchText);
    if (playlist.type !== 'media') throw new Error('Unexpected nested master playlist');
  }
  const methods = new Set(playlist.segments.map((s) => s.key?.method).filter(Boolean));
  return {
    duration: playlist.duration,
    qualities,
    subtitles,
    encrypted: methods.size > 0,
    unsupportedEncryption: [...methods].some((m) => m !== 'AES-128'),
  };
}

/** Whether a subtitle track is in the given language ("en" matches "en", "en-US", "eng", or a name like "English"). */
export function isLanguage(track: { language?: string; name?: string }, lang: string): boolean {
  const code = (track.language ?? '').toLowerCase();
  if (code === lang || code.startsWith(`${lang}-`) || (lang === 'en' && code === 'eng')) return true;
  return lang === 'en' && /\benglish\b/i.test(track.name ?? '');
}

/** The subtitle track to save for a language (full subtitles over "forced" ones), if the stream has one. */
export function pickSubtitle(tracks: SubtitleTrack[], lang = 'en'): SubtitleTrack | undefined {
  const matching = tracks.filter((t) => isLanguage(t, lang));
  return matching.find((t) => !t.forced) ?? matching[0];
}

/** For lists of found videos: "English subtitles", "subtitles: es, pt, it +6 (no English)", or null when there are none. */
export function subtitleSummary(tracks: { language?: string; name?: string }[]): string | null {
  if (tracks.length === 0) return null;
  if (tracks.some((t) => isLanguage(t, 'en'))) return 'English subtitles';
  const names = [...new Set(tracks.map((t) => t.language ?? t.name ?? '?'))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  return `subtitles: ${shown} (no English)`;
}
