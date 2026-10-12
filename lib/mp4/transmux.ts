import { Transmuxer, type TransmuxedSegment } from 'mux.js/cjs/mp4/transmuxer';

/**
 * Converts MPEG-TS segments (the classic HLS format) into fragmented MP4, one
 * segment at a time. One instance per stream keeps timestamps continuous.
 */
export class TsToFmp4 {
  private transmuxer = new Transmuxer({ remux: true, keepOriginalTimestamps: true });
  private out: TransmuxedSegment[] = [];

  constructor() {
    this.transmuxer.on('data', (segment) => {
      // mux.js reuses buffers between events; copy what we keep.
      this.out.push({ ...segment, initSegment: segment.initSegment.slice(), data: segment.data.slice() });
    });
  }

  /** Returns the init segment and fragments produced from this TS segment. */
  push(ts: Uint8Array): { init: Uint8Array; data: Uint8Array }[] {
    this.out = [];
    this.transmuxer.push(ts);
    this.transmuxer.flush();
    return this.out.map((s) => ({ init: s.initSegment, data: s.data }));
  }
}
