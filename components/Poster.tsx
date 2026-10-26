import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { Episode } from '@/lib/db';
import { useCover } from '@/lib/hooks';

import { Thumbnail } from './Thumbnail';
import { useColors } from './useColors';

/**
 * A series' poster from the site (portrait), or a still from one of its
 * episodes until a poster has been saved.
 */
export function Poster({ shows, fallback, width = 64 }: { shows: string[]; fallback: Episode; width?: number }) {
  const colors = useColors();
  const uri = useCover(shows);
  if (!uri) return <Thumbnail episode={fallback} />;
  return (
    <View style={[styles.box, { width, height: Math.round(width * 1.4), backgroundColor: colors.border }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, overflow: 'hidden' },
});
