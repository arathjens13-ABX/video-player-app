/**
 * Sites Discover knows how to read: all built on the same WordPress theme, so
 * one set of parsers (lib/catalog/parse.ts) covers them.
 */
import { baseDomain } from '../browser';
import { URL } from '../url';

export type Site = {
  id: string;
  name: string;
  /** Home page, with a trailing slash. */
  base: string;
  /** Whether /schedule/ lists shows in the page itself (some fill it in with scripts). */
  schedule: boolean;
};

export const SITES: Site[] = [
  { id: 'animexin', name: 'AnimeXin', base: 'https://animexin.dev/', schedule: true },
  { id: 'donghuastream', name: 'Donghua Stream', base: 'https://donghuastream.org/', schedule: false },
  { id: 'luciferdonghua', name: 'Lucifer Donghua', base: 'https://luciferdonghua.in/', schedule: false },
  { id: 'animekhor', name: 'AnimeKhor', base: 'https://animekhor.org/', schedule: false },
];

export function siteById(id: string | null | undefined): Site {
  return SITES.find((s) => s.id === id) ?? SITES[0];
}

/** The known site a link belongs to, if any. */
export function siteForUrl(url: string): Site | null {
  try {
    const domain = baseDomain(new URL(url).hostname);
    return SITES.find((s) => baseDomain(new URL(s.base).hostname) === domain) ?? null;
  } catch {
    return null;
  }
}

export const searchUrl = (site: Site, query: string, page = 1) =>
  `${site.base}${page > 1 ? `page/${page}/` : ''}?s=${encodeURIComponent(query.trim())}`;

export const ongoingUrl = (site: Site, page = 1) => `${site.base}anime/?status=ongoing&order=update${page > 1 ? `&page=${page}` : ''}`;

export const scheduleUrl = (site: Site) => `${site.base}schedule/`;
