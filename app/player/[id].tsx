import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getEpisode, listEpisodes, notify, updateEpisode, type Episode } from '@/lib/db';
import { videoFile } from '@/lib/downloads';
import { nextEpisode } from '@/lib/library';
import { logError, logInfo } from '@/lib/log';

function playEpisode(id: number) {
  router.replace({ pathname: '/player/[id]', params: { id } });
}

const WATCHED_FRACTION = 0.9;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Keyed by id so moving to the next episode starts a fresh player.
  return <Player key={id} episodeId={Number(id)} />;
}

const UP_NEXT_SECONDS = 5;

function Player({ episodeId }: { episodeId: number }) {
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
  useEventListener(player, 'sourceLoad', ({ duration, availableVideoTracks, availableAudioTracks }) => {
    if (!episode) return;
    logInfo(
      'player',
      `#${episode.id} loaded ${Math.round(duration)}s, ${availableVideoTracks?.length ?? '?'} video / ${availableAudioTracks?.length ?? '?'} audio tracks`
    );
    if (duration > 0) updateEpisode(episode.id, { durationSec: duration }, { silent: true });
    // Resume where we left off, unless that was the very end.
    if (!resumed.current && episode.positionSec > 5 && episode.positionSec < duration - 10) {
      player.currentTime = episode.positionSec;
    }
    resumed.current = true;
  });

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error') logError('player', `#${episodeId} can't play: ${error?.message ?? 'unknown error'}`);
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    savePosition(currentTime);
  });

  const [upNext, setUpNext] = useState<{ episode: Episode; seconds: number } | null>(null);
  useEventListener(player, 'playToEnd', () => {
    if (!episode) return;
    updateEpisode(episode.id, { positionSec: 0, watched: 1 });
    const next = nextEpisode(listEpisodes(), episode);
    if (next) setUpNext({ episode: next, seconds: UP_NEXT_SECONDS });
  });

  useEffect(() => {
    if (!upNext) return;
    const timer = setTimeout(() => {
      if (upNext.seconds <= 1) playEpisode(upNext.episode.id);
      else setUpNext({ ...upNext, seconds: upNext.seconds - 1 });
    }, 1000);
    return () => clearTimeout(timer);
  }, [upNext]);

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
      {upNext ? (
        <View style={styles.upNext}>
          <Text style={styles.upNextLabel}>Up next in {upNext.seconds}…</Text>
          <Text style={styles.upNextTitle} numberOfLines={1}>
            {upNext.episode.title}
          </Text>
          <View style={styles.upNextButtons}>
            <Pressable onPress={() => setUpNext(null)} hitSlop={8} style={styles.upNextButton}>
              <Text style={styles.upNextButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => playEpisode(upNext.episode.id)}
              hitSlop={8}
              style={[styles.upNextButton, styles.upNextPrimary]}>
              <Text style={styles.upNextButtonText}>Play now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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
  upNext: {
    position: 'absolute',
    right: 24,
    bottom: 80,
    width: 260,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(20,20,24,0.92)',
  },
  upNextLabel: { color: '#bbb', fontSize: 13 },
  upNextTitle: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 2 },
  upNextButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  upNextButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  upNextPrimary: { backgroundColor: '#4f7cff' },
  upNextButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
