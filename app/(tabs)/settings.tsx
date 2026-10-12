import Constants from 'expo-constants';
import { Paths } from 'expo-file-system';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { videoFile } from '@/lib/downloads';
import { formatBytes } from '@/lib/format';
import { useEpisodes } from '@/lib/hooks';

export default function SettingsScreen() {
  const colors = useColors();
  const episodes = useEpisodes();

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

      <Text style={styles.heading}>About</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Row label="Version" value={Constants.expoConfig?.version ?? '?'} last />
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
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16 },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
