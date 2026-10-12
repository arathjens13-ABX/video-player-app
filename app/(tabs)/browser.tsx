import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { DetectedSheet, type Server } from '@/components/DetectedSheet';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { addressToUrl, sameSite, shouldBlockNavigation } from '@/lib/browser';
import { DETECTOR_JS, switchServerJs } from '@/lib/detector';
import { candidateKey, type Candidate } from '@/lib/probe';
import { onOpenInBrowser } from '@/lib/open-in-browser';
import { probeStatus, startProbe, subscribeProbes } from '@/lib/probe-store';
import { loadRecent, rememberVisit, type RecentSite } from '@/lib/recent';
import { USER_AGENT } from '@/lib/ua';

const SUGGESTED: RecentSite[] = [{ url: 'https://animexin.dev/', title: 'AnimeXin' }];

type DetectorMessage =
  | { type: 'media'; url: string; kind: 'hls' | 'file'; via: string; frame: string }
  | { type: 'servers'; servers: Server[] }
  | { type: 'page'; title: string; url: string };

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

  const open = useCallback((url: string) => {
    userTyped.current = true;
    setCandidates([]);
    setServers([]);
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
  useEffect(() => onOpenInBrowser(open), [open]);

  function submitAddress() {
    const url = addressToUrl(address);
    if (url) open(url);
  }

  function onMessage(e: WebViewMessageEvent) {
    let msg: DetectorMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'media') {
      const candidate = { url: msg.url, kind: msg.kind, frame: msg.frame, via: msg.via };
      startProbe(candidate);
      // Same stream with a fresh token replaces the old entry rather than adding another.
      const key = candidateKey(msg.url);
      setCandidates((list) => {
        const i = list.findIndex((c) => candidateKey(c.url) === key);
        if (i < 0) return [...list, candidate];
        if (list[i].url === msg.url) return list;
        const next = [...list];
        next[i] = candidate;
        return next;
      });
    } else if (msg.type === 'servers') {
      setServers(msg.servers);
    } else if (msg.type === 'page') {
      setNav((n) => (n.title === msg.title ? n : { ...n, title: msg.title }));
    }
  }

  function onNavigationStateChange(state: WebViewNavigation) {
    // A real page load (not an in-page URL change) starts a fresh detector, so drop the old page's finds.
    const newPageLoad = state.loading && currentUrl.current !== null && !samePage(currentUrl.current, state.url);
    if (newPageLoad) {
      setCandidates([]);
      setServers([]);
    }
    currentUrl.current = state.url;
    setNav({ canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading, url: state.url, title: state.title });
    if (!editing) setAddress(state.url);
    if (!state.loading) {
      userTyped.current = false;
      rememberVisit(state.url, state.title);
    }
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
    if (block) setBlocked(req.url);
    return !block;
  }

  function download(c: Candidate) {
    setSheetOpen(false);
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
    setSheetOpen(false);
    // Keep earlier finds: they're still downloadable, and the page won't report them twice.
    webview.current?.injectJavaScript(switchServerJs(s.url));
  }

  const found = candidates.filter((c) => probeStatus(c.url) === 'pending' || isOk(probeStatus(c.url))).length;

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
          onShouldStartLoadWithRequest={onShouldStartLoad}
          onOpenWindow={(e) => {
            // Pop-ups are almost always ads; only follow ones that stay on the same site.
            const target = e.nativeEvent.targetUrl;
            if (currentUrl.current && sameSite(target, currentUrl.current)) open(target);
            else setBlocked(target);
          }}
          onContentProcessDidTerminate={() => webview.current?.reload()}
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
              { backgroundColor: found > 0 ? colors.tint : colors.card, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text style={[styles.foundText, { color: found > 0 ? '#fff' : colors.text }]}>
              {found > 0 ? `⬇ ${found} video${found === 1 ? '' : 's'} found` : servers.length > 0 ? `${servers.length} servers` : 'No video yet'}
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

function isOk(status: ReturnType<typeof probeStatus>) {
  return typeof status === 'object' && status.status === 'ok';
}

function samePage(a: string, b: string) {
  return a.split('#')[0] === b.split('#')[0];
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url.split(':')[0] + ' link';
  }
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
