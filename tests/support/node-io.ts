/// <reference types="node" />
// Node implementations of the storage interfaces, for tests and local tools.
import fs from 'node:fs';
import path from 'node:path';

import type { FetchBytes, PartStore } from '../../lib/hls-download';
import type { OutputSink } from '../../lib/mp4/flatten';

export class DirStore implements PartStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  has(name: string) {
    return fs.existsSync(path.join(this.dir, name));
  }
  write(name: string, bytes: Uint8Array) {
    // Write then rename, like the app does, so a crash never leaves a half part.
    const tmp = path.join(this.dir, name + '.tmp');
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, path.join(this.dir, name));
  }
  read(name: string) {
    return new Uint8Array(fs.readFileSync(path.join(this.dir, name)));
  }
  remove(name: string) {
    fs.rmSync(path.join(this.dir, name), { force: true });
  }
  size(name: string) {
    return fs.statSync(path.join(this.dir, name)).size;
  }
}

export class FileSink implements OutputSink {
  private fd: number;
  position = 0;
  constructor(file: string) {
    this.fd = fs.openSync(file, 'w');
  }
  write(bytes: Uint8Array) {
    fs.writeSync(this.fd, bytes, 0, bytes.length, this.position);
    this.position += bytes.length;
  }
  writeAt(offset: number, bytes: Uint8Array) {
    fs.writeSync(this.fd, bytes, 0, bytes.length, offset);
  }
  close() {
    fs.closeSync(this.fd);
  }
}

export const nodeFetchBytes: FetchBytes = async (url, headers, signal) => {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};
