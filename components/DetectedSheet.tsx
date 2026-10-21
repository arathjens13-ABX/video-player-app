import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { formatBytes, formatDuration } from '@/lib/format';
import type { Server } from '@/lib/detector-messages';
import { estimatedSize, groupVideos, sourceLabel, type VideoGroup } from '@/lib/candidates';
import { hostOf } from '@/lib/links';
import type { Candidate, ProbeResult } from '@/lib/probe';
import { probeStatus, subscribeProbes } from '@/lib/probe-store';

import { Text, View } from './Themed';
import { useColors } from './useColors';


function useProbe(c: Candidate): ProbeResult | null {
  const [, rerender] = useState(0);
  useEffect(() => subscribeProbes(() => rerender((n) => n + 1)), []);
  const status = probeStatus(c.url);
  return status === undefined || status === 'pending' ? null : status;
}

export function DetectedSheet({
  visible,
  onClose,
  candidates,
  servers,
  onDownload,
  onSwitchServer,
}: {
  visible: boolean;
  onClose: () => void;
  candidates: Candidate[];
  servers: Server[];
  onDownload: (c: Candidate) => void;
  onSwitchServer: (s: Server) => void;
}) {
  const colors = useColors();
  const [showAll, setShowAll] = useState(false);
  const [, rerender] = useState(0);
  useEffect(() => subscribeProbes(() => rerender((n) => n + 1)), []);
  const groups = groupVideos(candidates, probeStatus);
  const pending = candidates.filter((c) => {
    const status = probeStatus(c.url);
    return status === undefined || status === 'pending';
  }).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>On this page</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.section, { color: colors.muted }]}>Videos</Text>
        {groups.map((g, i) => (
          <VideoCard
            key={g.best.url}
            group={g}
            recommended={i === 0 && groups.length > 1}
            onDownload={() => onDownload(g.best)}
          />
        ))}
        {pending > 0 ? (
          <View style={styles.checking} lightColor="transparent" darkColor="transparent">
            <ActivityIndicator size="small" />
            <Text style={[styles.hint, { color: colors.muted, marginBottom: 0 }]}>
              Checking {pending} link{pending === 1 ? '' : 's'}…
            </Text>
          </View>
        ) : null}
        {candidates.length === 0 || (groups.length === 0 && pending === 0) ? (
          <Text style={[styles.empty, { color: colors.muted }]}>
            {candidates.length === 0 ? 'Nothing yet. ' : 'Nothing that checks out yet. '}
            Press play on the video (ads may play first). If it still doesn’t show up, try another server below.
          </Text>
        ) : null}
        {candidates.length > 0 ? (
          <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={8}>
            <Text style={[styles.toggle, { color: colors.muted }]}>
              {showAll ? 'Hide all links' : `Show all ${candidates.length} links (copies and ones that didn’t check out)`}
            </Text>
          </Pressable>
        ) : null}
        {showAll ? candidates.map((c) => <CandidateRow key={c.url} candidate={c} onDownload={() => onDownload(c)} />) : null}

        {servers.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.muted }]}>Servers ({servers.length})</Text>
            <Text style={[styles.hint, { color: colors.muted }]}>
              Switch the player to another mirror, then press play in it.
            </Text>
            {servers.map((s) => (
              <Pressable
                key={s.url}
                onPress={() => onSwitchServer(s)}
                style={({ pressed }) => [styles.row, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {s.label}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                  {hostOf(s.url)}
                </Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

/** One video found on the page: what it is (length, quality, size) and where it plays from. */
function VideoCard({ group, recommended, onDownload }: { group: VideoGroup; recommended: boolean; onDownload: () => void }) {
  const colors = useColors();
  const r = group.result;
  const quality = r.kind === 'hls' ? r.info.qualities[0]?.label : null;
  const size = estimatedSize(r);
  const title =
    r.kind === 'hls'
      ? [formatDuration(r.info.duration), quality ? `up to ${quality}` : null].filter(Boolean).join(' · ')
      : `Video file${r.size ? ` · ${formatBytes(r.size)}` : ''}`;
  const meta = [
    sourceLabel(group.best),
    r.kind === 'hls' && size ? `about ${formatBytes(size)}` : null,
    r.kind === 'hls' && r.info.qualities.length > 1 ? `${r.info.qualities.length} qualities` : null,
    r.kind === 'hls' && r.info.encrypted ? 'encrypted' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.row, { backgroundColor: colors.card }]}>
      {recommended ? <Text style={[styles.recommended, { color: colors.tint }]}>Best match</Text> : null}
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={2}>
        {meta}
      </Text>
      <Pressable
        onPress={onDownload}
        style={({ pressed }) => [styles.download, { backgroundColor: colors.tint, opacity: pressed ? 0.7 : 1 }]}>
        <Text style={styles.downloadText}>Download</Text>
      </Pressable>
    </View>
  );
}

function CandidateRow({ candidate, onDownload }: { candidate: Candidate; onDownload: () => void }) {
  const colors = useColors();
  const result = useProbe(candidate);
  const invalid = result?.status === 'invalid';

  let detail = 'Checking…';
  if (result?.status === 'invalid') detail = result.reason;
  else if (result?.status === 'ok' && result.kind === 'hls') {
    const q = result.info.qualities[0]?.label;
    detail = [formatDuration(result.info.duration), q, result.info.encrypted ? 'encrypted' : null].filter(Boolean).join(' · ');
  } else if (result?.status === 'ok' && result.kind === 'file') {
    detail = result.size ? formatBytes(result.size) : 'Size unknown';
  }

  const isStream = candidate.kind === 'hls';
  return (
    <View style={[styles.row, { backgroundColor: colors.card, opacity: invalid ? 0.5 : 1 }]}>
      <View style={styles.rowTop} lightColor="transparent" darkColor="transparent">
        <View style={[styles.badge, { backgroundColor: isStream ? '#8a5cf6' : '#2f9e6b' }]}>
          <Text style={styles.badgeText}>{isStream ? 'STREAM' : 'MP4'}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {hostOf(candidate.url)}
        </Text>
        {result === null ? <ActivityIndicator size="small" /> : null}
      </View>
      <Text style={[styles.rowMeta, { color: invalid ? colors.danger : colors.muted }]} numberOfLines={2}>
        {detail}
      </Text>
      {!invalid ? (
        <Pressable
          onPress={onDownload}
          disabled={result === null}
          style={({ pressed }) => [styles.download, { backgroundColor: colors.tint, opacity: result === null ? 0.4 : pressed ? 0.7 : 1 }]}>
          <Text style={styles.downloadText}>Download</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 12, marginBottom: 8 },
  empty: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, marginBottom: 8 },
  toggle: { fontSize: 13, marginTop: 4, marginBottom: 8 },
  row: { borderRadius: 10, padding: 12, marginBottom: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 16, fontWeight: '500', flexShrink: 1 },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  recommended: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rowMeta: { fontSize: 13, marginTop: 4 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  download: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  downloadText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
