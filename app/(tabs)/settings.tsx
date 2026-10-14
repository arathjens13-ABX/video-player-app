import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { cleanUpFiles, temporaryFilesSize, videoFile } from '@/lib/downloads';
import { formatBytes } from '@/lib/format';
import { useEpisodes } from '@/lib/hooks';
import { clearLog, getLogEntries } from '@/lib/log';
import { BUILD, buildReport } from '@/lib/report';
import { QUALITY_OPTIONS, setStreamQuality, useStreamQuality } from '@/lib/settings';

export default function SettingsScreen() {
  const colors = useColors();
  const episodes = useEpisodes();
  const quality = useStreamQuality();
  const [temp, setTemp] = useState(temporaryFilesSize);
  const [logCount, setLogCount] = useState(() => getLogEntries().length);
  // Refresh counts each time the tab is shown.
  useFocusEffect(
    useCallback(() => {
      setLogCount(getLogEntries().length);
      setTemp(temporaryFilesSize());
    }, [])
  );

  const { count, used } = useMemo(() => {
    let total = 0;
    let n = 0;
    for (const e of episodes) {
      if (e.status !== 'done') continue;
      n++;
      try {
        total += videoFile(e).size ?? 0;
      } catch {
        // Missing file; counts as zero.
      }
    }
    return { count: n, used: total };
  }, [episodes]);

  let free = -1;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // Not available on this platform.
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Storage</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Row label="Downloaded videos" value={String(count)} />
        <Row label="Space used" value={formatBytes(used)} />
        <Row label="Free on phone" value={formatBytes(free)} last />
      </View>
      <Text style={[styles.hint, { color: colors.muted }]}>
        To free space, long-press a video in the Library and choose Delete. On iPhone, downloaded files are also
        visible in the Files app under “On My iPhone › VidStash”.
      </Text>

      <Text style={styles.heading}>Temporary files</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Row label="Unfinished stream pieces" value={formatBytes(temp)} last />
      </View>
      <Pressable
        onPress={() => {
          const freed = cleanUpFiles();
          setTemp(temporaryFilesSize());
          Alert.alert('Cleaned up', freed > 0 ? `Freed ${formatBytes(freed)}.` : 'Nothing to clean up.');
        }}
        hitSlop={8}>
        <Text style={[styles.action, { color: colors.tint }]}>Clean up leftover files</Text>
      </Pressable>
      <Text style={[styles.hint, { color: colors.muted }]}>
        Pieces of downloads that are still in your queue are kept so they can resume.
      </Text>

      <Text style={styles.heading}>Stream quality</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {QUALITY_OPTIONS.map((o, i) => (
          <Pressable key={o.value} onPress={() => setStreamQuality(o.value)}>
            <View
              style={[
                styles.row,
                i < QUALITY_OPTIONS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
              lightColor="transparent"
              darkColor="transparent">
              <View lightColor="transparent" darkColor="transparent">
                <Text style={styles.rowLabel}>{o.label}</Text>
                <Text style={[styles.rowHint, { color: colors.muted }]}>{o.hint}</Text>
              </View>
              <Text style={[styles.check, { color: colors.tint }]}>{quality === o.value ? '✓' : ''}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.hint, { color: colors.muted }]}>
        Applies to stream downloads you add from now on. MP4 files come in whatever quality the site offers.
      </Text>

      <Text style={styles.heading}>Diagnostics</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Row label="Log entries" value={String(logCount)} last />
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(buildReport());
            Alert.alert('Report copied', 'Paste it into a message to send it.');
          }}
          hitSlop={8}>
          <Text style={[styles.action, { color: colors.tint }]}>Copy report</Text>
        </Pressable>
        <Pressable onPress={() => Share.share({ message: buildReport() }).catch(() => {})} hitSlop={8}>
          <Text style={[styles.action, { color: colors.tint }]}>Share report</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert('Clear the log?', 'Start fresh before reproducing a problem.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  clearLog();
                  setLogCount(0);
                },
              },
            ])
          }
          hitSlop={8}>
          <Text style={[styles.action, { color: colors.danger }]}>Clear</Text>
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: colors.muted }]}>
        The report lists what the browser found, why links were rejected, and how each download went. It contains the
        web addresses and episode names involved, plus your app version and iOS version.
      </Text>

      <Text style={styles.heading}>About</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Row label="Version" value={Constants.expoConfig?.version ?? '?'} />
        <Row label="Build" value={BUILD.slice(0, 7)} last />
      </View>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
      lightColor="transparent"
      darkColor="transparent">
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.muted }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  heading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 10, paddingHorizontal: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16 },
  rowHint: { fontSize: 13, marginTop: 2 },
  check: { fontSize: 18, fontWeight: '700' },
  action: { fontSize: 16, fontWeight: '600', marginTop: 10 },
  actions: { flexDirection: 'row', gap: 24 },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
