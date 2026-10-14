import Constants from 'expo-constants';
import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { listEpisodes } from './db';
import { formatBytes } from './format';
import { hostOf } from './links';
import { formatEntry, getLogEntries } from './log';

/** Commit the app was built from (set by CI), to match a report to the code. */
export const BUILD = process.env.EXPO_PUBLIC_BUILD ?? 'dev';

/** A plain-text report to paste into a message: app and phone details, downloads, recent log. */
export function buildReport(): string {
  const lines: string[] = [];
  let free = '?';
  try {
    free = formatBytes(Paths.availableDiskSpace);
  } catch {
    // Unknown on this platform.
  }
  lines.push('VidStash diagnostics');
  lines.push(`App ${Constants.expoConfig?.version ?? '?'} (build ${BUILD.slice(0, 7)})`);
  lines.push(`${Platform.OS} ${String(Platform.Version)} · free space ${free}`);
  lines.push(`Report made ${new Date().toISOString()}`);

  const episodes = listEpisodes();
  const byStatus = new Map<string, number>();
  for (const e of episodes) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  lines.push('', `Downloads: ${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}`);
  for (const e of episodes.filter((x) => x.status !== 'done')) {
    lines.push(`- #${e.id} ${e.status} ${e.kind} ${hostOf(e.sourceUrl)} "${e.show} · ${e.title}"${e.error ? ` — ${e.error}` : ''}`);
  }

  const entries = getLogEntries();
  lines.push('', `Log (last ${entries.length} entries):`);
  for (const entry of entries) lines.push(formatEntry(entry));
  return lines.join('\n');
}
