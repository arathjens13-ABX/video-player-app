import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { listEpisodes } from '@/lib/db';
import { groupBySeries, seriesKey, showKey } from '@/lib/library';
import { announceSeriesRename, renameSeries } from '@/lib/library-edit';

/** Rename a series, or merge it into another by picking that one's name. */
export default function RenameShowScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const colors = useColors();
  const [all] = useState(() => groupBySeries(listEpisodes()));
  const series = all.find((s) => s.key === key) ?? null;
  const [name, setName] = useState(series?.title ?? '');
  const done = useRef(false);

  const others = useMemo(() => {
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    const rest = all.filter((s) => s.key !== key);
    const matching = rest.filter((s) => words.some((w) => s.key.includes(w)));
    return (matching.length ? matching : rest).slice(0, 12);
  }, [all, key, name]);

  if (!series) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Rename' }} />
        <Text style={{ color: colors.muted }}>This show is gone.</Text>
      </View>
    );
  }
  const current = series;

  function apply(newName: string) {
    if (done.current) return;
    const clean = newName.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    done.current = true;
    renameSeries(current.seasons, clean);
    announceSeriesRename(current.key, seriesKey(clean));
    router.back();
  }

  function save() {
    const target = all.find((s) => s.key !== key && s.key === showKey(name));
    if (target) merge(target.title);
    else apply(name);
  }

  function merge(title: string) {
    Alert.alert(`Merge into “${title}”?`, `${current.title}’s ${current.episodes.length} episode${current.episodes.length === 1 ? '' : 's'} join ${title}. Season numbers are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Merge', onPress: () => apply(title) },
    ]);
  }

  const seasonNote = current.seasons.some((s) => s.season !== null)
    ? `Seasons keep their numbers (“${name.trim() || '…'} Season ${current.seasons.find((s) => s.season !== null)!.season}”).`
    : null;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: 'Rename or merge',
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10}>
              <Text style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={styles.label}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={save}
        style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
      />
      {seasonNote ? <Text style={[styles.hint, { color: colors.muted }]}>{seasonNote}</Text> : null}

      {others.length ? (
        <>
          <Text style={styles.label}>Or merge into</Text>
          <Text style={[styles.hint, { color: colors.muted, marginTop: 0, marginBottom: 8 }]}>
            For the same show listed under two names.
          </Text>
          {others.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => merge(s.title)}
              style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.title}
              </Text>
              <Text style={[styles.hint, { color: colors.muted, marginTop: 2 }]}>
                {s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'}
                {s.seasons.length > 1 ? ` · ${s.seasons.length} seasons` : ''}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 16 },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  row: { borderRadius: 10, padding: 12, marginBottom: 8 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
});
