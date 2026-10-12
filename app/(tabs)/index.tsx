import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, SectionList, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Thumbnail } from '@/components/Thumbnail';
import { useColors } from '@/components/useColors';
import { updateEpisode, type Episode } from '@/lib/db';
import { remove } from '@/lib/downloads';
import { formatDuration } from '@/lib/format';
import { groupByShow } from '@/lib/library';
import { useEpisodes } from '@/lib/hooks';

export default function LibraryScreen() {
  const episodes = useEpisodes();
  const colors = useColors();

  const sections = useMemo(() => groupByShow(episodes), [episodes]);

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
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => {
        const fraction = item.durationSec > 0 ? Math.min(1, item.positionSec / item.durationSec) : 0;
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/player/[id]', params: { id: item.id } })}
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
  sectionHeader: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  row: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 4 },
  progressTrack: { height: 3 },
  progressFill: { height: 3 },
});
