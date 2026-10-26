import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions } from 'react-native';

import { openOnline } from '@/components/openOnline';
import { ShowCard } from '@/components/ShowCard';
import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';
import { loadHome, loadOngoing, loadSchedule, search } from '@/lib/catalog/client';
import type { Card, ScheduleDay, Section } from '@/lib/catalog/parse';
import { SITES, siteById, type Site } from '@/lib/catalog/sites';
import { checkFollowsNow } from '@/lib/follow-runner';
import { useFollows } from '@/lib/hooks';
import { getDiscoverSite, setDiscoverSite } from '@/lib/settings';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Load<T> = { data: T | null; error: string | null; loading: boolean };
const idle = <T,>(): Load<T> => ({ data: null, error: null, loading: true });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Discover: browse a site like a streaming catalog — search, followed shows,
 * newest episodes, today's schedule and ongoing shows — without hunting
 * through web pages.
 */
export default function DiscoverScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [site, setSite] = useState<Site>(() => siteById(getDiscoverSite()));
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const homeKey = `${site.id}:${refreshKey}`;
  const [home, setHome] = useState<Load<Section[]> & { key: string }>({ ...idle<Section[]>(), key: '' });
  const [now] = useState(() => Date.now());
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [ongoing, setOngoing] = useState<{ cards: Card[]; page: number; hasMore: boolean; loading: boolean; error: string | null }>({
    cards: [],
    page: 0,
    hasMore: true,
    loading: false,
    error: null,
  });
  const [results, setResults] = useState<{ cards: Card[]; page: number; hasMore: boolean; loading: boolean; error: string | null } | null>(null);
  const follows = useFollows();

  const columns = width >= 700 ? 5 : 3;
  const cardWidth = Math.floor((width - 32 - (columns - 1) * 12) / columns);

  // Paging state lives in a ref so a request starts once per page, outside React's state updates.
  const paging = useRef({ site: site.id, page: 0, loading: false, hasMore: true });
  const loadMoreOngoing = useCallback(
    (reset = false) => {
      const p = paging.current;
      if (reset) Object.assign(p, { site: site.id, page: 0, loading: false, hasMore: true });
      if (p.loading || !p.hasMore) return;
      const page = p.page + 1;
      const forSite = site.id;
      p.loading = true;
      setOngoing((cur) => ({ ...(reset ? { cards: [], page: 0, hasMore: true } : cur), loading: true, error: null }));
      loadOngoing(site, page, reset).then(
        (r) => {
          if (paging.current.site !== forSite) return;
          Object.assign(paging.current, { page, loading: false, hasMore: r.hasMore && r.cards.length > 0 });
          setOngoing((cur) => ({
            cards: page === 1 ? r.cards : [...cur.cards, ...r.cards.filter((c) => !cur.cards.some((x) => x.url === c.url))],
            page,
            hasMore: paging.current.hasMore,
            loading: false,
            error: null,
          }));
        },
        (e: unknown) => {
          if (paging.current.site !== forSite) return;
          paging.current.loading = false;
          setOngoing((cur) => ({ ...cur, loading: false, error: message(e) }));
        }
      );
    },
    [site]
  );

  // The site's home page (newest episodes), schedule and the first page of ongoing shows.
  useEffect(() => {
    let alive = true;
    const key = `${site.id}:${refreshKey}`;
    loadHome(site, refreshKey > 0).then(
      (data) => alive && setHome({ key, data, error: null, loading: false }),
      (e: unknown) => alive && setHome({ key, data: null, error: message(e), loading: false })
    );
    loadSchedule(site).then(
      (d) => alive && setSchedule(d),
      () => alive && setSchedule([])
    );
    loadMoreOngoing(true);
    return () => {
      alive = false;
    };
  }, [site, refreshKey, loadMoreOngoing]);

  function runSearch(page = 1) {
    const q = submitted && page > 1 ? submitted : query.trim();
    if (!q) {
      setResults(null);
      setSubmitted('');
      return;
    }
    setSubmitted(q);
    setResults((r) => ({ cards: page === 1 ? [] : (r?.cards ?? []), page, hasMore: true, loading: true, error: null }));
    search(site, q, page).then(
      (r) =>
        setResults((cur) => ({
          cards: page === 1 ? r.cards : [...(cur?.cards ?? []), ...r.cards],
          page,
          hasMore: r.hasMore && r.cards.length > 0,
          loading: false,
          error: null,
        })),
      (e: unknown) => setResults((cur) => ({ cards: cur?.cards ?? [], page, hasMore: false, loading: false, error: message(e) }))
    );
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    await checkFollowsNow(true).catch(() => {});
    setRefreshing(false);
  }

  const homeLoading = home.key !== homeKey;
  const latest = home.data?.find((s) => /latest/i.test(s.title)) ?? home.data?.[0];
  const today = schedule.find((d) => d.day.toLowerCase() === DAYS[new Date().getDay()].toLowerCase());
  const siteFollows = follows.filter((f) => f.site === site.id);
  const grid = results ? results.cards : ongoing.cards;
  const rows = useMemo(() => {
    const out: Card[][] = [];
    for (let i = 0; i < grid.length; i += columns) out.push(grid.slice(i, i + columns));
    return out;
  }, [grid, columns]);

  const header = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SITES.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              setSite(s);
              setDiscoverSite(s.id);
              setResults(null);
              setSubmitted('');
            }}
            style={[styles.chip, { borderColor: colors.border, backgroundColor: s.id === site.id ? colors.tint : colors.card }]}>
            <Text style={{ color: s.id === site.id ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{s.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          if (!t.trim()) {
            setResults(null);
            setSubmitted('');
          }
        }}
        onSubmitEditing={() => runSearch(1)}
        placeholder={`Search ${site.name}`}
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[styles.search, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
      />

      {results ? (
        <Text style={[styles.heading, styles.padded]}>
          {results.loading && results.cards.length === 0 ? 'Searching…' : `Results for “${submitted}”`}
        </Text>
      ) : (
        <>
          {siteFollows.length ? (
            <>
              <View style={styles.headingRow}>
                <Text style={styles.heading}>Following</Text>
                <Pressable onPress={refresh} hitSlop={8}>
                  <Text style={{ color: colors.tint, fontWeight: '600' }}>Check now</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {siteFollows.map((f) => (
                  <ShowCard
                    key={f.url}
                    card={{ url: f.url, title: f.title, poster: f.cover, badge: '', type: '' }}
                    referer={site.base}
                    width={110}
                    note={f.lastError ? 'Check failed' : f.lastNewAt && now - f.lastNewAt < 3 * 86_400_000 ? 'New' : undefined}
                    onPress={() => openOnline(f.url, f.title)}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}

          <Text style={[styles.heading, styles.padded]}>New episodes</Text>
          {homeLoading ? (
            <ActivityIndicator style={styles.spinner} />
          ) : home.error ? (
            <ErrorLine text={home.error} onRetry={() => setRefreshKey((k) => k + 1)} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {(latest?.cards ?? []).map((c) => (
                <ShowCard key={c.url} card={c} referer={site.base} width={110} onPress={() => openOnline(c.url)} />
              ))}
            </ScrollView>
          )}

          {today ? (
            <>
              <Text style={[styles.heading, styles.padded]}>Today · {today.day}</Text>
              <View style={styles.todayList}>
                {today.shows.map((s) => (
                  <Pressable
                    key={s.url}
                    onPress={() => openOnline(s.url, s.title)}
                    style={({ pressed }) => [styles.todayItem, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
                    <Text numberOfLines={1} style={{ fontSize: 14 }}>
                      {s.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Text style={[styles.heading, styles.padded]}>Ongoing</Text>
          {ongoing.error && ongoing.cards.length === 0 ? <ErrorLine text={ongoing.error} onRetry={() => loadMoreOngoing(true)} /> : null}
        </>
      )}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r[0].url}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={header}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (results) {
          if (results.hasMore && !results.loading) runSearch(results.page + 1);
        } else loadMoreOngoing();
      }}
      ListEmptyComponent={
        (results ? results.loading : ongoing.loading) ? null : (
          <Text style={[styles.empty, { color: colors.muted }]}>{results ? (results.error ?? 'Nothing found.') : 'Nothing listed.'}</Text>
        )
      }
      ListFooterComponent={(results ? results.loading : ongoing.loading) ? <ActivityIndicator style={styles.spinner} /> : <View style={{ height: 24 }} />}
      renderItem={({ item }) => (
        <View style={styles.gridRow}>
          {item.map((c) => (
            <ShowCard key={c.url} card={c} referer={site.base} width={cardWidth} onPress={() => openOnline(c.url, c.title)} />
          ))}
        </View>
      )}
    />
  );
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.errorRow}>
      <Text style={{ color: colors.danger, flex: 1 }}>{text}</Text>
      <Pressable onPress={onRetry} hitSlop={8}>
        <Text style={{ color: colors.tint, fontWeight: '600' }}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  search: { marginHorizontal: 16, marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16 },
  heading: { fontSize: 18, fontWeight: '700' },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  padded: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  row: { paddingHorizontal: 16, gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 14 },
  todayList: { paddingHorizontal: 16, gap: 6 },
  todayItem: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  spinner: { marginVertical: 16 },
  empty: { textAlign: 'center', padding: 24 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
});
