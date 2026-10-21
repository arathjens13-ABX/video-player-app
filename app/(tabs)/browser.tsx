import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewErrorEvent, WebViewNavigationEvent } from 'react-native-webview/lib/WebViewTypes';

import { DetectedSheet } from '@/components/DetectedSheet';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { addressToUrl, sameSite, shouldBlockNavigation } from '@/lib/browser';
import { DETECTOR_JS, switchServerJs } from '@/lib/detector';
import { parseDetectorMessage, type Server } from '@/lib/detector-messages';
import { hostOf } from '@/lib/links';
import { candidateKey, type Candidate } from '@/lib/probe';
import { relink } from '@/lib/downloads';
import { logInfo, logWarn, shortUrl } from '@/lib/log';
import { onOpenInBrowser, type BrowserRequest } from '@/lib/open-in-browser';
import { groupVideos } from '@/lib/candidates';
import { probeStatus, startProbe, subscribeProbes } from '@/lib/probe-store';
import { loadRecent, rememberVisit, type RecentSite } from '@/lib/recent';
import { USER_AGENT } from '@/lib/ua';

const SUGGESTED: RecentSite[] = [{ url: 'https://animexin.dev/', title: 'AnimeXin' }];


export default function BrowserScreen() {
  const colors = useColors();
  const webview = useRef<WebView>(null);
  const [source, setSource] = useState<{ uri: string } | null>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false, loading: false, url: '', title: '' });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  // True from when the user submits an address until that page finishes loading.
  const userTyped = useRef(false);
  const currentUrl = useRef<string | null>(null);
  // Allow-list for one navigation after the user taps "Open anyway".
  const allowOnce = useRef<string | null>(null);
  const sourceUri = useRef<string | null>(null);
  // For diagnostics: what has already been logged for the current page.
  const candidateKeys = useRef(new Set<string>());
  const serverCount = useRef(-1);
  const lastLoggedPage = useRef<string | null>(null);

  const [relinking, setRelinking] = useState<BrowserRequest['relink'] | null>(null);

  const open = useCallback((url: string) => {
    userTyped.current = true;
    setCandidates([]);
    setServers([]);
    candidateKeys.current.clear();
    serverCount.current = -1;
    setBlocked(null);
    setEditing(false);
    setAddress(url);
    if (sourceUri.current === url) {
      // Same URL again: the WebView won't reload for an unchanged source.
      webview.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
    } else {
      sourceUri.current = url;
      setSource({ uri: url });
    }
  }, []);

  // Re-render when a probe finishes so the found-count only includes links that check out.
  const [, setProbeTick] = useState(0);
  useEffect(() => subscribeProbes(() => setProbeTick((n) => n + 1)), []);

  // Links handed over from elsewhere in the app (e.g. pasted in Downloads).
  useEffect(
    () =>
      onOpenInBrowser((req) => {
        setRelinking(req.relink ?? null);
        open(req.url);
      }),
    [open]
  );

  function submitAddress() {
    const url = addressToUrl(address);
    if (url) open(url);
  }

  function onMessage(e: WebViewMessageEvent) {
    // Any page or iframe can post here, so only well-formed detector messages are accepted.
    const msg = parseDetectorMessage(e.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'media') {
      const candidate = { url: msg.url, kind: msg.kind, frame: msg.frame, via: msg.via };
      const key = candidateKey(msg.url);
      if (!candidateKeys.current.has(key)) {
        candidateKeys.current.add(key);
        logInfo('detect', `found ${msg.kind} via ${msg.via} in ${hostOf(msg.frame)}: ${shortUrl(msg.url)}`);
      }
      startProbe(candidate);
      // Same stream with a fresh token replaces the old entry rather than adding another.
      setCandidates((list) => {
        const i = list.findIndex((c) => candidateKey(c.url) === key);
        if (i < 0) return [...list, candidate];
        if (list[i].url === msg.url) return list;
        const next = [...list];
        next[i] = candidate;
        return next;
      });
    } else if (msg.type === 'servers') {
      if (msg.servers.length !== serverCount.current) {
        serverCount.current = msg.servers.length;
        logInfo('detect', `${msg.servers.length} servers: ${msg.servers.map((x) => hostOf(x.url)).join(', ')}`);
      }
      setServers(msg.servers);
    } else if (msg.type === 'page') {
      setNav((n) => (n.title === msg.title ? n : { ...n, title: msg.title }));
    }
  }

  // Load start/end come only from top-level page loads. (The navigation-state event's `loading`
  // flag can't be trusted for this on iOS: at the start of a load it still describes the old page.)
  function onLoadStart(e: WebViewNavigationEvent) {
    const url = e.nativeEvent.url;
    if (currentUrl.current !== null && !samePage(currentUrl.current, url)) {
      // A new page gets a fresh detector, so drop the old page's finds.
      candidateKeys.current.clear();
      serverCount.current = -1;
      setCandidates([]);
      setServers([]);
    }
    setNav((n) => ({ ...n, loading: true }));
  }

  function onLoadEnd(e: WebViewNavigationEvent | WebViewErrorEvent) {
    const { url, title } = e.nativeEvent;
    setNav((n) => ({ ...n, loading: false }));
    // The address the user typed (and its redirects) has finished loading.
    userTyped.current = false;
    rememberVisit(url, title);
    if (lastLoggedPage.current !== url) {
      lastLoggedPage.current = url;
      logInfo('browser', `loaded ${shortUrl(url)}`);
    }
  }

  function onNavigationStateChange(state: WebViewNavigation) {
    currentUrl.current = state.url;
    setNav((n) => ({ ...n, canGoBack: state.canGoBack, canGoForward: state.canGoForward, url: state.url, title: state.title }));
    if (!editing) setAddress(state.url);
  }

  function onShouldStartLoad(req: ShouldStartLoadRequest) {
    if (allowOnce.current && req.url === allowOnce.current) {
      allowOnce.current = null;
      return true;
    }
    const block = shouldBlockNavigation({
      url: req.url,
      currentUrl: currentUrl.current,
      // Android doesn't report frames here; it only asks about top-level loads.
      isTopFrame: Platform.OS === 'ios' ? req.isTopFrame : true,
      navigationType: req.navigationType,
      userTyped: userTyped.current,
    });
    if (block) {
      logInfo('browser', `blocked redirect to ${shortUrl(req.url, 80)}`);
      setBlocked(req.url);
    }
    return !block;
  }

  function download(c: Candidate) {
    setSheetOpen(false);
    if (relinking) {
      relink(relinking.episodeId, { url: c.url, kind: c.kind === 'hls' ? 'hls' : 'mp4', referer: c.frame });
      setRelinking(null);
      router.navigate('/downloads');
      return;
    }
    router.push({
      pathname: '/episode-form',
      params: {
        url: c.url,
        kind: c.kind === 'hls' ? 'hls' : 'mp4',
        referer: c.frame,
        pageTitle: nav.title,
        pageUrl: nav.url,
      },
    });
  }

  function switchServer(s: Server) {
    logInfo('browser', `switch server → ${s.label} (${hostOf(s.url)})`);
    setSheetOpen(false);
    // Keep earlier finds: they're still downloadable, and the page won't report them twice.
    webview.current?.injectJavaScript(switchServerJs(s.url));
  }

  // Distinct videos (a stream's per-quality copies count once); links still being checked light the button too.
  const found = groupVideos(candidates, probeStatus).length;
  const checking = candidates.some((c) => probeStatus(c.url) === 'pending');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onSubmitEditing={submitAddress}
          placeholder="Search or enter address"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          selectTextOnFocus
          style={[styles.address, { color: colors.text, backgroundColor: colors.card }]}
        />
        {source ? (
          <Pressable onPress={() => (nav.loading ? webview.current?.stopLoading() : webview.current?.reload())} hitSlop={8} style={styles.barButton}>
            <Text style={[styles.barIcon, { color: colors.tint }]}>{nav.loading ? '✕' : '↻'}</Text>
          </Pressable>
        ) : null}
      </View>

      {relinking ? (
        <View style={[styles.banner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={styles.bannerText} numberOfLines={2}>
            Finding a new link for “{relinking.title}”. Press play, then download it from the button below.
          </Text>
          <Pressable onPress={() => setRelinking(null)} hitSlop={8}>
            <Text style={[styles.bannerAction, { color: colors.muted }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {blocked ? (
        <View style={[styles.banner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={styles.bannerText} numberOfLines={2}>
            Blocked a redirect to {hostOf(blocked)}
          </Text>
          <Pressable
            onPress={() => {
              allowOnce.current = blocked;
              open(blocked);
            }}
            hitSlop={8}>
            <Text style={[styles.bannerAction, { color: colors.tint }]}>Open anyway</Text>
          </Pressable>
          <Pressable onPress={() => setBlocked(null)} hitSlop={8}>
            <Text style={[styles.bannerAction, { color: colors.muted }]}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {source ? (
        <WebView
          ref={webview}
          source={source}
          userAgent={USER_AGENT}
          injectedJavaScriptBeforeContentLoaded={DETECTOR_JS}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScriptForMainFrameOnly={false}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          onOpenWindow={(e) => {
            // Pop-ups are almost always ads; only follow ones that stay on the same site.
            const target = e.nativeEvent.targetUrl;
            if (currentUrl.current && sameSite(target, currentUrl.current)) open(target);
            else {
              logInfo('browser', `blocked pop-up ${shortUrl(target, 80)}`);
              setBlocked(target);
            }
          }}
          onContentProcessDidTerminate={() => {
            logWarn('browser', 'web content process crashed; reloading');
            webview.current?.reload();
          }}
          onError={(e) => logWarn('browser', `load error ${e.nativeEvent.code}: ${e.nativeEvent.description} (${shortUrl(e.nativeEvent.url)})`)}
          onHttpError={(e) => logWarn('browser', `HTTP ${e.nativeEvent.statusCode} for ${shortUrl(e.nativeEvent.url)}`)}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          allowsBackForwardNavigationGestures
          mediaPlaybackRequiresUserAction
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically={false}
          style={{ flex: 1, backgroundColor: colors.background }}
        />
      ) : (
        <StartPage
          sites={[...recent, ...SUGGESTED.filter((s) => !recent.some((r) => sameSite(r.url, s.url)))]}
          onOpen={(url) => {
            open(url);
            setRecent(loadRecent());
          }}
        />
      )}

      {source ? (
        <View style={[styles.toolbar, { borderTopColor: colors.border }]}>
          <ToolButton label="‹" disabled={!nav.canGoBack} onPress={() => webview.current?.goBack()} />
          <ToolButton label="›" disabled={!nav.canGoForward} onPress={() => webview.current?.goForward()} />
          <Pressable
            onPress={() => setSheetOpen(true)}
            style={({ pressed }) => [
              styles.foundButton,
              { backgroundColor: found > 0 || checking ? colors.tint : colors.card, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text style={[styles.foundText, { color: found > 0 || checking ? '#fff' : colors.text }]}>
              {found > 0
                ? `⬇ ${found} video${found === 1 ? '' : 's'} found`
                : checking
                  ? 'Checking…'
                  : servers.length > 0
                    ? `${servers.length} servers`
                    : 'No video yet'}
            </Text>
          </Pressable>
          <ToolButton
            label="⌂"
            onPress={() => {
              setSource(null);
              sourceUri.current = null;
              setRecent(loadRecent());
              currentUrl.current = null;
              setAddress('');
              setCandidates([]);
              setServers([]);
              setBlocked(null);
            }}
          />
        </View>
      ) : null}

      <DetectedSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        candidates={candidates}
        servers={servers}
        onDownload={download}
        onSwitchServer={switchServer}
      />
    </SafeAreaView>
  );
}

function samePage(a: string, b: string) {
  return a.split('#')[0] === b.split('#')[0];
}

function ToolButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={styles.toolButton}>
      <Text style={[styles.toolIcon, { color: colors.tint, opacity: disabled ? 0.3 : 1 }]}>{label}</Text>
    </Pressable>
  );
}

function StartPage({ sites, onOpen }: { sites: RecentSite[]; onOpen: (url: string) => void }) {
  const colors = useColors();
  return (
    <ScrollView contentContainerStyle={styles.start}>
      <Text style={styles.startTitle}>Find a video</Text>
      <Text style={[styles.startBody, { color: colors.muted }]}>
        Open an episode page and press play. When the app spots the video, the button at the bottom lights up; tap it to
        download. If one server doesn’t work, pick another from the same button.
      </Text>
      {sites.map((s) => (
        <Pressable
          key={s.url}
          onPress={() => onOpen(s.url)}
          style={({ pressed }) => [styles.site, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.siteTitle} numberOfLines={1}>
            {s.title}
          </Text>
          <Text style={[styles.siteUrl, { color: colors.muted }]} numberOfLines={1}>
            {s.url}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  address: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  barButton: { paddingLeft: 12 },
  barIcon: { fontSize: 20 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  bannerText: { flex: 1, fontSize: 13 },
  bannerAction: { fontSize: 14, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  toolButton: { width: 44, alignItems: 'center' },
  toolIcon: { fontSize: 28, lineHeight: 32 },
  foundButton: { flex: 1, borderRadius: 20, paddingVertical: 9, alignItems: 'center' },
  foundText: { fontSize: 15, fontWeight: '600' },
  start: { padding: 20 },
  startTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  startBody: { fontSize: 15, lineHeight: 21, marginBottom: 20 },
  site: { borderRadius: 10, padding: 14, marginBottom: 8 },
  siteTitle: { fontSize: 16, fontWeight: '500' },
  siteUrl: { fontSize: 13, marginTop: 2 },
});
