import Storage from 'expo-sqlite/kv-store';

import { sameSite } from './browser';

export type RecentSite = { url: string; title: string };
const RECENT_KEY = 'browser.recent';
const MAX_RECENT = 8;

export function loadRecent(): RecentSite[] {
  try {
    const raw = Storage.getItemSync(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentSite[]) : [];
  } catch {
    return [];
  }
}

/** Remembers the last page visited on each site. */
export function rememberVisit(url: string, title: string) {
  if (!/^https?:/i.test(url)) return;
  const list = loadRecent().filter((r) => !sameSite(r.url, url));
  list.unshift({ url, title: title || new URL(url).hostname });
  try {
    Storage.setItemSync(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // Not worth interrupting browsing over.
  }
}
