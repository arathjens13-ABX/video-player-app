import { Pressable, StyleSheet } from 'react-native';

import type { Episode } from '@/lib/db';
import { formatDuration } from '@/lib/format';

import { episodeActions, playEpisode } from './libraryActions';
import { Text, View } from './Themed';
import { Thumbnail } from './Thumbnail';
import { useColors } from './useColors';

/** An episode in a show's list: tap to play, long-press for rename / watched / delete. */
export function EpisodeRow({ episode }: { episode: Episode }) {
  const colors = useColors();
  const fraction = episode.durationSec > 0 ? Math.min(1, episode.positionSec / episode.durationSec) : 0;
  return (
    <Pressable
      onPress={() => playEpisode(episode.id)}
      onLongPress={() => episodeActions(episode)}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.inner} lightColor="transparent" darkColor="transparent">
        <Thumbnail episode={episode} />
        <View style={styles.text} lightColor="transparent" darkColor="transparent">
          <Text style={styles.title} numberOfLines={1}>
            {episode.watched ? '✓ ' : ''}
            {episode.title}
          </Text>
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
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
  inner: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 },
  text: { flex: 1 },
  title: { fontSize: 16, fontWeight: '500' },
  meta: { fontSize: 13, marginTop: 4 },
  track: { height: 3 },
  fill: { height: 3 },
});
