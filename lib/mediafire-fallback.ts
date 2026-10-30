/**
 * The last resort for season downloads: when no server's player gives a video,
 * the episode page's downloads box often still has an English MediaFire file.
 */
import type { Found } from './batch';
import { fetchPage } from './catalog/client';
import { isEnglishDownload, parseDownloads } from './catalog/parse';
import { isMediafirePage, parseSizeText, resolveMediafire } from './mediafire';
import { USER_AGENT } from './ua';

/** The episode's English MediaFire file, or null if the page has none that works. */
export async function findMediafire(pageUrl: string): Promise<Found | null> {
  const links = parseDownloads(await fetchPage(pageUrl), pageUrl).filter((d) => isMediafirePage(d.url) && isEnglishDownload(d));
  for (const link of links) {
    try {
      const file = await resolveMediafire(link.url, USER_AGENT);
      return {
        candidate: { url: file.url, kind: 'file', frame: link.url, via: 'mediafire' },
        result: { status: 'ok', kind: 'file', size: parseSizeText(file.sizeText), contentType: 'video/mp4' },
      };
    } catch {
      // Removed or unreachable: try the next one.
    }
  }
  return null;
}
