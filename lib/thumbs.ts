import { Directory, File, Paths } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import type { Episode } from './db';

export const thumbsDir = new Directory(Paths.document, 'thumbs');

export function thumbFile(id: number) {
  return new File(thumbsDir, `${id}.jpg`);
}

const pending = new Map<number, Promise<boolean>>();
// One at a time: opening a big library shouldn't decode dozens of videos at once.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Makes a still for the library from the downloaded video, about 15% in (past
 * most intros). Resolves true once the thumbnail exists.
 */
export function ensureThumbnail(episode: Pick<Episode, 'id' | 'durationSec'>, videoUri: string): Promise<boolean> {
  const target = thumbFile(episode.id);
  if (target.exists) return Promise.resolve(true);
  let p = pending.get(episode.id);
  if (p) return p;
  p = chain.then(async () => {
    if (target.exists) return true;
    const preferred = episode.durationSec > 0 ? Math.min(episode.durationSec * 0.15, 90) * 1000 : 20000;
    for (const time of [preferred, 1000]) {
      try {
        const { uri } = await getThumbnailAsync(videoUri, { time, quality: 0.6 });
        thumbsDir.create({ idempotent: true, intermediates: true });
        if (target.exists) target.delete();
        await new File(uri).move(target);
        return true;
      } catch {
        // Too far in for a short video, or an unreadable frame: try the start.
      }
    }
    return false;
  });
  chain = p.catch(() => {});
  p = p.finally(() => pending.delete(episode.id));
  pending.set(episode.id, p);
  return p;
}

export function deleteThumbnail(id: number) {
  try {
    const f = thumbFile(id);
    if (f.exists) f.delete();
  } catch {
    // Orphans are removed by the file cleanup.
  }
}
