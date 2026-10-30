import { useEvent } from 'expo';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { VideoAirPlayButton, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/lib/format';
import { INTRO_SKIP_CHOICES, nextRate, offerSkipIntro, rateLabel, skipTarget, tapZone } from '@/lib/player';

const HIDE_AFTER_MS = 3500;
const DOUBLE_TAP_MS = 280;
const SKIP_SEC = 10;

type Props = {
  player: VideoPlayer;
  title: string;
  subtitle: string;
  /** Current position, kept fresh by the screen's timeUpdate listener. */
  currentTime: number;
  duration: number;
  landscape: boolean;
  onToggleRotate: () => void;
  /** Saved subtitles: whether they're on and the line to show now. Null when the video has none. */
  captions: { on: boolean; text: string } | null;
  onToggleCaptions: () => void;
  /** How far Skip intro jumps for this series, and a way to change it (remembered per series). */
  introSec: number;
  onSetIntroSec: (seconds: number) => void;
  onPictureInPicture: () => void;
  onClose: () => void;
};

// Player changes live outside the component: the player object belongs to the screen.
function seekTo(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

function setRate(player: VideoPlayer, rate: number) {
  player.playbackRate = rate;
}

function togglePlay(player: VideoPlayer) {
  if (player.playing) player.pause();
  else player.play();
}

function Icon({ ios, android, size = 24 }: { ios: SymbolViewProps['name'] & string; android: string; size?: number }) {
  return (
    <SymbolView
      name={{ ios, android, web: android } as SymbolViewProps['name']}
      tintColor="#fff"
      size={size}
      fallback={<Text style={{ color: '#fff', fontSize: size * 0.8 }}>•</Text>}
    />
  );
}

/**
 * The player's own controls over the video: tap to show or hide, double-tap
 * the left or right side to skip 10 s, a scrub bar, speed, skip intro,
 * AirPlay, Picture in Picture and a rotate button.
 */
export function PlayerControls(p: Props) {
  const { player } = p;
  const insets = useSafeAreaInsets();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { playbackRate } = useEvent(player, 'playbackRateChange', { playbackRate: player.playbackRate, oldPlaybackRate: 1 });

  const [visible, setVisible] = useState(true);
  const [poke, setPoke] = useState(0); // any interaction restarts the hide timer
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<{ zone: 'back' | 'forward'; total: number; key: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [introUsed, setIntroUsed] = useState(false);
  const lastTap = useRef<{ at: number; zone: string } | null>(null);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible || !isPlaying || scrub !== null) return;
    const t = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible, isPlaying, poke, scrub]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => () => {
    if (singleTap.current) clearTimeout(singleTap.current);
  }, []);

  const touch = () => setPoke((n) => n + 1);

  function skip(by: number) {
    seekTo(player, skipTarget(player.currentTime, by, player.duration));
    touch();
  }

  function onTap(x: number) {
    const zone = tapZone(x, width);
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = { at: now, zone };
    if (zone !== 'middle' && prev && prev.zone === zone && now - prev.at < DOUBLE_TAP_MS * 2.5) {
      // A double tap, or more taps continuing a skip: each one skips another 10 s.
      if (singleTap.current) clearTimeout(singleTap.current);
      singleTap.current = null;
      const by = zone === 'back' ? -SKIP_SEC : SKIP_SEC;
      seekTo(player, skipTarget(player.currentTime, by, player.duration));
      setFlash((f) => ({ zone, total: f && f.zone === zone ? f.total + SKIP_SEC : SKIP_SEC, key: now }));
      return;
    }
    if (singleTap.current) clearTimeout(singleTap.current);
    // A single tap shows or hides the controls, once it's clear it isn't the start of a double tap.
    singleTap.current = setTimeout(
      () => {
        singleTap.current = null;
        setVisible((v) => !v);
      },
      zone === 'middle' ? 0 : DOUBLE_TAP_MS
    );
  }

  const duration = p.duration > 0 ? p.duration : player.duration;
  const shown = scrub ?? p.currentTime;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={(e) => onTap(e.nativeEvent.locationX)} />

      {flash ? (
        <View style={[styles.flash, flash.zone === 'back' ? { left: '8%' } : { right: '8%' }]} pointerEvents="none">
          <Text style={styles.flashText}>
            {flash.zone === 'back' ? '« ' : ''}
            {flash.total} s{flash.zone === 'forward' ? ' »' : ''}
          </Text>
        </View>
      ) : null}

      {p.captions?.text ? (
        <View
          style={[styles.captions, { bottom: (visible ? 96 : 24) + insets.bottom, left: insets.left + 24, right: insets.right + 24 }]}
          pointerEvents="none">
          <Text style={styles.captionText}>{p.captions.text}</Text>
        </View>
      ) : null}

      {visible ? (
        <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="box-none">
          <View
            style={[styles.topBar, { paddingTop: insets.top + 6, paddingLeft: insets.left + 8, paddingRight: insets.right + 8 }]}
            pointerEvents="box-none">
            <RoundButton onPress={p.onClose} label="Close">
              <Icon ios="xmark" android="close" size={20} />
            </RoundButton>
            <View style={styles.titles} pointerEvents="none">
              <Text style={styles.title} numberOfLines={1}>
                {p.title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {p.subtitle}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setRate(player, nextRate(playbackRate));
                touch();
              }}
              hitSlop={8}
              style={styles.pill}
              accessibilityLabel="Playback speed">
              <Text style={styles.pillText}>{rateLabel(playbackRate)}</Text>
            </Pressable>
            {p.captions ? (
              <Pressable
                onPress={() => {
                  p.onToggleCaptions();
                  touch();
                }}
                hitSlop={8}
                style={[styles.pill, p.captions.on && styles.pillOn]}
                accessibilityLabel={p.captions.on ? 'Hide subtitles' : 'Show subtitles'}>
                <Text style={[styles.pillText, p.captions.on && styles.pillOnText]}>CC</Text>
              </Pressable>
            ) : null}
            {Platform.OS === 'ios' ? <VideoAirPlayButton style={styles.airplay} tint="#fff" /> : null}
            <RoundButton onPress={p.onPictureInPicture} label="Picture in Picture">
              <Icon ios="pip.enter" android="picture_in_picture_alt" size={20} />
            </RoundButton>
            <RoundButton onPress={p.onToggleRotate} label={p.landscape ? 'Upright' : 'Sideways'}>
              <Icon ios="rotate.right" android="screen_rotation" size={20} />
            </RoundButton>
          </View>

          <View style={styles.center} pointerEvents="box-none">
            <RoundButton onPress={() => skip(-SKIP_SEC)} label="Back 10 seconds" big>
              <Icon ios="gobackward.10" android="replay_10" size={30} />
            </RoundButton>
            <RoundButton
              onPress={() => {
                togglePlay(player);
                touch();
              }}
              label={isPlaying ? 'Pause' : 'Play'}
              big>
              <Icon ios={isPlaying ? 'pause.fill' : 'play.fill'} android={isPlaying ? 'pause' : 'play_arrow'} size={38} />
            </RoundButton>
            <RoundButton onPress={() => skip(SKIP_SEC)} label="Forward 10 seconds" big>
              <Icon ios="goforward.10" android="forward_10" size={30} />
            </RoundButton>
          </View>

          <View
            style={[styles.bottom, { paddingBottom: insets.bottom + 10, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}
            pointerEvents="box-none">
            {offerSkipIntro(p.currentTime, duration, introUsed) ? (
              <Pressable
                onPress={() => {
                  setIntroUsed(true);
                  skip(p.introSec);
                }}
                onLongPress={() =>
                  Alert.alert('Skip intro length', 'How long this show’s opening is. Remembered for this series.', [
                    ...INTRO_SKIP_CHOICES.map((sec) => ({
                      text: `${sec} seconds${sec === p.introSec ? ' ✓' : ''}`,
                      onPress: () => p.onSetIntroSec(sec),
                    })),
                    { text: 'Cancel', style: 'cancel' as const },
                  ])
                }
                style={styles.skipIntro}
                hitSlop={6}>
                <Text style={styles.skipIntroText}>Skip intro ({p.introSec} s) ›</Text>
              </Pressable>
            ) : null}
            <View style={styles.timeRow} pointerEvents="box-none">
              <Text style={styles.time}>{formatDuration(shown)}</Text>
              <Scrubber
                fraction={fraction}
                onScrub={(f) => {
                  setScrub(f * duration);
                  touch();
                }}
                onRelease={(f) => {
                  if (duration > 0) seekTo(player, skipTarget(0, f * duration, duration));
                  setScrub(null);
                }}
              />
              <Text style={styles.time}>-{formatDuration(Math.max(0, duration - shown))}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoundButton({ onPress, label, big, children }: { onPress: () => void; label: string; big?: boolean; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={label}
      style={({ pressed }) => [big ? styles.bigButton : styles.button, { opacity: pressed ? 0.6 : 1 }]}>
      {children}
    </Pressable>
  );
}

/** A seek bar: drag (or tap) anywhere along it; the video jumps when you let go. */
function Scrubber({ fraction, onScrub, onRelease }: { fraction: number; onScrub: (f: number) => void; onRelease: (f: number) => void }) {
  const [box, setBox] = useState({ x: 0, width: 1 });
  const at = (pageX: number) => Math.min(1, Math.max(0, (pageX - box.x) / box.width));

  return (
    <View
      style={styles.scrubArea}
      onLayout={(e) => {
        const target = e.currentTarget;
        target.measureInWindow((x, _y, w) => setBox({ x, width: Math.max(1, w) }));
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => onScrub(at(e.nativeEvent.pageX))}
      onResponderMove={(e) => onScrub(at(e.nativeEvent.pageX))}
      onResponderRelease={(e) => onRelease(at(e.nativeEvent.pageX))}
      onResponderTerminate={(e) => onRelease(at(e.nativeEvent.pageX))}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={[styles.knob, { left: `${fraction * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titles: { flex: 1, marginHorizontal: 6 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bigButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  airplay: { width: 40, height: 40 },
  pill: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  pillOn: { backgroundColor: 'rgba(255,255,255,0.92)' },
  pillOnText: { color: '#000' },
  captions: { position: 'absolute', alignItems: 'center' },
  captionText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  center: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 40 },
  bottom: { gap: 10 },
  skipIntro: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.92)' },
  skipIntroText: { color: '#000', fontSize: 15, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 48, textAlign: 'center' },
  scrubArea: { flex: 1, height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#fff' },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#fff' },
  flash: { position: 'absolute', top: '45%', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)' },
  flashText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
