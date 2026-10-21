import * as SQLite from 'expo-sqlite';

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error';
export type DownloadKind = 'mp4' | 'hls';

export type Episode = {
  id: number;
  show: string;
  title: string;
  /** File name inside the videos directory. Never an absolute path: the iOS app container moves between installs. */
  fileName: string;
  sourceUrl: string;
  pageUrl: string | null;
  headersJson: string;
  kind: DownloadKind;
  status: DownloadStatus;
  bytesWritten: number;
  totalBytes: number;
  error: string | null;
  /** Serialized DownloadPauseState from expo-file-system, used to resume after a pause. */
  resumeJson: string | null;
  positionSec: number;
  durationSec: number;
  watched: number;
  createdAt: number;
  /** Highest stream quality (video height) chosen when the download was added. */
  maxHeight: number | null;
};

const MIGRATIONS: string[] = [
  `CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show TEXT NOT NULL,
    title TEXT NOT NULL,
    fileName TEXT NOT NULL,
    sourceUrl TEXT NOT NULL,
    pageUrl TEXT,
    headersJson TEXT NOT NULL DEFAULT '{}',
    kind TEXT NOT NULL DEFAULT 'mp4',
    status TEXT NOT NULL DEFAULT 'queued',
    bytesWritten INTEGER NOT NULL DEFAULT 0,
    totalBytes INTEGER NOT NULL DEFAULT -1,
    error TEXT,
    resumeJson TEXT,
    positionSec REAL NOT NULL DEFAULT 0,
    durationSec REAL NOT NULL DEFAULT 0,
    watched INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );`,
  `ALTER TABLE episodes ADD COLUMN maxHeight INTEGER;`,
  // Season downloads: episodes waiting for their video to be found (see lib/batch.ts).
  `CREATE TABLE batch_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show TEXT NOT NULL,
    title TEXT NOT NULL,
    pageUrl TEXT NOT NULL,
    server TEXT,
    maxHeight INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    error TEXT,
    createdAt INTEGER NOT NULL
  );`,
];

export const db = SQLite.openDatabaseSync('vidstash.db');

function migrate() {
  db.execSync('PRAGMA journal_mode = WAL;');
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[version]);
      db.execSync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}

migrate();

// Tiny change feed so screens can re-query when the library or queue changes.
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let batchDepth = 0;
let pendingNotify = false;

export function notify() {
  if (batchDepth > 0) {
    pendingNotify = true;
    return;
  }
  listeners.forEach((l) => l());
}

/** Runs many changes in one transaction and tells screens to refresh once, at the end. */
export function batch(fn: () => void) {
  batchDepth++;
  try {
    db.withTransactionSync(fn);
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingNotify) {
      pendingNotify = false;
      notify();
    }
  }
}

export function listEpisodes(): Episode[] {
  return db.getAllSync<Episode>('SELECT * FROM episodes ORDER BY show COLLATE NOCASE, createdAt');
}

export function getEpisode(id: number): Episode | null {
  return db.getFirstSync<Episode>('SELECT * FROM episodes WHERE id = ?', id);
}

export function insertEpisode(
  e: Pick<Episode, 'show' | 'title' | 'sourceUrl' | 'pageUrl' | 'headersJson' | 'kind' | 'maxHeight'>
): number {
  const result = db.runSync(
    `INSERT INTO episodes (show, title, fileName, sourceUrl, pageUrl, headersJson, kind, status, createdAt, maxHeight)
     VALUES (?, ?, '', ?, ?, ?, ?, 'queued', ?, ?)`,
    e.show,
    e.title,
    e.sourceUrl,
    e.pageUrl,
    e.headersJson,
    e.kind,
    Date.now(),
    e.maxHeight
  );
  const id = result.lastInsertRowId;
  db.runSync('UPDATE episodes SET fileName = ? WHERE id = ?', `${id}.mp4`, id);
  notify();
  return id;
}

type Patch = Partial<Omit<Episode, 'id'>>;

export function updateEpisode(id: number, patch: Patch, { silent = false } = {}) {
  const keys = Object.keys(patch) as (keyof Patch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] ?? null);
  db.runSync(`UPDATE episodes SET ${sets} WHERE id = ?`, ...values, id);
  if (!silent) notify();
}

export function deleteEpisodeRow(id: number) {
  db.runSync('DELETE FROM episodes WHERE id = ?', id);
  notify();
}
