import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';

export type StreamQuality = 1080 | 720 | 480;
export const QUALITY_OPTIONS: { value: StreamQuality; label: string; hint: string }[] = [
  { value: 1080, label: 'Best', hint: 'Up to 1080p' },
  { value: 720, label: '720p', hint: 'About half the space of 1080p' },
  { value: 480, label: '480p', hint: 'Smallest; fine on a phone screen' },
];

const KEY = 'settings.streamQuality';
const listeners = new Set<() => void>();

export function getStreamQuality(): StreamQuality {
  try {
    const v = Number(Storage.getItemSync(KEY));
    return QUALITY_OPTIONS.some((o) => o.value === v) ? (v as StreamQuality) : 1080;
  } catch {
    return 1080;
  }
}

export function setStreamQuality(q: StreamQuality) {
  try {
    Storage.setItemSync(KEY, String(q));
  } catch {
    // Falls back to the default next time.
  }
  listeners.forEach((l) => l());
}

export function useStreamQuality() {
  const [q, setQ] = useState(getStreamQuality);
  useEffect(() => {
    const l = () => setQ(getStreamQuality());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return q;
}
