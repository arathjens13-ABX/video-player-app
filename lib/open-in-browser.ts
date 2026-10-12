// Lets other screens hand a page to the Browser tab, which may not be mounted yet.
let pending: string | null = null;
const listeners = new Set<(url: string) => void>();

export function requestOpenInBrowser(url: string) {
  if (listeners.size === 0) pending = url;
  listeners.forEach((l) => l(url));
}

/** Subscribes the browser; delivers a request made before it mounted. */
export function onOpenInBrowser(listener: (url: string) => void) {
  listeners.add(listener);
  if (pending) {
    const url = pending;
    pending = null;
    listener(url);
  }
  return () => {
    listeners.delete(listener);
  };
}
