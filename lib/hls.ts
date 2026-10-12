/** Minimal HLS (.m3u8) parsing: enough to pick a quality, total the duration and list segments. */

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

export type Key = { method: 'NONE' | 'AES-128' | 'SAMPLE-AES' | string; url?: string; iv?: string };

export type Segment = {
  url: string;
  duration: number;
  key?: Key;
  /** EXT-X-MAP init section (fMP4 streams). */
  map?: { url: string; byterange?: string };
  byterange?: string;
  /** Media sequence number, used as the default AES IV. */
  sequence: number;
};

export type MasterPlaylist = { type: 'master'; variants: Variant[]; audio: AudioRendition[] };
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

export function parsePlaylist(text: string, baseUrl: string): Playlist {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('Not an HLS playlist');

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: Variant[] = [];
    const audio: AudioRendition[] = [];
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
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
    return { type: 'master', variants, audio };
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
      map = { url: resolve(a.URI, baseUrl), byterange: a.BYTERANGE };
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice('#EXTINF:'.length)) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      ended = true;
    } else if (!line.startsWith('#') && pendingDuration !== null) {
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
  const group = master.audio.filter((a) => a.groupId === variant.audioGroup && a.url);
  return group.find((a) => a.isDefault) ?? group[0];
}

/** Picks the highest quality variant, optionally capped at a maximum height. */
export function pickVariant(variants: Variant[], maxHeight = Infinity): Variant | undefined {
  const sorted = [...variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
  return sorted.find((v) => (v.height ?? 0) <= maxHeight) ?? sorted[sorted.length - 1];
}

export type StreamInfo = {
  /** Total duration in seconds of the best variant (or the playlist itself). */
  duration: number;
  qualities: { label: string; url: string; height?: number; bandwidth: number }[];
  encrypted: boolean;
  /** SAMPLE-AES and other DRM-ish schemes can't be downloaded. */
  unsupportedEncryption: boolean;
};

type Fetcher = (url: string) => Promise<string>;

/** Loads a playlist (following a master to its best variant) to describe the stream. */
export async function describeStream(url: string, fetchText: Fetcher): Promise<StreamInfo> {
  let playlist = parsePlaylist(await fetchText(url), url);
  let qualities: StreamInfo['qualities'] = [];
  if (playlist.type === 'master') {
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
    playlist = parsePlaylist(await fetchText(best.url), best.url);
    if (playlist.type !== 'media') throw new Error('Unexpected nested master playlist');
  }
  const methods = new Set(playlist.segments.map((s) => s.key?.method).filter(Boolean));
  return {
    duration: playlist.duration,
    qualities,
    encrypted: methods.size > 0,
    unsupportedEncryption: [...methods].some((m) => m !== 'AES-128'),
  };
}
