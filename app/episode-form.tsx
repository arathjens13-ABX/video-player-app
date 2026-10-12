import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { getEpisode, updateEpisode, type DownloadKind } from '@/lib/db';
import { enqueue } from '@/lib/downloads';
import { guessNames } from '@/lib/links';

/**
 * Two modes: with `url` + `kind` it confirms a new download; with `id` it edits
 * an existing episode's show name and title.
 */
export default function EpisodeForm() {
  const params = useLocalSearchParams<{ id?: string; url?: string; kind?: DownloadKind }>();
  const colors = useColors();
  const existing = params.id ? getEpisode(Number(params.id)) : null;
  const guessed = params.url ? guessNames(params.url) : null;

  const [show, setShow] = useState(existing?.show ?? guessed?.show ?? '');
  const [title, setTitle] = useState(existing?.title ?? guessed?.title ?? '');
  const [referer, setReferer] = useState('');

  function save() {
    const cleanShow = show.trim() || 'Unsorted';
    const cleanTitle = title.trim() || 'Untitled';
    if (existing) {
      updateEpisode(existing.id, { show: cleanShow, title: cleanTitle });
    } else if (params.url && params.kind) {
      enqueue({
        url: params.url,
        kind: params.kind,
        show: cleanShow,
        title: cleanTitle,
        referer: referer.trim() || null,
      });
    }
    router.back();
  }

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }];

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: existing ? 'Edit details' : 'New download',
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10}>
              <Text style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>
                {existing ? 'Save' : 'Download'}
              </Text>
            </Pressable>
          ),
        }}
      />
      {params.url ? (
        <Text style={[styles.url, { color: colors.muted }]} numberOfLines={3}>
          {params.url}
        </Text>
      ) : null}

      <Text style={styles.label}>Show</Text>
      <TextInput value={show} onChangeText={setShow} placeholder="Show name" style={inputStyle} placeholderTextColor={colors.muted} />

      <Text style={styles.label}>Episode title</Text>
      <TextInput value={title} onChangeText={setTitle} placeholder="Episode 1" style={inputStyle} placeholderTextColor={colors.muted} />

      {!existing ? (
        <View>
          <Text style={styles.label}>Page the video came from (optional)</Text>
          <TextInput
            value={referer}
            onChangeText={setReferer}
            placeholder="https://site.com/episode-page"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={inputStyle}
          />
          <Text style={[styles.hint, { color: colors.muted }]}>
            Some video hosts refuse downloads unless they come “from” the site’s page. If a download fails, try
            again with the episode page’s address here.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  url: { fontSize: 13, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 16 },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
});
