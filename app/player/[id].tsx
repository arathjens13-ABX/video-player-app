import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PlayerControls } from '@/components/PlayerControls';
import { getEpisode, listEpisodes, notify, updateEpisode, type Episode } from '@/lib/db';
import { subtitleFile, videoFile } from '@/lib/downloads';
import { nextEpisode, seriesKey } from '@/lib/library';
import { logError, logInfo, logWarn } from '@/lib/log';
import { getIntroSkip, getStartLandscape, getSubtitlesOn, setIntroSkip, setSubtitlesOn } from '@/lib/settings';
import { cueTextAt, parseCues, type Cue } from '@/lib/subtitles';

function playEpisode(id: number) {
  router.replace({ pathname: '/player/[id]', params: { id } });
}

const WATCHED_FRACTION = 0.9;

/** Players on screen; more than one only for a moment while "Up next" swaps episodes. */
let openPlayers = 0;
/** The rotate choice of the player just closed, so the next episode keeps it. */
let lastLandscape: boolean | null = null;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Keyed by id so moving to the next episode starts a fresh player.
  return <Player key={id} episodeId={Number(id)} />;
}

const UP_NEXT_SECONDS = 5;

/** The subtitles saved with an episode, or none. */
function readCues(episode: Episode | null): Cue[] {
  if (!episode) return [];
  try {
    const file = subtitleFile(episode);
    return file.exists ? parseCues(file.textSync()) : [];
  } catch (e) {
    logWarn('player', `#${episode.id} subtitles unreadable:`, e);
    return [];
  }
}

function Player({ episodeId }: { episodeId: number }) {
  // Read once: re-rendering on every position save would reset the player.
  const [episode] = useState(() => getEpisode(episodeId));
  const uri = episode ? videoFile(episode).uri : null;
  const [cues] = useState(() => readCues(episode));
  const [subsOn, setSubsOn] = useState(getSubtitlesOn);

  const player = useVideoPlayer(uri ? { uri, metadata: { title: episode?.title, artist: episode?.show } } : null, (p) => {
    // Twice a second keeps the scrub bar smooth (four times with subtitles, so lines change on time);
    // the position is saved less often (savePosition).
    p.timeUpdateEventInterval = cues.length ? 0.25 : 0.5;
    p.showNowPlayingNotification = true;
    p.staysActiveInBackground = true;
    p.allowsExternalPlayback = true;
    p.play();
  });

  const videoView = useRef<VideoView>(null);
  const series = episode ? seriesKey(episode.show) : '';
  const [introSec, setIntroSec] = useState(() => getIntroSkip(series));
  const [time, setTime] = useState({ current: episode?.positionSec ?? 0, duration: episode?.durationSec ?? 0 });

  // Sideways on open (if chosen in Settings), even with the phone's rotation lock on; upright again on close.
  const [landscape, setLandscape] = useState(() => lastLandscape ?? getStartLandscape());
  useEffect(() => {
    lastLandscape = landscape;
    ScreenOrientation.lockAsync(
      landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP
    ).catch((e: unknown) => logWarn('player', 'rotate failed:', e));
  }, [landscape]);
  useEffect(() => {
    openPlayers++;
    return () => {
      openPlayers--;
      // "Up next" swaps one player for the next: only go upright once no player is left.
      setTimeout(() => {
        if (openPlayers === 0) {
          lastLandscape = null;
          ScreenOrientation.unlockAsync().catch(() => {});
        }
      }, 400);
    };
  }, []);

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

  const lastSaved = useRef(0);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    setTime({ current: currentTime, duration: player.duration });
    if (Math.abs(currentTime - lastSaved.current) >= 2) savePosition(currentTime);
  });

  // Pausing (or scrubbing while paused) saves right away, not at the next tick.
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) savePosition(player.currentTime);
  });

  function close() {
    // Save while the player still exists; by the time this screen unmounts it has been released.
    try {
      savePosition(player.currentTime);
    } catch {
      // Already released.
    }
    router.back();
  }

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
    lastSaved.current = currentTime;
    const duration = player.duration;
    const watched = duration > 0 && currentTime / duration >= WATCHED_FRACTION;
    const lastPlayedAt = Date.now();
    updateEpisode(episode.id, watched ? { positionSec: 0, watched: 1, lastPlayedAt } : { positionSec: currentTime, lastPlayedAt }, { silent: true });
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
        <>
          <VideoView
            ref={videoView}
            style={StyleSheet.absoluteFill}
            player={player}
            nativeControls={false}
            allowsPictureInPicture
            startsPictureInPictureAutomatically
            contentFit="contain"
          />
          <PlayerControls
            player={player}
            title={episode?.title ?? ''}
            subtitle={episode?.show ?? ''}
            currentTime={time.current}
            duration={time.duration}
            landscape={landscape}
            onToggleRotate={() => setLandscape((l) => !l)}
            captions={cues.length ? { on: subsOn, text: subsOn ? cueTextAt(cues, time.current) : '' } : null}
            onToggleCaptions={() => {
              setSubsOn(!subsOn);
              setSubtitlesOn(!subsOn);
            }}
            introSec={introSec}
            onSetIntroSec={(sec) => {
              setIntroSec(sec);
              setIntroSkip(series, sec);
            }}
            onPictureInPicture={() => {
              videoView.current?.startPictureInPicture().catch((e: unknown) => logWarn('player', 'picture in picture failed:', e));
            }}
            onClose={close}
          />
        </>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  missing: { color: '#fff', textAlign: 'center', fontSize: 16 },
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
