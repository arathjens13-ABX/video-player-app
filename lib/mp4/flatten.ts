/**
 * Turns fragmented MP4 (an init segment plus moof/mdat fragments, which is
 * what HLS streams carry) into one ordinary MP4 file with full sample tables,
 * so it plays and seeks offline in any player.
 *
 * Several init segments can be added (e.g. video and audio served as separate
 * HLS renditions); their tracks end up side by side in the output, kept in sync
 * with edit lists.
 *
 * Output layout: ftyp, mdat (sample data, written as fragments arrive), moov.
 */
import { Writer, box, child, children, fourcc, fullBox, path, readBoxes, readI32, readU32, readU64, type Box } from './boxes';

export interface OutputSink {
  /** Bytes written so far; the offset the next write lands at. */
  readonly position: number;
  write(bytes: Uint8Array): void;
  writeAt(offset: number, bytes: Uint8Array): void;
}

type Trex = { duration: number; size: number; flags: number };

type Track = {
  outId: number;
  handler: string;
  timescale: number;
  language: number;
  width: number;
  height: number;
  /** Raw source boxes copied as-is into the output. */
  hdlr: Uint8Array;
  mediaHeader: Uint8Array | null;
  dinf: Uint8Array | null;
  stsd: Uint8Array;
  trex: Trex;
  // Sample tables, built as fragments arrive.
  sizes: number[];
  stts: [number, number][];
  ctts: [number, number][];
  hasCtts: boolean;
  negativeCtts: boolean;
  sync: number[];
  allSync: boolean;
  chunks: { offset: number; count: number }[];
  duration: number;
  firstDts: number | null;
  minCts: number;
  /** End of the last frame on the composition timeline (relative to the first decode time). */
  maxCtsEnd: number;
  /** From the source's edit list: where presentation starts (media time) and any initial delay (seconds). */
  srcMediaTime: number | null;
  srcDelaySec: number;
};

const NON_SYNC = 0x10000;

function pushRle(list: [number, number][], value: number) {
  const last = list[list.length - 1];
  if (last && last[1] === value) last[0]++;
  else list.push([1, value]);
}

export class FlatMp4Writer {
  private tracks = new Map<string, Track>(); // `${stream}:${sourceTrackId}`
  private order: Track[] = [];
  private mdatStart = 0;
  private started = false;

  constructor(private sink: OutputSink) {}

  /** Registers the tracks of an init segment. Adding the same stream again is ignored. */
  addInit(stream: string, init: Uint8Array) {
    if (this.order.length > 0 && [...this.tracks.keys()].some((k) => k.startsWith(stream + ':'))) return;
    const moov = readBoxes(init).find((b) => b.type === 'moov');
    if (!moov) throw new Error('Init segment has no moov box');
    const trexById = new Map<number, Trex>();
    const mvex = child(init, moov, 'mvex');
    if (mvex) {
      for (const t of children(init, mvex, 'trex')) {
        const o = t.dataStart + 4;
        trexById.set(readU32(init, o), {
          duration: readU32(init, o + 8),
          size: readU32(init, o + 12),
          flags: readU32(init, o + 16),
        });
      }
    }
    for (const trak of children(init, moov, 'trak')) {
      const tkhd = child(init, trak, 'tkhd');
      const mdhd = path(init, trak, ['mdia', 'mdhd']);
      const hdlr = path(init, trak, ['mdia', 'hdlr']);
      const minf = path(init, trak, ['mdia', 'minf']);
      const stsd = minf && path(init, minf, ['stbl', 'stsd']);
      if (!tkhd || !mdhd || !hdlr || !minf || !stsd) throw new Error('Init segment track is incomplete');

      const tkhdV = init[tkhd.dataStart];
      const trackId = readU32(init, tkhd.dataStart + (tkhdV === 1 ? 20 : 12));
      const mdhdV = init[mdhd.dataStart];
      const timescale = readU32(init, mdhd.dataStart + (mdhdV === 1 ? 20 : 12));
      const language = (init[mdhd.dataStart + (mdhdV === 1 ? 32 : 20)] << 8) | init[mdhd.dataStart + (mdhdV === 1 ? 33 : 21)];
      const handler = fourcc(init, hdlr.dataStart + 8);
      const sampleEntry = fourcc(init, stsd.dataStart + 8 + 4);
      if (/^(encv|enca|encs)$/.test(sampleEntry)) throw new Error('This stream is DRM-protected and can’t be downloaded');

      const { mediaTime: srcMediaTime, delaySec: srcDelaySec } = readEditList(init, moov, trak);
      const mediaHeader = readBoxes(init, minf.dataStart, minf.end).find((b) => /^(vmhd|smhd|sthd|nmhd)$/.test(b.type));
      const dinf = child(init, minf, 'dinf');
      const outId = this.order.length + 1;
      const track: Track = {
        outId,
        handler,
        timescale,
        language,
        width: readU32(init, tkhd.end - 8),
        height: readU32(init, tkhd.end - 4),
        hdlr: init.slice(hdlr.start, hdlr.end),
        mediaHeader: mediaHeader ? init.slice(mediaHeader.start, mediaHeader.end) : null,
        dinf: dinf ? init.slice(dinf.start, dinf.end) : null,
        stsd: init.slice(stsd.start, stsd.end),
        trex: trexById.get(trackId) ?? { duration: 0, size: 0, flags: 0 },
        sizes: [],
        stts: [],
        ctts: [],
        hasCtts: false,
        negativeCtts: false,
        sync: [],
        allSync: true,
        chunks: [],
        duration: 0,
        firstDts: null,
        minCts: Infinity,
        maxCtsEnd: 0,
        srcMediaTime,
        srcDelaySec,
      };
      this.tracks.set(`${stream}:${trackId}`, track);
      this.order.push(track);
    }
  }

  private start() {
    if (this.started) return;
    this.started = true;
    const brands = ['isom', 'iso2', 'avc1', 'mp41'];
    const ftyp = new Writer().str('isom').u32(512);
    brands.forEach((b) => ftyp.str(b));
    this.sink.write(box('ftyp', ftyp.result()));
    this.mdatStart = this.sink.position;
    // 64-bit mdat header; the size is patched in finish().
    this.sink.write(new Writer().u32(1).str('mdat').u64(0).result());
  }

  /** Adds media fragments (any number of moof/mdat pairs, plus styp/sidx which are skipped). */
  addFragments(stream: string, data: Uint8Array) {
    this.start();
    for (const moof of readBoxes(data).filter((b) => b.type === 'moof')) this.addMoof(stream, data, moof);
  }

  private addMoof(stream: string, b: Uint8Array, moof: Box) {
    let implicitBase = moof.start;
    for (const traf of children(b, moof, 'traf')) {
      const tfhd = child(b, traf, 'tfhd');
      if (!tfhd) continue;
      const flags = readU32(b, tfhd.dataStart) & 0xffffff;
      const trackId = readU32(b, tfhd.dataStart + 4);
      const track = this.tracks.get(`${stream}:${trackId}`);
      if (!track) throw new Error(`Fragment for unknown track ${trackId}`);
      let o = tfhd.dataStart + 8;
      let base = flags & 0x20000 ? moof.start : implicitBase;
      if (flags & 0x1) {
        base = readU64(b, o);
        o += 8;
      }
      if (flags & 0x2) o += 4;
      let defDuration = track.trex.duration;
      let defSize = track.trex.size;
      let defFlags = track.trex.flags;
      if (flags & 0x8) (defDuration = readU32(b, o)), (o += 4);
      if (flags & 0x10) (defSize = readU32(b, o)), (o += 4);
      if (flags & 0x20) (defFlags = readU32(b, o)), (o += 4);

      const tfdt = child(b, traf, 'tfdt');
      let dts = 0;
      if (tfdt) dts = b[tfdt.dataStart] === 1 ? readU64(b, tfdt.dataStart + 4) : readU32(b, tfdt.dataStart + 4);
      if (track.firstDts === null) track.firstDts = dts;
      // Decode time relative to the track's start, for composition-time bookkeeping.
      let relDts = track.duration;

      let dataPos = base;
      for (const trun of children(b, traf, 'trun')) {
        const version = b[trun.dataStart];
        const tf = readU32(b, trun.dataStart) & 0xffffff;
        const count = readU32(b, trun.dataStart + 4);
        let p = trun.dataStart + 8;
        if (tf & 0x1) (dataPos = base + readI32(b, p)), (p += 4);
        let firstFlags: number | null = null;
        if (tf & 0x4) (firstFlags = readU32(b, p)), (p += 4);

        const runStart = dataPos;
        let runBytes = 0;
        for (let i = 0; i < count; i++) {
          const duration = tf & 0x100 ? readU32(b, (p += 4) - 4) : defDuration;
          const size = tf & 0x200 ? readU32(b, (p += 4) - 4) : defSize;
          let sampleFlags = tf & 0x400 ? readU32(b, (p += 4) - 4) : defFlags;
          if (i === 0 && firstFlags !== null) sampleFlags = firstFlags;
          let cto = 0;
          if (tf & 0x800) cto = version === 0 ? readU32(b, (p += 4) - 4) : readI32(b, (p += 4) - 4);

          track.sizes.push(size);
          pushRle(track.stts, duration);
          pushRle(track.ctts, cto);
          if (cto !== 0) track.hasCtts = true;
          if (cto < 0) track.negativeCtts = true;
          if (relDts + cto < track.minCts) track.minCts = relDts + cto;
          if (relDts + cto + duration > track.maxCtsEnd) track.maxCtsEnd = relDts + cto + duration;
          if (sampleFlags & NON_SYNC) track.allSync = false;
          else track.sync.push(track.sizes.length);
          track.duration += duration;
          relDts += duration;
          runBytes += size;
        }
        if (runStart + runBytes > b.length) throw new Error('Fragment is truncated');
        if (count > 0) {
          track.chunks.push({ offset: this.sink.position, count });
          this.sink.write(b.subarray(runStart, runStart + runBytes));
        }
        dataPos = runStart + runBytes;
      }
      implicitBase = dataPos;
    }
  }

  /** Writes the moov box. Returns the total duration in seconds. */
  finish(): number {
    this.start();
    const mdatSize = this.sink.position - this.mdatStart;
    this.sink.writeAt(this.mdatStart + 8, new Writer().u64(mdatSize).result());

    const movieTimescale = 1000;
    const tracks = this.order.filter((t) => t.sizes.length > 0);
    if (tracks.length === 0) throw new Error('No media was written');
    // Align tracks by when their first frame is shown, not decoded (with B-frames, video decodes ahead of
    // display), honouring the source's edit lists, which is how fMP4 streams line audio up with video.
    const startSec = (t: Track) => {
      const firstDts = t.firstDts ?? 0;
      const absoluteStart = firstDts + mediaStart(t);
      return t.srcDelaySec + (absoluteStart - (t.srcMediaTime ?? 0)) / t.timescale;
    };
    const earliest = Math.min(...tracks.map(startSec));
    let movieDuration = 0;
    const traks = tracks.map((t, i) => {
      const delay = Math.round((startSec(t) - earliest) * movieTimescale);
      // Shown from the edit's start to the end of the last frame (which, with B-frames, is after the last decode).
      const presented = Math.round(((Math.max(t.maxCtsEnd, t.duration) - mediaStart(t)) / t.timescale) * movieTimescale);
      movieDuration = Math.max(movieDuration, delay + presented);
      return this.trak(t, i + 1, delay, presented);
    });

    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      new Writer()
        .u32(0)
        .u32(0)
        .u32(movieTimescale)
        .u32(movieDuration)
        .u32(0x00010000) // rate 1.0
        .u16(0x0100) // volume 1.0
        .zeros(10)
        .bytes(matrix())
        .zeros(24)
        .u32(tracks.length + 1)
        .result()
    );
    this.sink.write(box('moov', mvhd, ...traks));
    return movieDuration / movieTimescale;
  }

  private trak(t: Track, id: number, delay: number, presented: number) {
    const isAudio = t.handler === 'soun';
    const tkhd = fullBox(
      'tkhd',
      0,
      0x3,
      new Writer()
        .u32(0)
        .u32(0)
        .u32(id)
        .u32(0)
        .u32(delay + presented)
        .zeros(8)
        .u16(0)
        .u16(0)
        .u16(isAudio ? 0x0100 : 0)
        .u16(0)
        .bytes(matrix())
        .u32(t.width)
        .u32(t.height)
        .result()
    );

    const elst = new Writer();
    const entries: [number, number][] = [];
    if (delay > 0) entries.push([delay, -1]);
    entries.push([presented, mediaStart(t)]);
    elst.u32(entries.length);
    for (const [duration, mediaTime] of entries) elst.u32(duration).u32(mediaTime >>> 0).u32(0x00010000);
    const edts = box('edts', fullBox('elst', 0, 0, elst.result()));

    const mdhd = fullBox(
      'mdhd',
      1,
      0,
      new Writer().u64(0).u64(0).u32(t.timescale).u64(t.duration).u16(t.language).u16(0).result()
    );

    const stbl = box('stbl', t.stsd, this.stts(t), ...this.optional(t), this.stsc(t), this.stsz(t), this.chunkOffsets(t));
    const dinf = t.dinf ?? box('dinf', fullBox('dref', 0, 0, new Writer().u32(1).result(), fullBox('url ', 0, 1)));
    const minf = box('minf', ...(t.mediaHeader ? [t.mediaHeader] : []), dinf, stbl);
    return box('trak', tkhd, edts, box('mdia', mdhd, t.hdlr, minf));
  }

  private stts(t: Track) {
    const w = new Writer().u32(t.stts.length);
    for (const [count, delta] of t.stts) w.u32(count).u32(delta);
    return fullBox('stts', 0, 0, w.result());
  }

  private optional(t: Track) {
    const out: Uint8Array[] = [];
    if (t.hasCtts) {
      const w = new Writer().u32(t.ctts.length);
      for (const [count, offset] of t.ctts) w.u32(count).u32(offset >>> 0);
      out.push(fullBox('ctts', t.negativeCtts ? 1 : 0, 0, w.result()));
    }
    if (!t.allSync) {
      const w = new Writer().u32(t.sync.length);
      for (const n of t.sync) w.u32(n);
      out.push(fullBox('stss', 0, 0, w.result()));
    }
    return out;
  }

  private stsc(t: Track) {
    const rows: [number, number][] = []; // [first chunk, samples per chunk]
    t.chunks.forEach((c, i) => {
      if (rows.length === 0 || rows[rows.length - 1][1] !== c.count) rows.push([i + 1, c.count]);
    });
    const w = new Writer().u32(rows.length);
    for (const [first, count] of rows) w.u32(first).u32(count).u32(1);
    return fullBox('stsc', 0, 0, w.result());
  }

  private stsz(t: Track) {
    const w = new Writer().u32(0).u32(t.sizes.length);
    for (const s of t.sizes) w.u32(s);
    return fullBox('stsz', 0, 0, w.result());
  }

  private chunkOffsets(t: Track) {
    const large = t.chunks.some((c) => c.offset > 0xffffffff);
    const w = new Writer().u32(t.chunks.length);
    for (const c of t.chunks) (large ? w.u64(c.offset) : w.u32(c.offset));
    return fullBox(large ? 'co64' : 'stco', 0, 0, w.result());
  }
}

/** Media time (relative to the track's first decode time) at which presentation starts. */
function mediaStart(t: Track) {
  if (t.srcMediaTime !== null) return Math.max(0, t.srcMediaTime - (t.firstDts ?? 0));
  return t.minCts === Infinity ? 0 : Math.max(0, t.minCts);
}

/** Reads a source track's edit list: initial empty edits and the first media time. */
function readEditList(b: Uint8Array, moov: Box, trak: Box): { mediaTime: number | null; delaySec: number } {
  const elst = path(b, trak, ['edts', 'elst']);
  const mvhd = child(b, moov, 'mvhd');
  if (!elst || !mvhd) return { mediaTime: null, delaySec: 0 };
  const movieTimescale = readU32(b, mvhd.dataStart + (b[mvhd.dataStart] === 1 ? 20 : 12)) || 1000;
  const v = b[elst.dataStart];
  const count = readU32(b, elst.dataStart + 4);
  let delay = 0;
  for (let i = 0; i < count; i++) {
    const o = elst.dataStart + 8 + i * (v === 1 ? 20 : 12);
    const duration = v === 1 ? readU64(b, o) : readU32(b, o);
    const mediaTime = v === 1 ? readI32(b, o + 12) : readI32(b, o + 4);
    if (mediaTime === -1) delay += duration;
    else return { mediaTime, delaySec: delay / movieTimescale };
  }
  return { mediaTime: null, delaySec: delay / movieTimescale };
}

function matrix() {
  return new Writer()
    .u32(0x00010000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0x00010000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0x40000000)
    .result();
}
