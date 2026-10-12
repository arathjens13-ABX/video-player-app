// expo-file-system implementations of the stream downloader's storage interfaces.
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';

import type { FetchBytes, PartStore } from './hls-download';
import type { OutputSink } from './mp4/flatten';

/** Pieces of a stream download, kept in Documents so iOS doesn't purge them mid-download. */
export function partsDir(episodeId: number) {
  return new Directory(Paths.document, 'parts', String(episodeId));
}

export class FilePartStore implements PartStore {
  constructor(private dir: Directory) {
    dir.create({ intermediates: true, idempotent: true });
  }

  has(name: string) {
    return new File(this.dir, name).exists;
  }

  write(name: string, bytes: Uint8Array) {
    // Write under a temporary name and rename, so a crash never leaves a half-written piece that looks done.
    const tmp = new File(this.dir, `${name}.tmp`);
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.write(bytes);
    tmp.rename(name);
  }

  read(name: string) {
    return new File(this.dir, name).bytesSync();
  }

  remove(name: string) {
    const file = new File(this.dir, name);
    if (file.exists) file.delete();
  }

  size(name: string) {
    return new File(this.dir, name).size ?? 0;
  }

  /**
   * Makes sure the parts here belong to the plan with this fingerprint: keeps
   * them if they do, otherwise empties the folder. Then records the fingerprint.
   */
  prepare(fingerprint: string) {
    const marker = new File(this.dir, 'plan.txt');
    if (marker.exists && marker.textSync() === fingerprint) return;
    for (const entry of this.dir.list()) entry.delete();
    marker.create();
    marker.write(fingerprint);
  }
}

export class FileSink implements OutputSink {
  private handle: FileHandle;
  position = 0;

  constructor(file: File) {
    if (file.exists) file.delete();
    file.create({ intermediates: true });
    this.handle = file.open(FileMode.ReadWrite);
  }

  write(bytes: Uint8Array) {
    this.handle.offset = this.position;
    this.handle.writeBytes(bytes);
    this.position += bytes.length;
  }

  writeAt(offset: number, bytes: Uint8Array) {
    this.handle.offset = offset;
    this.handle.writeBytes(bytes);
  }

  close() {
    this.handle.close();
  }
}

export const fetchBytes: FetchBytes = async (url, headers, signal) => {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export function fetchText(headers: Record<string, string>, signal?: AbortSignal) {
  return async (url: string) => {
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`The server answered ${res.status}`);
    return res.text();
  };
}
