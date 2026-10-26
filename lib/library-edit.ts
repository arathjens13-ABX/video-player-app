import { renameShowCover } from './covers';
import { batch, db, listEpisodes, updateEpisode } from './db';
import { renamedShow, showKey, type Season } from './library';
import { logInfo } from './log';

/**
 * Renames a series: every season keeps its number under the new name. Giving
 * it another series' name merges the two (their seasons and episodes combine).
 */
export function renameSeries(seasons: Pick<Season<unknown>, 'show' | 'season'>[], newName: string) {
  const name = newName.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const renames = seasons.map((s) => ({ from: s.show, to: renamedShow(s.season, name) })).filter((r) => r.from !== r.to);
  if (renames.length === 0) return;
  const episodes = listEpisodes();
  batch(() => {
    for (const r of renames) {
      const key = showKey(r.from);
      for (const e of episodes) if (showKey(e.show) === key) updateEpisode(e.id, { show: r.to });
      // Season downloads still to come land under the new name too.
      for (const row of db.getAllSync<{ id: number; show: string }>('SELECT id, show FROM batch_items')) {
        if (showKey(row.show) === key) db.runSync('UPDATE batch_items SET show = ? WHERE id = ?', r.to, row.id);
      }
      renameShowCover(r.from, r.to);
    }
  });
  logInfo('library', `renamed ${renames.map((r) => `"${r.from}" → "${r.to}"`).join(', ')}`);
}

const renameListeners = new Set<(from: string, to: string) => void>();

/** Lets an open show page follow its series to a new name (keys are seriesKey values). */
export function onSeriesRenamed(listener: (fromKey: string, toKey: string) => void) {
  renameListeners.add(listener);
  return () => {
    renameListeners.delete(listener);
  };
}

export function announceSeriesRename(fromKey: string, toKey: string) {
  renameListeners.forEach((l) => l(fromKey, toKey));
}
