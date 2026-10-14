/**
 * A small diagnostics log that survives restarts, so a problem seen on the
 * phone can be copied out as a report (Settings → Diagnostics) and sent over.
 *
 * Kept in memory as a ring buffer and written to a file shortly after each
 * entry (immediately for errors, which may be followed by a crash).
 */
import { File, Paths } from 'expo-file-system';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogEntry = { t: number; level: LogLevel; area: string; msg: string };

const MAX_ENTRIES = 600;
const MAX_MESSAGE = 600;
const FLUSH_DELAY_MS = 2000;

const logFile = new File(Paths.document, 'diagnostics.json');
let entries: LogEntry[] = load();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): LogEntry[] {
  try {
    if (!logFile.exists) return [];
    const parsed = JSON.parse(logFile.textSync()) as LogEntry[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function flush() {
  flushTimer = null;
  try {
    if (!logFile.exists) logFile.create();
    logFile.write(JSON.stringify(entries));
  } catch {
    // Diagnostics must never break the app.
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function log(level: LogLevel, area: string, ...parts: unknown[]) {
  let msg = parts.map(describe).join(' ');
  if (msg.length > MAX_MESSAGE) msg = msg.slice(0, MAX_MESSAGE) + '…';
  entries.push({ t: Date.now(), level, area, msg });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (level === 'error') {
    if (flushTimer) clearTimeout(flushTimer);
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

export const logInfo = (area: string, ...parts: unknown[]) => log('info', area, ...parts);
export const logWarn = (area: string, ...parts: unknown[]) => log('warn', area, ...parts);
export const logError = (area: string, ...parts: unknown[]) => log('error', area, ...parts);

export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLog() {
  entries = [];
  flush();
}

/** Short host + path for logs: enough to tell links apart without pages of tokens. */
export function shortUrl(url: string, max = 120): string {
  const noScheme = url.replace(/^https?:\/\//, '');
  return noScheme.length > max ? noScheme.slice(0, max) + '…' : noScheme;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const level = e.level === 'info' ? '' : ` ${e.level.toUpperCase()}`;
  return `${time}${level} [${e.area}] ${e.msg}`;
}
