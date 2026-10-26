import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet } from 'react-native';

import { EpisodeRow } from '@/components/EpisodeRow';
import { playEpisode, showActions } from '@/components/libraryActions';
import { openOnline } from '@/components/openOnline';
import { Poster } from '@/components/Poster';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { siteForUrl } from '@/lib/catalog/sites';
import { formatBytes } from '@/lib/format';
import { useEpisodes, useFollows } from '@/lib/hooks';
import { isNew, seriesKey, showSummaries } from '@/lib/library';
import { onSeriesRenamed } from '@/lib/library-edit';

/** One series, like a folder: play where you left off, or pick an episode; each season collapses. */
export default function ShowScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const colors = useColors();
  const episodes = useEpisodes();
  const show = useMemo(() => showSummaries(episodes).find((s) => s.key === key) ?? null, [episodes, key]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const follows = useFollows();

  // Renamed or merged from this page: follow it to its new name.
  useEffect(() => onSeriesRenamed((from, to) => from === key && router.setParams({ key: to })), [key]);

  if (!show) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: '' }} />
        <Text style={{ color: colors.muted }}>No downloaded episodes here any more.</Text>
      </View>
    );
  }

  const leave = () => {
    if (router.canGoBack()) router.back();
  };
  const multi = show.seasons.length > 1;
  // The show's page on its site, reached through the newest downloaded episode's page.
  const onlineSource = [...show.episodes].reverse().find((e) => e.pageUrl && siteForUrl(e.pageUrl));
  const online = onlineSource?.pageUrl ? { page: onlineSource.pageUrl, site: siteForUrl(onlineSource.pageUrl)!.name } : null;
  const following = follows.some((f) => seriesKey(f.show) === show.key);
  const sections = show.seasons.map((s) => ({
    key: s.show,
    title: s.season !== null ? `Season ${s.season}` : multi ? 'Other episodes' : '',
    count: s.episodes.length,
    fresh: s.episodes.filter(isNew).length,
    data: collapsed.has(s.show) ? [] : s.episodes,
  }));

  function toggle(sectionKey: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(e) => String(e.id)}
      contentInsetAdjustmentBehavior="automatic"
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen
            options={{
              title: show.title,
              headerRight: () => (
                <Pressable onPress={() => showActions(show.title, show.episodes, leave, show.key)} hitSlop={12} accessibilityLabel="Show options">
                  <Text style={{ color: colors.tint, fontSize: 18, fontWeight: '700' }}>•••</Text>
                </Pressable>
              ),
            }}
          />
          <View style={styles.top} lightColor="transparent" darkColor="transparent">
            <Poster shows={[...show.seasons].reverse().map((s) => s.show)} fallback={show.episodes[0]} width={96} />
            <View style={styles.topText} lightColor="transparent" darkColor="transparent">
              <Text style={styles.title}>{show.title}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {multi ? `${show.seasons.length} seasons · ` : ''}
                {show.episodes.length} episode{show.episodes.length === 1 ? '' : 's'} · {formatBytes(show.bytes)}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {show.unwatched} unwatched{show.fresh ? ` · ${show.fresh} new` : ''}
              </Text>
            </View>
          </View>
          {show.next ? (
            <Pressable
              onPress={() => playEpisode(show.next!.id)}
              style={({ pressed }) => [styles.play, { backgroundColor: colors.tint, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.playText}>
                ▶ {show.resume ? 'Resume' : 'Play'} {multi ? `${seasonLabel(show.next.show)}` : ''}
                {show.next.title}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.meta, { color: colors.muted, marginTop: 12 }]}>All watched.</Text>
          )}
          {online ? (
            <Pressable
              onPress={() => openOnline(online.page, show.title)}
              style={({ pressed }) => [styles.online, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ fontWeight: '600' }}>
                {following ? '✓ Following · ' : ''}More episodes on {online.site}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.tip, { color: colors.muted }]}>Swipe an episode right to mark it watched, left to delete it.</Text>
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.title ? (
          <Pressable onPress={() => toggle(section.key)} style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {collapsed.has(section.key) ? '▸' : '▾'} {section.title}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {section.count} episode{section.count === 1 ? '' : 's'}
              {section.fresh ? ` · ${section.fresh} new` : ''}
            </Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => <EpisodeRow episode={item} />}
    />
  );
}

/** "Season 10 · " for the play button when a series has several seasons. */
function seasonLabel(show: string) {
  const m = show.match(/season\s*(\d+)/i);
  return m ? `S${m[1]} · ` : '';
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  top: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  topText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  meta: { fontSize: 14, marginTop: 2 },
  play: { marginTop: 14, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  playText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  tip: { fontSize: 12, marginTop: 10 },
  online: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
});
