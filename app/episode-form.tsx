import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { getEpisode, updateEpisode, type DownloadKind } from '@/lib/db';
import { enqueue } from '@/lib/downloads';
import { guessNames } from '@/lib/links';
import { getStreamQuality, QUALITY_OPTIONS, type StreamQuality } from '@/lib/settings';

/**
 * Two modes: with `url` + `kind` it confirms a new download; with `id` it edits
 * an existing episode's show name and title.
 */
export default function EpisodeForm() {
  const params = useLocalSearchParams<{
    id?: string;
    url?: string;
    kind?: DownloadKind;
    referer?: string;
    pageTitle?: string;
    pageUrl?: string;
  }>();
  const colors = useColors();
  const existing = params.id ? getEpisode(Number(params.id)) : null;
  const guessed = params.url ? bestGuess([params.pageTitle, params.pageUrl, params.url]) : null;
  const isStream = !existing && params.kind === 'hls';

  const [show, setShow] = useState(existing?.show ?? guessed?.show ?? '');
  const [title, setTitle] = useState(existing?.title ?? guessed?.title ?? '');
  const [referer, setReferer] = useState(params.referer ?? '');
  const [quality, setQuality] = useState<StreamQuality>(getStreamQuality);

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
        pageUrl: params.pageUrl ?? null,
        maxHeight: quality,
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
      {isStream ? (
        <Text style={[styles.notice, { backgroundColor: colors.card }]}>
          This video is a stream, so it downloads in many small pieces and is then put together into one file. Keep
          VidStash open until it finishes (the screen stays on). If you leave, it picks up where it stopped.
        </Text>
      ) : null}

      {isStream ? (
        <View>
          <Text style={styles.label}>Quality</Text>
          <View style={styles.segments}>
            {QUALITY_OPTIONS.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => setQuality(o.value)}
                style={[
                  styles.segment,
                  { borderColor: colors.border, backgroundColor: quality === o.value ? colors.tint : colors.card },
                ]}>
                <Text style={{ color: quality === o.value ? '#fff' : colors.text, fontWeight: '600' }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {QUALITY_OPTIONS.find((o) => o.value === quality)?.hint}. If the stream doesn’t offer it, the closest lower
            quality is used.
          </Text>
        </View>
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

/** Uses the first source that yields a real show name (page title, then page URL, then the video URL). */
function bestGuess(sources: (string | undefined)[]) {
  let fallback: ReturnType<typeof guessNames> | null = null;
  for (const source of sources) {
    if (!source) continue;
    const guess = guessNames(source);
    if (guess.show !== 'Unsorted') return guess;
    fallback ??= guess;
  }
  return fallback ?? { show: 'Unsorted', title: 'Untitled' };
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  url: { fontSize: 13, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 16 },
  notice: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 10, overflow: 'hidden', marginTop: 8 },
  segments: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
});
