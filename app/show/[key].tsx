import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { EpisodeRow } from '@/components/EpisodeRow';
import { playEpisode, showActions } from '@/components/libraryActions';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { formatBytes } from '@/lib/format';
import { useEpisodes } from '@/lib/hooks';
import { showSummaries } from '@/lib/library';

/** One show's episodes, like a folder: play where you left off, or pick any episode. */
export default function ShowScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const colors = useColors();
  const episodes = useEpisodes();
  const show = useMemo(() => showSummaries(episodes).find((s) => s.key === key) ?? null, [episodes, key]);

  if (!show) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: 'Show' }} />
        <Text style={{ color: colors.muted }}>This show has no downloaded episodes.</Text>
      </View>
    );
  }

  const leave = () => {
    if (router.canGoBack()) router.back();
  };

  return (
    <FlatList
      data={show.episodes}
      keyExtractor={(e) => String(e.id)}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen
            options={{
              title: show.title,
              headerRight: () => (
                <Pressable onPress={() => showActions(show.title, show.episodes, leave)} hitSlop={12} accessibilityLabel="Show options">
                  <Text style={{ color: colors.tint, fontSize: 18, fontWeight: '700' }}>•••</Text>
                </Pressable>
              ),
            }}
          />
          <Text style={[styles.meta, { color: colors.muted }]}>
            {show.episodes.length} episode{show.episodes.length === 1 ? '' : 's'} · {show.unwatched} unwatched ·{' '}
            {formatBytes(show.bytes)}
          </Text>
          {show.next ? (
            <Pressable
              onPress={() => playEpisode(show.next!.id)}
              style={({ pressed }) => [styles.play, { backgroundColor: colors.tint, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.playText}>
                ▶ {show.resume ? 'Resume' : 'Play'} {show.next.title}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.meta, { color: colors.muted, marginTop: 8 }]}>All watched.</Text>
          )}
        </View>
      }
      renderItem={({ item }) => <EpisodeRow episode={item} />}
    />
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  meta: { fontSize: 14 },
  play: { marginTop: 12, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  playText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
