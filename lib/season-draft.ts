import Storage from 'expo-sqlite/kv-store';

import type { ListedEpisode } from './detector-messages';

/**
 * The season the Browser hands to the "Download several" screen. Too big for
 * route params, and only ever one at a time.
 */
export type SeasonDraft = {
  listUrl: string;
  episodes: ListedEpisode[];
  /** The server the user last switched to on this site, by its label in the mirror picker. */
  server: string | null;
};

let draft: SeasonDraft | null = null;

export function setSeasonDraft(d: SeasonDraft) {
  draft = d;
}

export function getSeasonDraft(): SeasonDraft | null {
  return draft;
}

const SERVER_KEY = 'batch.server.';

/** Remembers the server last picked on a site ("animexin.dev"), for its season downloads. */
export function rememberServer(site: string, label: string) {
  try {
    Storage.setItemSync(SERVER_KEY + site, label);
  } catch {
    // Not remembered; season downloads use the page default.
  }
}

export function preferredServer(site: string): string | null {
  try {
    return Storage.getItemSync(SERVER_KEY + site);
  } catch {
    return null;
  }
}
