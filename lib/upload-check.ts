/**
 * Quick checks that a mirror's upload still exists, so the season finder can
 * skip removed videos at once instead of waiting out its timeout on them.
 */
import { dailymotionId, dailymotionProblem } from './finder';

const CHECK_TIMEOUT_MS = 8_000;

/** Why the server's video won't play ("removed by Dailymotion"), or null if it may well play. */
export async function uploadProblem(serverUrl: string): Promise<string | null> {
  const id = dailymotionId(serverUrl);
  if (!id) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(id)}`, { signal: controller.signal });
    if (!res.ok) return null;
    return dailymotionProblem(await res.json());
  } catch {
    // Can't tell: let the player try.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
