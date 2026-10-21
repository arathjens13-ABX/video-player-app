/**
 * Season downloads ("Download several"): a list of episode pages worked
 * through one at a time. For each, the hidden browser (components/
 * VideoFinder.tsx) opens the page, switches to the chosen server and finds the
 * episode's video, which then goes into the normal download queue.
 *
 * Videos are found just before they download, because their links expire after
 * a few hours, and only while the download queue is idle, so the free-space
 * check sees the real picture. It never takes the phone below KEEP_FREE_BYTES.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { db, listEpisodes, notify, subscribe } from './db';
import { enqueue } from './downloads';
import { formatBytes } from './format';
import { logInfo, logWarn, shortUrl } from './log';
import type { Candidate, ProbeResult } from './probe';
import { KEEP_FREE_BYTES, sizeAtQuality } from './season';

export type BatchStatus = 'waiting' | 'finding' | 'failed';

export type BatchItem = {
  id: number;
  show: string;
  title: string;
  pageUrl: string;
  /** Label of the server to switch to ("Hardsub English Dailymotion AX"); null = the page's default player. */
  server: string | null;
  maxHeight: number;
  status: BatchStatus;
  error: string | null;
  createdAt: number;
};

export type Found = { candidate: Candidate; result: Extract<ProbeResult, { status: 'ok' }> };
export type Resolver = (pageUrl: string, server: string | null, signal: AbortSignal) => Promise<Found>;

const PAUSED_KEY = 'batch.paused';
const KEEP_AWAKE_TAG = 'vidstash-batch';

let resolver: Resolver | null = null;
let running = false;
let current: AbortController | null = null;
let keepingAwake = false;
/** Size of the last episode found, to check space before opening the next page. */
let lastSize: number | null = null;
/** Set when the space floor stopped the batch; cleared by Resume or when space frees up. */
let spaceBlock: { free: number } | null = null;

export function listBatch(): BatchItem[] {
  return db.getAllSync<BatchItem>('SELECT * FROM batch_items ORDER BY id');
}

function update(id: number, patch: Partial<Pick<BatchItem, 'status' | 'error'>>) {
  db.runSync('UPDATE batch_items SET status = ?, error = ? WHERE id = ?', patch.status ?? 'waiting', patch.error ?? null, id);
  notify();
}

function remove(id: number) {
  db.runSync('DELETE FROM batch_items WHERE id = ?', id);
  notify();
}

export function addBatch(items: Pick<BatchItem, 'show' | 'title' | 'pageUrl' | 'server' | 'maxHeight'>[]) {
  const now = Date.now();
  db.withTransactionSync(() => {
    for (const it of items) {
      db.runSync(
        'INSERT INTO batch_items (show, title, pageUrl, server, maxHeight, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        it.show,
        it.title,
        it.pageUrl,
        it.server,
        it.maxHeight,
        'waiting',
        now
      );
    }
  });
  logInfo('batch', `added ${items.length}: ${items[0]?.show ?? ''} ${items[0]?.title ?? ''}… on ${items[0]?.server ?? 'page default'}`);
  spaceBlock = null;
  notify();
  tick();
}

export function isBatchPaused() {
  try {
    return Storage.getItemSync(PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setPaused(paused: boolean) {
  try {
    Storage.setItemSync(PAUSED_KEY, paused ? '1' : '0');
  } catch {
    // Stays as it was.
  }
}

/** What the batch is waiting on, for the Downloads screen; null when it's simply working. */
export function batchNote(): string | null {
  if (isBatchPaused()) return 'Paused';
  if (spaceBlock) return `Waiting: only ${formatBytes(spaceBlock.free)} free, and season downloads keep ${formatBytes(KEEP_FREE_BYTES)} free. Delete some episodes, then tap Resume.`;
  return null;
}

export function pauseBatch() {
  setPaused(true);
  current?.abort();
  notify();
}

export function resumeBatch() {
  setPaused(false);
  spaceBlock = null;
  notify();
  tick();
}

/** Removes every episode that hasn't started downloading yet. */
export function stopBatch() {
  current?.abort();
  db.runSync('DELETE FROM batch_items');
  logInfo('batch', 'stopped');
  spaceBlock = null;
  notify();
}

export function retryBatchItem(id: number) {
  update(id, { status: 'waiting' });
  tick();
}

export function removeBatchItem(id: number) {
  remove(id);
}

/** Lets the hidden browser do the finding. Returns an unregister function. */
export function setResolver(r: Resolver) {
  resolver = r;
  tick();
  return () => {
    if (resolver === r) resolver = null;
  };
}

/** Finds one episode's video (also used to estimate a season's size before it's added). */
export function findVideo(pageUrl: string, server: string | null, signal: AbortSignal): Promise<Found> {
  if (!resolver) return Promise.reject(new Error('The video finder isn’t ready yet'));
  return resolver(pageUrl, server, signal);
}

function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

function downloadsBusy() {
  return listEpisodes().some((e) => e.status === 'queued' || e.status === 'downloading');
}

function setKeepAwake(on: boolean) {
  if (on === keepingAwake) return;
  keepingAwake = on;
  if (on) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

function blockForSpace(free: number) {
  if (!spaceBlock) logWarn('batch', `waiting for space: ${formatBytes(free)} free`);
  spaceBlock = { free };
  notify();
}

async function tick() {
  if (running || !resolver || AppState.currentState !== 'active') return;
  const waiting = listBatch().filter((i) => i.status === 'waiting');
  const paused = isBatchPaused();
  setKeepAwake(waiting.length > 0 && !paused && !spaceBlock);
  if (paused || waiting.length === 0 || downloadsBusy()) return;

  const free = freeSpace();
  if (spaceBlock) {
    // Something was deleted since: try again.
    if (free === null || free < spaceBlock.free + 100e6) return;
    spaceBlock = null;
  }
  if (free !== null && lastSize !== null && free - lastSize < KEEP_FREE_BYTES) {
    blockForSpace(free);
    setKeepAwake(false);
    return;
  }

  const item = waiting[0];
  running = true;
  const controller = new AbortController();
  current = controller;
  update(item.id, { status: 'finding' });
  logInfo('batch', `#b${item.id} finding ${item.show} ${item.title} on ${item.server ?? 'page default'}: ${shortUrl(item.pageUrl)}`);
  try {
    const found = await resolver(item.pageUrl, item.server, controller.signal);
    const r = found.result;
    const size = r.kind === 'hls' ? sizeAtQuality(r.info, item.maxHeight) : r.size;
    if (size) lastSize = size;
    const freeNow = freeSpace();
    if (size && freeNow !== null && freeNow - size < KEEP_FREE_BYTES) {
      update(item.id, { status: 'waiting' });
      blockForSpace(freeNow);
      return;
    }
    remove(item.id);
    enqueue({
      url: found.candidate.url,
      kind: found.candidate.kind === 'hls' ? 'hls' : 'mp4',
      show: item.show,
      title: item.title,
      pageUrl: item.pageUrl,
      referer: found.candidate.frame,
      maxHeight: item.maxHeight,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      // Paused, stopped or the app went to the background: not the episode's fault.
      if (listBatch().some((i) => i.id === item.id)) update(item.id, { status: 'waiting' });
    } else {
      const message = e instanceof Error ? e.message : String(e);
      logWarn('batch', `#b${item.id} not found: ${message}`);
      update(item.id, { status: 'failed', error: message });
    }
  } finally {
    running = false;
    if (current === controller) current = null;
    setTimeout(tick, 0);
  }
}

let initialized = false;

export function initBatch() {
  if (initialized) return;
  initialized = true;
  db.runSync("UPDATE batch_items SET status = 'waiting' WHERE status = 'finding'");
  subscribe(() => {
    // Change notifications arrive mid-update; look again once the current one has finished.
    setTimeout(tick, 0);
  });
  AppState.addEventListener('change', (state) => {
    // The hidden browser stops running in the background; finish this episode when back.
    if (state !== 'active') current?.abort();
    else tick();
  });
  tick();
}
