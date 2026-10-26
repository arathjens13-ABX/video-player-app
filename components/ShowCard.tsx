import { Image } from 'expo-image';
import { Pressable, StyleSheet } from 'react-native';

import type { Card } from '@/lib/catalog/parse';

import { Text, View } from './Themed';
import { useColors } from './useColors';

/** A site's poster image: sent "from" the site, as sites like AnimeXin refuse images requested from nowhere. */
export function RemotePoster({ uri, referer, width, radius = 8 }: { uri: string | null; referer: string; width: number; radius?: number }) {
  const colors = useColors();
  return (
    <View style={[styles.poster, { width, height: Math.round(width * 1.42), borderRadius: radius, backgroundColor: colors.border }]}>
      {uri ? (
        <Image
          source={{ uri, headers: { Referer: referer } }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={uri}
          cachePolicy="disk"
          transition={150}
        />
      ) : null}
    </View>
  );
}

/** A show or episode in a Discover grid or row: poster, corner badge, title. */
export function ShowCard({ card, referer, width, onPress, note }: { card: Card; referer: string; width: number; onPress: () => void; note?: string }) {
  const colors = useColors();
  const badge = note ?? card.badge;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
      <View lightColor="transparent" darkColor="transparent">
        <RemotePoster uri={card.poster} referer={referer} width={width} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: note ? colors.tint : 'rgba(0,0,0,0.7)' }]}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {card.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poster: { overflow: 'hidden' },
  badge: { position: 'absolute', left: 6, bottom: 6, maxWidth: '88%', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  title: { fontSize: 13, fontWeight: '600', marginTop: 6, lineHeight: 17 },
});
