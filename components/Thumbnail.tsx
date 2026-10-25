import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Episode } from '@/lib/db';
import { videoFile } from '@/lib/downloads';
import { ensureThumbnail, thumbFile } from '@/lib/thumbs';

import { useColors } from './useColors';

/** The episode's still, made on first display for videos downloaded before thumbnails existed. */
/** `width` sets a larger 16:9 size (the default is a small list thumbnail). */
export function Thumbnail({ episode, width }: { episode: Episode; width?: number }) {
  const colors = useColors();
  const [uri, setUri] = useState(() => {
    const f = thumbFile(episode.id);
    return f.exists ? f.uri : null;
  });

  useEffect(() => {
    if (uri) return;
    let alive = true;
    ensureThumbnail(episode, videoFile(episode).uri).then((made) => {
      if (alive && made) setUri(thumbFile(episode.id).uri);
    });
    return () => {
      alive = false;
    };
  }, [episode, uri]);

  return (
    <View style={[styles.box, width ? { width, height: Math.round((width * 9) / 16), borderRadius: 0 } : null, { backgroundColor: colors.border }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={String(episode.id)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 96, height: 54, borderRadius: 6, overflow: 'hidden' },
});
