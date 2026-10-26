import { Paths } from 'expo-file-system';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { setShowCover } from '@/lib/covers';
import { addBatch, findVideo, listBatch, type Found } from '@/lib/batch';
import { listEpisodes } from '@/lib/db';
import { formatBytes } from '@/lib/format';
import { episodeNumber, showKey } from '@/lib/library';
import { logInfo } from '@/lib/log';
import { howManyFit, inRange, KEEP_FREE_BYTES, presets, seasonEpisodes, sizeAtQuality, type Range } from '@/lib/season';
import { getSeasonDraft } from '@/lib/season-draft';
import { QUALITY_OPTIONS, type StreamQuality } from '@/lib/settings';

const PRESET_COUNT = 10;

function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

/** "Download several": pick a range of a season's episodes, see what it costs, queue it. */
export default function BatchScreen() {
  const colors = useColors();
  const [draft] = useState(getSeasonDraft);
  const episodes = useMemo(() => seasonEpisodes(draft?.episodes ?? []), [draft]);
  const show = episodes[0]?.show ?? 'Unsorted';

  // Episodes already downloaded (or waiting in a season download) are skipped.
  const [have] = useState(() => {
    const key = showKey(show);
    const nums = new Set<number>();
    for (const e of listEpisodes()) {
      const n = episodeNumber(e.title);
      if (showKey(e.show) === key && e.status !== 'error' && n !== null) nums.add(n);
    }
    return nums;
  });
  const [queuedPages] = useState(() => new Set(listBatch().map((i) => i.pageUrl)));
  const quick = useMemo(() => presets(episodes, have, PRESET_COUNT), [episodes, have]);

  const [range, setRange] = useState<Range | null>(() => quick?.next ?? quick?.latest ?? null);
  const [fromText, setFromText] = useState(range ? String(range.from) : '');
  const [toText, setToText] = useState(range ? String(range.to) : '');
  const [quality, setQuality] = useState<StreamQuality>(720);
  const [useServer, setUseServer] = useState(!!draft?.server);
  const server = useServer ? (draft?.server ?? null) : null;
  const added = useRef(false);

  function choose(r: Range) {
    setRange(r);
    setFromText(String(r.from));
    setToText(String(r.to));
  }

  function typed(from: string, to: string) {
    setFromText(from);
    setToText(to);
    const f = Number(from);
    const t = Number(to);
    setRange(from && to && Number.isFinite(f) && Number.isFinite(t) ? { from: f, to: t } : null);
  }

  const selected = range ? inRange(episodes, range) : [];
  const toGet = selected.filter((e) => !(e.number !== null && have.has(e.number)) && !queuedPages.has(e.url));
  const skipped = selected.length - toGet.length;

  // Size check: find the first episode's video once (per server), then work out sizes per quality.
  const [estimate, setEstimate] = useState<{ key: string; found?: Found; error?: string } | null>(null);
  const sample = toGet[0];
  const sampleKey = sample ? `${sample.url}|${server ?? ''}` : '';
  useEffect(() => {
    if (!sample) return;
    const controller = new AbortController();
    findVideo(sample.url, server, controller.signal).then(
      (found) => setEstimate({ key: sampleKey, found }),
      (e: unknown) => {
        if (!controller.signal.aborted) setEstimate({ key: sampleKey, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => controller.abort();
    // sampleKey covers the sample episode and server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleKey]);

  const current = estimate?.key === sampleKey ? estimate : null;
  const r = current?.found?.result;
  const each = r ? (r.kind === 'hls' ? sizeAtQuality(r.info, quality) : r.size) : null;
  const free = freeSpace();
  const total = each ? each * toGet.length : null;
  const fit = each && free !== null ? howManyFit(free, each) : null;

  function start() {
    if (added.current || toGet.length === 0) return;
    added.current = true;
    logInfo('batch', `season ${show}: ${toGet.length} episodes ${range?.from}–${range?.to} at ≤${quality}p, about ${each ? formatBytes(each) : '?'} each`);
    addBatch(toGet.map((e) => ({ show: e.show, title: e.name, pageUrl: e.url, server, maxHeight: quality })));
    setShowCover(show, draft?.cover, draft?.listUrl);
    router.back();
    router.navigate('/downloads');
  }

  if (!draft || episodes.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Download several' }} />
        <Text style={{ color: colors.muted }}>Open a season’s episode list in the Browser first.</Text>
      </View>
    );
  }

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }];
  const chip = (label: string, r: Range | null) =>
    r ? (
      <Pressable
        key={label}
        onPress={() => choose(r)}
        style={[styles.chip, { borderColor: colors.border, backgroundColor: range && range.from === r.from && range.to === r.to ? colors.tint : colors.card }]}>
        <Text style={{ color: range && range.from === r.from && range.to === r.to ? '#fff' : colors.text, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    ) : null;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: 'Download several',
          headerRight: () => (
            <Pressable onPress={start} hitSlop={10} disabled={toGet.length === 0}>
              <Text style={{ color: toGet.length ? colors.tint : colors.muted, fontSize: 17, fontWeight: '600' }}>Start</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={styles.show}>{show}</Text>
      <Text style={[styles.hint, { color: colors.muted }]}>
        {episodes.length} episodes listed
        {quick?.highestHave != null ? ` · you have up to episode ${quick.highestHave}` : ''}
      </Text>

      <Text style={styles.label}>Episodes</Text>
      <View style={styles.chips}>
        {chip(`Next ${PRESET_COUNT}`, quick?.next ?? null)}
        {chip(`Latest ${PRESET_COUNT}`, quick?.latest ?? null)}
        {chip(`All ${episodes.length}`, quick?.all ?? null)}
      </View>
      <View style={styles.rangeRow}>
        <Text>From</Text>
        <TextInput value={fromText} onChangeText={(v) => typed(v, toText)} keyboardType="number-pad" style={[inputStyle, styles.num]} />
        <Text>to</Text>
        <TextInput value={toText} onChangeText={(v) => typed(fromText, v)} keyboardType="number-pad" style={[inputStyle, styles.num]} />
      </View>
      <Text style={[styles.hint, { color: colors.muted }]}>
        {toGet.length} to download
        {skipped ? ` · ${skipped} skipped (already have or already queued)` : ''}
      </Text>

      <Text style={styles.label}>Quality</Text>
      <View style={styles.chips}>
        {QUALITY_OPTIONS.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => setQuality(o.value)}
            style={[styles.segment, { borderColor: colors.border, backgroundColor: quality === o.value ? colors.tint : colors.card }]}>
            <Text style={{ color: quality === o.value ? '#fff' : colors.text, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Server</Text>
      <Text>{server ?? 'Whatever the episode page plays first'}</Text>
      {draft.server ? (
        <Pressable onPress={() => setUseServer((v) => !v)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.tint }]}>
            {useServer ? 'Use the page’s default player instead' : `Use ${draft.server}`}
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.hint, { color: colors.muted }]}>
          To pick a server, switch to it on an episode page first, then come back to the episode list.
        </Text>
      )}

      <Text style={styles.label}>Space</Text>
      <View style={[styles.box, { backgroundColor: colors.card }]}>
        {!sample ? (
          <Text style={{ color: colors.muted }}>Pick some episodes to see their size.</Text>
        ) : current?.error ? (
          <Text style={{ color: colors.danger }}>
            Couldn’t check episode {sample.number ?? ''}: {current.error}. You can still start; episodes whose video isn’t found are
            marked so you can do them by hand.
          </Text>
        ) : !r ? (
          <View style={styles.checking} lightColor="transparent" darkColor="transparent">
            <ActivityIndicator size="small" />
            <Text style={{ color: colors.muted }}>Checking the size of episode {sample.number ?? ''}…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.big}>
              {total ? `About ${formatBytes(total)}` : 'Size unknown'}
              {each ? ` · ${formatBytes(each)} each` : ''}
            </Text>
            {free !== null ? (
              <Text style={{ color: colors.muted, marginTop: 4 }}>
                Free now {formatBytes(free)}
                {total ? ` → about ${formatBytes(Math.max(0, free - total))} after` : ''}
              </Text>
            ) : null}
            {fit !== null && fit < toGet.length ? (
              <Text style={{ color: colors.danger, marginTop: 6 }}>
                Only about {fit} fit while keeping {formatBytes(KEEP_FREE_BYTES)} free. The rest wait until you delete
                something.
              </Text>
            ) : null}
          </>
        )}
        <Text style={[styles.hint, { color: colors.muted }]}>
          Season downloads never take your phone below {formatBytes(KEEP_FREE_BYTES)} free. Keep VidStash open while they
          run; each episode’s video is found just before it downloads.
        </Text>
      </View>

      <Pressable
        onPress={start}
        disabled={toGet.length === 0}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.tint, opacity: toGet.length === 0 ? 0.4 : pressed ? 0.7 : 1 }]}>
        <Text style={styles.buttonText}>
          {toGet.length === 0 ? 'Nothing to download' : `Download ${toGet.length} episode${toGet.length === 1 ? '' : 's'}`}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  show: { fontSize: 20, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  link: { fontSize: 14, marginTop: 6 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, fontSize: 16 },
  num: { width: 80, textAlign: 'center' },
  box: { borderRadius: 10, padding: 12 },
  big: { fontSize: 18, fontWeight: '600' },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { marginTop: 24, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
