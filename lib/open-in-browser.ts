// Lets other screens hand a page to the Browser tab, which may not be mounted yet.

export type BrowserRequest = {
  url: string;
  /** Set when re-finding the video for an existing download whose link stopped working. */
  relink?: { episodeId: number; title: string };
};

let pending: BrowserRequest | null = null;
const listeners = new Set<(req: BrowserRequest) => void>();

export function requestOpenInBrowser(url: string, relink?: BrowserRequest['relink']) {
  const req = { url, relink };
  if (listeners.size === 0) pending = req;
  listeners.forEach((l) => l(req));
}

/** Subscribes the browser; delivers a request made before it mounted. */
export function onOpenInBrowser(listener: (req: BrowserRequest) => void) {
  listeners.add(listener);
  if (pending) {
    const req = pending;
    pending = null;
    listener(req);
  }
  return () => {
    listeners.delete(listener);
  };
}
