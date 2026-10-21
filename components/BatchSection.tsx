import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { pauseBatch, removeBatchItem, resumeBatch, retryBatchItem, stopBatch, type BatchItem } from '@/lib/batch';
import { useBatch } from '@/lib/hooks';
import { requestOpenInBrowser } from '@/lib/open-in-browser';

import { Text, View } from './Themed';
import { useColors } from './useColors';

/** Rows shown before "and N more", so a 200-episode season doesn't make a 200-row screen. */
const SHOWN = 15;

/** The season downloads still to come, under the Downloads list. */
export function BatchSection() {
  const colors = useColors();
  const { items, note, paused } = useBatch();
  if (items.length === 0) return null;

  const failed = items.filter((i) => i.status === 'failed').length;
  const shows = [...new Set(items.map((i) => i.show))];

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Season downloads</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {items.length - failed} to go{failed ? ` · ${failed} not found` : ''} · {shows.join(', ')}
      </Text>
      {note ? <Text style={[styles.note, { backgroundColor: colors.card }]}>{note}</Text> : null}
      <View style={styles.buttons} lightColor="transparent" darkColor="transparent">
        {paused || note ? (
          <SmallButton title="Resume" onPress={resumeBatch} />
        ) : (
          <SmallButton title="Pause" onPress={pauseBatch} />
        )}
        <SmallButton
          title="Stop"
          danger
          onPress={() =>
            Alert.alert('Stop season downloads?', 'Episodes that haven’t started are taken off the list. Finished and running downloads stay.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Stop', style: 'destructive', onPress: stopBatch },
            ])
          }
        />
      </View>
      {items.slice(0, SHOWN).map((item) => (
        <BatchRow key={item.id} item={item} />
      ))}
      {items.length > SHOWN ? (
        <Text style={[styles.meta, { color: colors.muted }]}>and {items.length - SHOWN} more</Text>
      ) : null}
    </View>
  );
}

function BatchRow({ item }: { item: BatchItem }) {
  const colors = useColors();
  const status =
    item.status === 'finding' ? 'Finding the video…' : item.status === 'failed' ? (item.error ?? 'Video not found') : 'Waiting';
  return (
    <View style={[styles.row, { backgroundColor: colors.card }]}>
      <Text style={styles.title} numberOfLines={1}>
        {item.show} · {item.title}
      </Text>
      <Text style={[styles.meta, { color: item.status === 'failed' ? colors.danger : colors.muted }]} numberOfLines={3}>
        {status}
      </Text>
      {item.status === 'failed' ? (
        <View style={styles.buttons} lightColor="transparent" darkColor="transparent">
          <SmallButton title="Retry" onPress={() => retryBatchItem(item.id)} />
          <SmallButton
            title="Open page"
            onPress={() => {
              requestOpenInBrowser(item.pageUrl);
              router.navigate('/browser');
            }}
          />
          <SmallButton title="Remove" danger onPress={() => removeBatchItem(item.id)} />
        </View>
      ) : null}
    </View>
  );
}

function SmallButton({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.button, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
      <Text style={{ color: danger ? colors.danger : colors.tint, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  note: { fontSize: 14, lineHeight: 20, padding: 10, borderRadius: 10, overflow: 'hidden', marginTop: 8 },
  row: { borderRadius: 10, padding: 12, marginTop: 8 },
  title: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 13, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
});
