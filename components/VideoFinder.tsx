import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { setResolver, type Found } from '@/lib/batch';
import { sameSite } from '@/lib/browser';
import { AUTOPLAY_JS, DETECTOR_JS, switchServerJs } from '@/lib/detector';
import { parseDetectorMessage } from '@/lib/detector-messages';
import { FinderSession } from '@/lib/finder';
import { logInfo, shortUrl } from '@/lib/log';
import { probeStatus, startProbe } from '@/lib/probe-store';
import { USER_AGENT } from '@/lib/ua';

/** How long a page gets to produce its video. */
const TIMEOUT_MS = 45_000;
/** How long to wait for the server list before using the page's default player. */
const SERVERS_WAIT_MS = 8_000;

type Job = {
  pageUrl: string;
  server: string | null;
  signal: AbortSignal;
  resolve: (f: Found) => void;
  reject: (e: Error) => void;
};

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * An invisible browser that opens episode pages for season downloads and finds
 * their videos the same way the Browser tab does. One page at a time.
 */
export function VideoFinder() {
  const webview = useRef<WebView>(null);
  const queue = useRef<Job[]>([]);
  const job = useRef<{ job: Job; session: FinderSession; started: number } | null>(null);
  const [source, setSource] = useState<{ uri: string; key: number } | null>(null);

  useEffect(() => {
    function next() {
      if (job.current) return;
      const j = queue.current.shift();
      if (!j) {
        setSource(null);
        return;
      }
      if (j.signal.aborted) {
        j.reject(abortError());
        next();
        return;
      }
      job.current = { job: j, session: new FinderSession(j.server), started: Date.now() };
      setSource({ uri: j.pageUrl, key: Date.now() });
    }

    function finish(result: Found | Error) {
      const current = job.current;
      if (!current) return;
      job.current = null;
      if (result instanceof Error) current.job.reject(result);
      else current.job.resolve(result);
      next();
    }

    // Checks progress twice a second: probes finish on their own schedule.
    const timer = setInterval(() => {
      const current = job.current;
      if (!current) return;
      const now = Date.now();
      if (current.job.signal.aborted) return finish(abortError());
      if (now - current.started > SERVERS_WAIT_MS) current.session.settleWithoutServers();
      for (const c of current.session.accepted) startProbe(c);
      const found = current.session.pick(probeStatus, now);
      if (found) {
        logInfo('batch', `found ${shortUrl(found.candidate.url)} on ${current.session.serverUsed ?? 'page default'}`);
        return finish(found);
      }
      if (now - current.started > TIMEOUT_MS) {
        const where = current.session.serverUsed ?? (current.job.server ? `the page’s default player (“${current.job.server}” isn’t on this page)` : 'the page’s player');
        finish(new Error(`No video found on ${where} within ${TIMEOUT_MS / 1000} s`));
      }
    }, 500);

    const unregister = setResolver(
      (pageUrl, server, signal) =>
        new Promise<Found>((resolve, reject) => {
          queue.current.push({ pageUrl, server, signal, resolve, reject });
          next();
        })
    );
    return () => {
      clearInterval(timer);
      unregister();
    };
  }, []);

  function onMessage(e: WebViewMessageEvent) {
    const current = job.current;
    const msg = parseDetectorMessage(e.nativeEvent.data);
    if (!current || !msg) return;
    if (msg.type === 'servers') {
      const switchTo = current.session.onServers(msg.servers);
      if (switchTo) webview.current?.injectJavaScript(switchServerJs(switchTo));
    } else if (msg.type === 'media') {
      current.session.onMedia({ url: msg.url, kind: msg.kind, frame: msg.frame, via: msg.via });
    }
  }

  // Ads try to take over the page; this browser only ever needs the episode's own site.
  function onShouldStartLoad(req: ShouldStartLoadRequest) {
    const current = job.current;
    if (!current || req.isTopFrame === false) return true;
    return /^(about|blob|data):/i.test(req.url) || sameSite(req.url, current.job.pageUrl);
  }

  if (!source) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        key={source.key}
        ref={webview}
        source={{ uri: source.uri }}
        userAgent={USER_AGENT}
        injectedJavaScriptBeforeContentLoaded={DETECTOR_JS}
        injectedJavaScript={AUTOPLAY_JS}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        injectedJavaScriptForMainFrameOnly={false}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onOpenWindow={() => {}}
        setSupportMultipleWindows
        javaScriptCanOpenWindowsAutomatically={false}
        allowsInlineMediaPlayback
        // Muted autoplay (AUTOPLAY_JS): players that wait for Play otherwise never load their stream.
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out (so players load as they would on screen) but invisible and untouchable.
  hidden: { position: 'absolute', left: 0, top: 0, width: 360, height: 240, opacity: 0, zIndex: -1 },
});
