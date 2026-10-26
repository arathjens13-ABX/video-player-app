/// <reference types="node" />
/**
 * Streams come from servers we don't control. Corrupt or hostile pieces must
 * fail with an ordinary error, quickly, and never hang or exhaust memory.
 * Includes the two cases found by fuzzing, and a small fixed-seed fuzz run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { allParts, assemble, planStream, type PartStore } from '../lib/hls-download';
import { readBoxes } from '../lib/mp4/boxes';
import { FlatMp4Writer, type OutputSink } from '../lib/mp4/flatten';
import { TsToFmp4 } from '../lib/mp4/transmux';

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (p: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, p)));

function nullSink(): OutputSink & { position: number } {
  return { position: 0, write(b: Uint8Array) { this.position += b.length; }, writeAt() {} };
}

test('an AAC frame claiming length 0 is skipped, not looped on forever (mux.js patch)', () => {
  const ts = read('ts-switch/a0.ts');
  // An ADTS header inside the audio whose 13-bit frame length is zeroed.
  ts.set([0, 0, 0], 29740);
  const t0 = Date.now();
  new TsToFmp4().push(ts);
  assert.ok(Date.now() - t0 < 2000, 'should not stall');
});

test('a fragment whose sample count overruns its table fails fast', () => {
  const seg = read('fmp4-split/video/seg0.m4s');
  const moof = readBoxes(seg).find((b) => b.type === 'moof')!;
  const traf = readBoxes(seg, moof.dataStart, moof.end).find((b) => b.type === 'traf')!;
  const trun = readBoxes(seg, traf.dataStart, traf.end).find((b) => b.type === 'trun')!;
  new DataView(seg.buffer).setUint32(trun.dataStart + 4, 0xfffffff0);
  const writer = new FlatMp4Writer(nullSink());
  writer.addInit('video', read('fmp4-split/video/init_0.mp4'));
  const t0 = Date.now();
  assert.throws(() => writer.addFragments('video', seg), /corrupt/);
  assert.ok(Date.now() - t0 < 500);
});

test('fuzz: corrupted pieces never hang the assembler', { timeout: 120_000 }, async () => {
  let seed = 20261026;
  const ri = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  for (const name of ['fmp4-split/master.m3u8', 'ts-ranges/index.m3u8', 'ts-switch/index.m3u8']) {
    const plan = await planStream(`https://cdn.test/${name}`, async (u) => new TextDecoder().decode(read(new URL(u).pathname)));
    const original = new Map<string, Uint8Array>();
    for (const p of allParts(plan)) {
      const b = read(new URL(p.url).pathname);
      original.set(p.name, p.range ? b.slice(p.range.offset, p.range.offset + p.range.length) : b);
    }
    for (let i = 0; i < 60; i++) {
      const parts = new Map(original);
      const names = [...parts.keys()];
      const target = names[ri(names.length)];
      const bytes = new Uint8Array(parts.get(target)!);
      const kind = ri(3);
      if (kind === 0) for (let k = 0; k < 8; k++) bytes[ri(bytes.length)] = ri(256);
      else if (kind === 1) for (let k = 0; k < 3; k++) bytes.fill(ri(2) ? 0 : 0xff, ri(bytes.length), ri(bytes.length) + 4);
      parts.set(target, kind === 2 ? bytes.slice(0, ri(bytes.length)) : bytes);
      const store: PartStore = {
        has: (n) => parts.has(n),
        write: (n, d) => void parts.set(n, d),
        read: (n) => parts.get(n)!,
        remove: (n) => void parts.delete(n),
        size: (n) => parts.get(n)?.length ?? 0,
      };
      const t0 = Date.now();
      await assemble(plan, store, nullSink()).catch((e: unknown) => assert.ok(e instanceof Error, `${name} #${i}: threw a non-Error`));
      assert.ok(Date.now() - t0 < 5000, `${name} #${i}: took ${Date.now() - t0} ms`);
    }
  }
});
