import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { playEpisode, showActions } from '@/components/libraryActions';
import { Text, View } from '@/components/Themed';
import { Thumbnail } from '@/components/Thumbnail';
import { useColors } from '@/components/useColors';
import type { Episode } from '@/lib/db';
import { formatBytes } from '@/lib/format';
import { useEpisodes } from '@/lib/hooks';
import { continueWatching, findShows, showSummaries, type ShowSort, type ShowSummary } from '@/lib/library';
import { getLibrarySort, setLibrarySort } from '@/lib/settings';

const SORTS: { value: ShowSort; label: string }[] = [
  { value: 'recent', label: 'Recently watched' },
  { value: 'az', label: 'A–Z' },
  { value: 'added', label: 'Recently added' },
];

/** The Library: what to continue, then one row per show (tap a show to see its episodes). */
export default function LibraryScreen() {
  const episodes = useEpisodes();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ShowSort>(getLibrarySort);

  const shows = useMemo(() => showSummaries(episodes), [episodes]);
  const listed = useMemo(() => findShows(shows, query, sort), [shows, query, sort]);
  const resume = useMemo(() => continueWatching(episodes), [episodes]);

  if (shows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No videos yet</Text>
        <Text style={[styles.emptyBody, { color: colors.muted }]}>
          Find an episode in the Browser tab, or paste a video link in Downloads. Finished downloads show up here and play
          offline.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={listed}
      keyExtractor={(s) => s.key}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        <View>
          {resume.length > 0 && !query ? (
            <>
              <Text style={[styles.heading, styles.padded]}>Continue watching</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
                {resume.map(({ episode, resume: partway }) => (
                  <ContinueCard key={episode.id} episode={episode} partway={partway} />
                ))}
              </ScrollView>
            </>
          ) : null}
          <View style={styles.showsHeader}>
            <Text style={styles.heading}>Shows</Text>
            <Text style={[styles.count, { color: colors.muted }]}>{shows.length}</Text>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search shows"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            style={[styles.search, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
          />
          <View style={styles.sorts}>
            {SORTS.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => {
                  setSort(o.value);
                  setLibrarySort(o.value);
                }}
                style={[styles.sort, { borderColor: colors.border, backgroundColor: sort === o.value ? colors.tint : colors.card }]}>
                <Text style={{ color: sort === o.value ? '#fff' : colors.text, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={[styles.noMatch, { color: colors.muted }]}>No shows match “{query}”.</Text>}
      renderItem={({ item }) => <ShowRow show={item} />}
    />
  );
}

function ContinueCard({ episode, partway }: { episode: Episode; partway: boolean }) {
  const colors = useColors();
  const fraction = episode.durationSec > 0 ? Math.min(1, episode.positionSec / episode.durationSec) : 0;
  return (
    <Pressable
      onPress={() => playEpisode(episode.id)}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
      <Thumbnail episode={episode} width={220} />
      <View style={styles.cardText} lightColor="transparent" darkColor="transparent">
        <Text style={styles.cardShow} numberOfLines={1}>
          {episode.show}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
          {partway ? `Resume ${episode.title}` : `Next: ${episode.title}`}
        </Text>
      </View>
      {partway && fraction > 0 ? (
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: colors.tint }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ShowRow({ show }: { show: ShowSummary<Episode> }) {
  const colors = useColors();
  const cover = show.next ?? show.episodes[0];
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/show/[key]', params: { key: show.key } })}
      onLongPress={() => showActions(show.title, show.episodes)}
      style={({ pressed }) => [styles.showRow, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
      <Thumbnail episode={cover} />
      <View style={styles.showText} lightColor="transparent" darkColor="transparent">
        <Text style={styles.showTitle} numberOfLines={2}>
          {show.title}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
          {show.episodes.length} episode{show.episodes.length === 1 ? '' : 's'}
          {show.unwatched > 0 && show.unwatched < show.episodes.length ? ` · ${show.unwatched} unwatched` : ''}
          {show.unwatched === 0 ? ' · all watched' : ''} · {formatBytes(show.bytes)}
        </Text>
        {show.next ? (
          <Text style={[styles.meta, { color: colors.tint }]} numberOfLines={1}>
            {show.resume ? `Resume ${show.next.title}` : `Up next: ${show.next.title}`}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  heading: { fontSize: 18, fontWeight: '700' },
  padded: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  count: { fontSize: 15 },
  continueRow: { paddingHorizontal: 16, gap: 10 },
  card: { width: 220, borderRadius: 10, overflow: 'hidden' },
  cardText: { padding: 10 },
  cardShow: { fontSize: 15, fontWeight: '600' },
  showsHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  search: { marginHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16 },
  sorts: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sort: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  noMatch: { textAlign: 'center', padding: 24, fontSize: 15 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10 },
  showText: { flex: 1 },
  showTitle: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 3 },
  chevron: { fontSize: 26, fontWeight: '300' },
  track: { height: 3 },
  fill: { height: 3 },
});
