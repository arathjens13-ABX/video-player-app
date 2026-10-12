/** ISO BMFF (MP4) box reading and writing helpers. */

export type Box = {
  type: string;
  /** Offset of the box header within the buffer it was read from. */
  start: number;
  /** Offset of the box payload (after the header). */
  dataStart: number;
  end: number;
};

export function fourcc(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function readU32(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function readI32(b: Uint8Array, o: number) {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

export function readU64(b: Uint8Array, o: number) {
  return readU32(b, o) * 2 ** 32 + readU32(b, o + 4);
}

/** Lists the boxes between `start` and `end` (one level, no recursion). */
export function readBoxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const boxes: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = readU32(b, o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = readU64(b, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) break; // truncated or corrupt: stop rather than misread
    boxes.push({ type, start: o, dataStart: o + header, end: o + size });
    o += size;
  }
  return boxes;
}

export function child(b: Uint8Array, parent: Box, type: string): Box | undefined {
  return readBoxes(b, parent.dataStart, parent.end).find((x) => x.type === type);
}

export function children(b: Uint8Array, parent: Box, type: string): Box[] {
  return readBoxes(b, parent.dataStart, parent.end).filter((x) => x.type === type);
}

/** Follows a path like ['mdia', 'minf', 'stbl'] from `parent`. */
export function path(b: Uint8Array, parent: Box, types: string[]): Box | undefined {
  let cur: Box | undefined = parent;
  for (const t of types) {
    if (!cur) return undefined;
    cur = child(b, cur, t);
  }
  return cur;
}

/** Growable big-endian byte writer. */
export class Writer {
  private buf = new Uint8Array(256);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number) {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u16(v: number) {
    return this.u8(v >>> 8).u8(v);
  }

  u32(v: number) {
    this.ensure(4);
    this.buf[this.length++] = (v >>> 24) & 0xff;
    this.buf[this.length++] = (v >>> 16) & 0xff;
    this.buf[this.length++] = (v >>> 8) & 0xff;
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u64(v: number) {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0);
  }

  str(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }

  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  zeros(n: number) {
    this.ensure(n);
    this.buf.fill(0, this.length, this.length + n);
    this.length += n;
    return this;
  }

  result() {
    return this.buf.slice(0, this.length);
  }
}

/** Builds a box from a type and payload parts. */
export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const w = new Writer().u32(size).str(type);
  for (const p of parts) w.bytes(p);
  return w.result();
}

/** A "full box": version and flags, then the payload. */
export function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  const head = new Writer().u8(version).u8(flags >>> 16).u16(flags & 0xffff).result();
  return box(type, head, ...parts);
}
