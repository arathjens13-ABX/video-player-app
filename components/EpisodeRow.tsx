import { useRef } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { updateEpisode, type Episode } from '@/lib/db';
import { remove } from '@/lib/downloads';
import { formatDuration } from '@/lib/format';
import { isNew } from '@/lib/library';

import { episodeActions, playEpisode } from './libraryActions';
import { Text, View } from './Themed';
import { Thumbnail } from './Thumbnail';
import { useColors } from './useColors';

/**
 * An episode in a show's list: tap to play, long-press for rename / watched /
 * delete, swipe right to mark watched, swipe left to delete.
 */
export function EpisodeRow({ episode }: { episode: Episode }) {
  const colors = useColors();
  const swipe = useRef<SwipeableMethods>(null);
  const fraction = episode.durationSec > 0 ? Math.min(1, episode.positionSec / episode.durationSec) : 0;
  const fresh = isNew(episode);

  function toggleWatched() {
    updateEpisode(episode.id, { watched: episode.watched ? 0 : 1, positionSec: 0 });
    swipe.current?.close();
  }

  function confirmDelete() {
    Alert.alert(`Delete ${episode.title}?`, 'The file will be removed from your phone.', [
      { text: 'Cancel', style: 'cancel', onPress: () => swipe.current?.close() },
      { text: 'Delete', style: 'destructive', onPress: () => remove(episode.id) },
    ]);
  }

  return (
    <View style={styles.wrap} lightColor="transparent" darkColor="transparent">
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.5}
        leftThreshold={60}
        rightThreshold={60}
        overshootLeft={false}
        overshootRight={false}
        containerStyle={styles.swipe}
        renderLeftActions={() => (
          <Pressable onPress={toggleWatched} style={[styles.action, { backgroundColor: colors.tint }]}>
            <Text style={styles.actionText}>{episode.watched ? 'Unwatched' : 'Watched'}</Text>
          </Pressable>
        )}
        renderRightActions={() => (
          <Pressable onPress={confirmDelete} style={[styles.action, { backgroundColor: colors.danger }]}>
            <Text style={styles.actionText}>Delete</Text>
          </Pressable>
        )}>
        <Pressable
          onPress={() => playEpisode(episode.id)}
          onLongPress={() => episodeActions(episode)}
          style={({ pressed }) => [{ backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
          <View style={styles.inner} lightColor="transparent" darkColor="transparent">
            <Thumbnail episode={episode} />
            <View style={styles.text} lightColor="transparent" darkColor="transparent">
              <View style={styles.titleRow} lightColor="transparent" darkColor="transparent">
                {fresh ? (
                  <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                    <Text style={styles.badgeText}>NEW</Text>
                  </View>
                ) : null}
                <Text style={styles.title} numberOfLines={1}>
                  {episode.watched ? '✓ ' : ''}
                  {episode.title}
                </Text>
              </View>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {episode.durationSec > 0 ? formatDuration(episode.durationSec) : 'Not played yet'}
                {episode.positionSec > 0 && !episode.watched ? ` · ${formatDuration(episode.positionSec)} watched` : ''}
              </Text>
            </View>
          </View>
          {fraction > 0 && !episode.watched ? (
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: colors.tint }]} />
            </View>
          ) : null}
        </Pressable>
      </ReanimatedSwipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 8 },
  swipe: { borderRadius: 10, overflow: 'hidden' },
  inner: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 },
  text: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '500', flexShrink: 1 },
  meta: { fontSize: 13, marginTop: 4 },
  badge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  track: { height: 3 },
  fill: { height: 3 },
  action: { width: 96, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
