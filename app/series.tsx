import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch } from 'react-native';

import { playEpisode } from '@/components/libraryActions';
import { RemotePoster } from '@/components/ShowCard';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { addBatch } from '@/lib/batch';
import { loadSeries, resolveSeriesUrl } from '@/lib/catalog/client';
import type { OnlineEpisode, Series } from '@/lib/catalog/parse';
import { siteForUrl } from '@/lib/catalog/sites';
import { setShowCover } from '@/lib/covers';
import type { Episode } from '@/lib/db';
import { askForNotifications, syncBackgroundCheck } from '@/lib/follow-runner';
import { follow, serverFor, setAutoDownload, unfollow } from '@/lib/follows';
import { useBatch, useEpisodes, useFollows } from '@/lib/hooks';
import { episodeNumber, seriesKey } from '@/lib/library';
import { logInfo } from '@/lib/log';
import { requestOpenInBrowser } from '@/lib/open-in-browser';
import { seasonEpisodes, type SeasonEpisode } from '@/lib/season';
import { setSeasonDraft } from '@/lib/season-draft';
import { getStreamQuality } from '@/lib/settings';

type State = { series: Series | null; error: string | null };

/**
 * A show's page on a site, inside the app: details, every episode with what
 * you already have, and Follow / Download several.
 */
export default function SeriesScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string }>();
  const colors = useColors();
  const [state, setState] = useState<State & { key: string }>({ series: null, error: null, key: '' });
  const [reload, setReload] = useState(0);
  const [newestFirst, setNewestFirst] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const episodes = useEpisodes();
  const { items: queued } = useBatch();
  const follows = useFollows();
  const loadKey = `${params.url}:${reload}`;

  useEffect(() => {
    let alive = true;
    const key = `${params.url}:${reload}`;
    resolveSeriesUrl(params.url)
      .then((url) => loadSeries(url, reload > 0))
      .then(
        (series) => alive && setState({ series, error: null, key }),
        (e: unknown) => alive && setState({ series: null, error: e instanceof Error ? e.message : String(e), key })
      );
    return () => {
      alive = false;
    };
  }, [params.url, reload]);

  const series = state.key === loadKey ? state.series : null;
  const error = state.key === loadKey ? state.error : null;
  const site = siteForUrl(params.url);
  const referer = site?.base ?? params.url;
  const following = series ? follows.find((f) => f.url === series.url) : undefined;
  const listed = useMemo(() => (series ? seasonEpisodes(series.episodes) : []), [series]);
  const shown = newestFirst ? [...listed].reverse() : listed;

  // What you already have of each listed episode: by its page, else by show and number.
  const status = useMemo(() => {
    const byPage = new Map<string, Episode>();
    const byNumber = new Map<string, Episode>();
    for (const e of episodes) {
      if (e.pageUrl) byPage.set(e.pageUrl, e);
      const n = episodeNumber(e.title);
      if (n !== null) byNumber.set(`${seriesKey(e.show)}#${n}`, e);
    }
    const waiting = new Map(queued.map((b) => [b.pageUrl, b]));
    return (e: SeasonEpisode<OnlineEpisode>) => ({
      local: byPage.get(e.url) ?? (e.number !== null ? byNumber.get(`${seriesKey(e.show)}#${e.number}`) : undefined),
      batch: waiting.get(e.url),
    });
  }, [episodes, queued]);

  function download(e: SeasonEpisode<OnlineEpisode>) {
    if (!series) return;
    addBatch([{ show: e.show, title: e.name, pageUrl: e.url, server: serverFor(series.url), maxHeight: getStreamQuality() }]);
    setShowCover(e.show, series.poster, series.url);
    logInfo('catalog', `download ${e.show} ${e.name} from the show page`);
  }

  async function toggleFollow() {
    if (!series) return;
    if (following) {
      Alert.alert(`Stop following ${series.title}?`, 'Episodes you already have stay in your Library.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfollow',
          style: 'destructive',
          onPress: () => {
            unfollow(series.url);
            syncBackgroundCheck();
          },
        },
      ]);
      return;
    }
    follow(series);
    syncBackgroundCheck();
    await askForNotifications();
  }

  function downloadSeveral() {
    if (!series) return;
    setSeasonDraft({ listUrl: series.url, episodes: series.episodes, server: serverFor(series.url), cover: series.poster });
    router.push('/batch');
  }

  const title = series?.title ?? params.title ?? '';
  if (!series) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title }} />
        {error ? (
          <>
            <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text>
            <Pressable onPress={() => setReload((n) => n + 1)} hitSlop={8} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.tint, fontWeight: '600' }}>Retry</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const facts = ['Status', 'Type', 'Episodes', 'Duration', 'Released'].map((k) => series.info[k] && `${k === 'Episodes' ? 'Episodes: ' : ''}${series.info[k]}`).filter(Boolean);
  const have = listed.filter((e) => status(e).local?.status === 'done').length;

  return (
    <FlatList
      data={shown}
      keyExtractor={(e) => e.url}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: series.title }} />
          <View style={styles.top} lightColor="transparent" darkColor="transparent">
            <RemotePoster uri={series.poster} referer={referer} width={112} />
            <View style={styles.topText} lightColor="transparent" darkColor="transparent">
              <Text style={styles.title}>{series.title}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{facts.join(' · ')}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {listed.length} episode{listed.length === 1 ? '' : 's'} on {site?.name ?? 'the site'} · you have {have}
              </Text>
            </View>
          </View>
          {series.description ? (
            <Pressable onPress={() => setExpanded((v) => !v)}>
              <Text style={[styles.description, { color: colors.muted }]} numberOfLines={expanded ? undefined : 3}>
                {series.description}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.buttons} lightColor="transparent" darkColor="transparent">
            <Pressable
              onPress={toggleFollow}
              style={({ pressed }) => [styles.button, { backgroundColor: following ? colors.card : colors.tint, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.buttonText, { color: following ? colors.text : '#fff' }]}>{following ? '✓ Following' : '+ Follow'}</Text>
            </Pressable>
            <Pressable onPress={downloadSeveral} style={({ pressed }) => [styles.button, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.buttonText}>Download several…</Text>
            </Pressable>
          </View>
          {following ? (
            <View style={[styles.followBox, { backgroundColor: colors.card }]}>
              <View style={{ flex: 1 }} lightColor="transparent" darkColor="transparent">
                <Text style={{ fontWeight: '600' }}>Download new episodes automatically</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  At up to {following.maxHeight}p on {following.server ?? 'the page’s default player'}. You get a notification either way.
                </Text>
                {following.lastError ? (
                  <Text style={[styles.meta, { color: colors.danger }]}>Last check failed: {following.lastError}</Text>
                ) : null}
              </View>
              <Switch value={!!following.autoDownload} onValueChange={(v) => setAutoDownload(following.url, v)} />
            </View>
          ) : null}

          <View style={styles.listHeader} lightColor="transparent" darkColor="transparent">
            <Text style={styles.sectionTitle}>Episodes</Text>
            <Pressable onPress={() => setNewestFirst((v) => !v)} hitSlop={8}>
              <Text style={{ color: colors.tint, fontWeight: '600' }}>{newestFirst ? 'Newest first' : 'Oldest first'}</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              requestOpenInBrowser(series.url);
              router.navigate('/browser');
            }}
            hitSlop={6}>
            <Text style={[styles.meta, { color: colors.muted }]}>Open this page in the Browser</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const { local, batch } = status(item);
        let action: { label: string; onPress?: () => void; primary?: boolean };
        if (local?.status === 'done') action = { label: local.watched ? '✓ Watched' : '▶ Play', onPress: () => playEpisode(local.id) };
        else if (local && local.status !== 'error') action = { label: local.status === 'paused' ? 'Paused' : 'Downloading', onPress: () => router.navigate('/downloads') };
        else if (batch) action = { label: batch.status === 'failed' ? 'Not found' : batch.status === 'finding' ? 'Finding…' : 'Queued', onPress: () => router.navigate('/downloads') };
        else action = { label: '⬇ Download', onPress: () => download(item), primary: true };
        return (
          <View style={[styles.row, { backgroundColor: colors.card }]}>
            <View style={{ flex: 1 }} lightColor="transparent" darkColor="transparent">
              <Text style={styles.rowTitle}>{item.name}</Text>
              {item.date ? <Text style={[styles.meta, { color: colors.muted }]}>{item.date}</Text> : null}
            </View>
            <Pressable
              onPress={action.onPress}
              hitSlop={8}
              style={({ pressed }) => [styles.action, { borderColor: action.primary ? colors.tint : colors.border, opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ color: action.primary ? colors.tint : colors.text, fontWeight: '600', fontSize: 13 }}>{action.label}</Text>
            </Pressable>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  top: { flexDirection: 'row', gap: 14 },
  topText: { flex: 1, gap: 4 },
  title: { fontSize: 20, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  description: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  followBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, marginTop: 12 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 20, marginBottom: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  action: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});
