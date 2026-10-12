import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getEpisode, notify, updateEpisode } from '@/lib/db';
import { videoFile } from '@/lib/downloads';

const WATCHED_FRACTION = 0.9;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = Number(id);
  // Read once: re-rendering on every position save would reset the player.
  const episode = useRef(getEpisode(episodeId)).current;
  const uri = episode ? videoFile(episode).uri : null;

  const player = useVideoPlayer(uri ? { uri, metadata: { title: episode?.title, artist: episode?.show } } : null, (p) => {
    p.timeUpdateEventInterval = 5;
    p.showNowPlayingNotification = true;
    p.staysActiveInBackground = true;
    p.play();
  });

  const resumed = useRef(false);
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (!episode) return;
    if (duration > 0) updateEpisode(episode.id, { durationSec: duration }, { silent: true });
    // Resume where we left off, unless that was the very end.
    if (!resumed.current && episode.positionSec > 5 && episode.positionSec < duration - 10) {
      player.currentTime = episode.positionSec;
    }
    resumed.current = true;
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    savePosition(currentTime);
  });

  useEventListener(player, 'playToEnd', () => {
    if (episode) updateEpisode(episode.id, { positionSec: 0, watched: 1 });
  });

  function savePosition(currentTime: number) {
    if (!episode || !resumed.current) return;
    const duration = player.duration;
    const watched = duration > 0 && currentTime / duration >= WATCHED_FRACTION;
    updateEpisode(episode.id, watched ? { positionSec: 0, watched: 1 } : { positionSec: currentTime }, { silent: true });
  }

  useEffect(() => {
    return () => {
      // Final save on close, then tell the library to refresh.
      try {
        savePosition(player.currentTime);
      } catch {
        // The player may already be released.
      }
      notify();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden />
      {uri ? (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          nativeControls
          allowsPictureInPicture
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
        />
      ) : (
        <Text style={styles.missing}>This video couldn’t be found.</Text>
      )}
      <SafeAreaView style={styles.closeWrap} edges={['top', 'left']} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  missing: { color: '#fff', textAlign: 'center', fontSize: 16 },
  closeWrap: { position: 'absolute', top: 0, left: 0 },
  close: {
    margin: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 18 },
});
