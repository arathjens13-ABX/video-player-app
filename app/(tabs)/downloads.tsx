import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import type { Episode } from '@/lib/db';
import { pause, remove, resume, retry } from '@/lib/downloads';
import { formatBytes } from '@/lib/format';
import { useEpisodes, useProgress } from '@/lib/hooks';
import { extractUrl } from '@/lib/links';
import { requestOpenInBrowser } from '@/lib/open-in-browser';
import { routeLink } from '@/lib/route-link';

export default function DownloadsScreen() {
  const colors = useColors();
  const episodes = useEpisodes().filter((e) => e.status !== 'done');
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);

  async function addLink(raw: string) {
    const url = extractUrl(raw);
    if (!url) {
      Alert.alert('That doesn’t look like a link', 'Paste a full web address, like https://example.com/video.mp4');
      return;
    }
    setChecking(true);
    try {
      await routeLink(url);
      setInput('');
    } finally {
      setChecking(false);
    }
  }

  async function pasteAndAdd() {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      Alert.alert('Clipboard is empty', 'Copy a video link first.');
      return;
    }
    setInput(text);
    addLink(text);
  }

  return (
    <FlatList
      data={episodes}
      keyExtractor={(e) => String(e.id)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.addBox}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => addLink(input)}
            placeholder="Paste a video link"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
          />
          <View style={styles.addButtons}>
            <Button title="Paste link" onPress={pasteAndAdd} disabled={checking} />
            <Button title="Add" onPress={() => addLink(input)} disabled={checking || !input.trim()} primary />
            {checking ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.muted }]}>
          No downloads in progress.{'\n'}Stream downloads need the app open; the screen stays on while they run.
        </Text>
      }
      renderItem={({ item }) => <DownloadRow episode={item} />}
    />
  );
}

function DownloadRow({ episode }: { episode: Episode }) {
  const colors = useColors();
  const { bytesWritten, totalBytes, fraction: knownFraction, note } = useProgress(episode);
  const fraction = knownFraction ?? (totalBytes > 0 ? bytesWritten / totalBytes : 0);

  const statusText = {
    queued: 'Waiting…',
    downloading: note
      ? `${note} · ${formatBytes(bytesWritten)}`
      : totalBytes > 0
        ? `${formatBytes(bytesWritten)} of ${formatBytes(totalBytes)}`
        : formatBytes(bytesWritten),
    paused: `Paused · ${formatBytes(bytesWritten)}`,
    error: episode.error ?? 'Failed',
    done: 'Done',
  }[episode.status];

  return (
    <View style={[styles.row, { backgroundColor: colors.card }]}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {episode.show} · {episode.title}
      </Text>
      <Text
        style={[styles.rowMeta, { color: episode.status === 'error' ? colors.danger : colors.muted }]}
        numberOfLines={2}>
        {statusText}
      </Text>
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { width: `${fraction * 100}%`, backgroundColor: colors.tint }]} />
      </View>
      <View style={styles.rowButtons} lightColor="transparent" darkColor="transparent">
        {episode.status === 'downloading' ? <Button title="Pause" onPress={() => pause(episode.id)} /> : null}
        {episode.status === 'paused' ? <Button title="Resume" onPress={() => resume(episode.id)} /> : null}
        {episode.status === 'error' && episode.pageUrl ? (
          <Button
            title="Find again"
            onPress={() => {
              requestOpenInBrowser(episode.pageUrl!, { episodeId: episode.id, title: `${episode.show} · ${episode.title}` });
              router.navigate('/browser');
            }}
          />
        ) : null}
        {episode.status === 'error' ? <Button title="Retry" onPress={() => retry(episode.id)} /> : null}
        <Button title="Remove" onPress={() => remove(episode.id)} danger />
      </View>
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled,
  primary,
  danger,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const colors = useColors();
  const color = danger ? colors.danger : primary ? '#fff' : colors.tint;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.tint : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addBox: { padding: 16 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 16 },
  addButtons: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 15 },
  row: { marginHorizontal: 16, marginBottom: 10, borderRadius: 10, padding: 14 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 4 },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 4 },
  rowButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, gap: 4 },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
