import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, SectionList, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Thumbnail } from '@/components/Thumbnail';
import { useColors } from '@/components/useColors';
import { batch, updateEpisode, type Episode } from '@/lib/db';
import { remove } from '@/lib/downloads';
import { formatBytes, formatDuration } from '@/lib/format';
import { continueWatching, groupByShow, showBytes } from '@/lib/library';
import { useEpisodes } from '@/lib/hooks';

export default function LibraryScreen() {
  const episodes = useEpisodes();
  const colors = useColors();

  const sections = useMemo(() => groupByShow(episodes), [episodes]);
  const resume = useMemo(() => continueWatching(episodes), [episodes]);
  const play = (id: number) => router.push({ pathname: '/player/[id]', params: { id } });

  function showActions(e: Episode) {
    Alert.alert(e.title, e.show, [
      { text: 'Edit details', onPress: () => router.push({ pathname: '/episode-form', params: { id: e.id } }) },
      {
        text: e.watched ? 'Mark as unwatched' : 'Mark as watched',
        onPress: () => updateEpisode(e.id, { watched: e.watched ? 0 : 1, positionSec: 0 }),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete this video?', 'The file will be removed from your phone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => remove(e.id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function showShowActions(show: string, list: Episode[]) {
    const unwatched = list.filter((e) => !e.watched).length;
    Alert.alert(show, `${list.length} downloaded episode${list.length === 1 ? '' : 's'}`, [
      {
        text: unwatched > 0 ? 'Mark all as watched' : 'Mark all as unwatched',
        onPress: () => batch(() => list.forEach((e) => updateEpisode(e.id, { watched: unwatched > 0 ? 1 : 0, positionSec: 0 }))),
      },
      ...(list.length - unwatched > 0
        ? [
            {
              text: `Delete ${list.length - unwatched} watched`,
              style: 'destructive' as const,
              onPress: () =>
                Alert.alert('Delete watched episodes?', `${list.length - unwatched} video(s) will be removed from your phone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => batch(() => list.filter((e) => e.watched).forEach((e) => remove(e.id))),
                  },
                ]),
            },
          ]
        : []),
      {
        text: 'Delete whole show',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Delete all of ${show}?`, `${list.length} video${list.length === 1 ? '' : 's'} will be removed from your phone.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => batch(() => list.forEach((e) => remove(e.id))) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (sections.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No videos yet</Text>
        <Text style={[styles.emptyBody, { color: colors.muted }]}>
          Paste a video link in the Downloads tab. Finished downloads show up here and play offline.
        </Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(e) => String(e.id)}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        resume.length > 0 ? (
          <View>
            <Text style={[styles.sectionTitle, styles.continueTitle]}>Continue watching</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
              {resume.map(({ episode, resume: partway }) => {
                const fraction = episode.durationSec > 0 ? Math.min(1, episode.positionSec / episode.durationSec) : 0;
                return (
                  <Pressable
                    key={episode.id}
                    onPress={() => play(episode.id)}
                    style={({ pressed }) => [styles.continueCard, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
                    <Thumbnail episode={episode} width={220} />
                    <View style={styles.continueText} lightColor="transparent" darkColor="transparent">
                      <Text style={styles.continueShow} numberOfLines={1}>
                        {episode.show}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                        {partway ? `Resume ${episode.title}` : `Next: ${episode.title}`}
                      </Text>
                    </View>
                    {partway && fraction > 0 ? (
                      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                        <View style={[styles.progressFill, { width: `${fraction * 100}%`, backgroundColor: colors.tint }]} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <Pressable onLongPress={() => showShowActions(section.title, section.data)}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionText}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={[styles.sectionMeta, { color: colors.muted }]}>
                {section.data.length} episode{section.data.length === 1 ? '' : 's'} · {formatBytes(showBytes(section.data))}
                {section.data.some((e) => e.watched) ? ` · ${section.data.filter((e) => e.watched).length} watched` : ''}
              </Text>
            </View>
            <Pressable onPress={() => showShowActions(section.title, section.data)} hitSlop={12} accessibilityLabel={`${section.title} options`}>
              <Text style={[styles.more, { color: colors.tint }]}>•••</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
      renderItem={({ item }) => {
        const fraction = item.durationSec > 0 ? Math.min(1, item.positionSec / item.durationSec) : 0;
        return (
          <Pressable
            onPress={() => play(item.id)}
            onLongPress={() => showActions(item)}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
            <View style={styles.rowInner} lightColor="transparent" darkColor="transparent">
              <Thumbnail episode={item} />
              <View style={styles.rowText} lightColor="transparent" darkColor="transparent">
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.watched ? '✓ ' : ''}
                  {item.title}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.muted }]}>
                  {item.durationSec > 0 ? formatDuration(item.durationSec) : 'Not played yet'}
                  {item.positionSec > 0 && !item.watched ? ` · ${formatDuration(item.positionSec)} watched` : ''}
                </Text>
              </View>
            </View>
            {fraction > 0 && !item.watched ? (
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, { width: `${fraction * 100}%`, backgroundColor: colors.tint }]} />
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionText: { flex: 1 },
  sectionMeta: { fontSize: 13, marginTop: 2 },
  more: { fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
  continueTitle: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  continueRow: { paddingHorizontal: 16, gap: 10 },
  continueCard: { width: 220, borderRadius: 10, overflow: 'hidden' },
  continueText: { padding: 10 },
  continueShow: { fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  row: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 4 },
  progressTrack: { height: 3 },
  progressFill: { height: 3 },
});
