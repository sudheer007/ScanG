import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { api, Market, Stock } from '@/src/api';
import { theme } from '@/src/theme';
import { marketPref, screenerSectorPref } from '@/src/storage-keys';
import { useFocusInterval } from '@/src/hooks/useFocusInterval';
import { mergeLiveQuotes } from '@/src/utils/mergeLiveQuotes';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';
import ChipRow from '@/src/components/ChipRow';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';
import FilterSheet from '@/src/components/FilterSheet';
import SortableDataTable, { SortableColumn } from '@/src/components/widgets/SortableDataTable';
import { ActiveFilters, Range } from '@/src/screener/types';
import { applyFilters, sortStocks, activeMetricKeys, fmtMetric, chipLabel } from '@/src/screener/engine';
import { METRIC_BY_KEY, AVAILABLE_COUNT } from '@/src/screener/catalog';
import { PRESETS, Preset } from '@/src/screener/presets';

type Mode = 'quick' | 'custom';
const BASE_COLS = ['price', 'change_pct', 'market_cap', 'pe', 'roe'];
/** Live price patch for visible screener rows (same as stock detail). */
const LIVE_QUOTE_MS = 15_000;
/** Soft-reload universe for RSI / ROE / filters without pull-to-refresh. */
const FUNDAMENTALS_REFRESH_MS = 5 * 60_000;

export default function ScreenerScreen() {
  const [market, setMarket] = useState<Market | null>(() => marketPref.peek());
  const [mode, setMode] = useState<Mode>('quick');
  const [filters, setFilters] = useState<ActiveFilters>({});
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [universe, setUniverse] = useState<Stock[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const resultsRef = useRef<Stock[]>([]);

  useEffect(() => {
    let cancelled = false;
    marketPref.get().then((m) => {
      if (!cancelled) setMarket(m);
    });
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      screenerSectorPref.get().then((nav) => {
        if (cancelled || !nav?.sector) return;
        setMarket(nav.market);
        void marketPref.set(nav.market);
        setFilters({ sector: nav.sector });
        setMode('custom');
        setActivePreset(null);
        screenerSectorPref.clear();
      });
      return () => { cancelled = true; };
    }, []),
  );

  const load = useCallback(async (force = false) => {
    if (!market) return;
    setError(null);
    try {
      const r = await api.screenerUniverse(market, force);
      setUniverse(r.stocks);
      setCurrency(r.currency);
    } catch (e: any) {
      setError(e?.message || 'Failed to load universe');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    if (!market) return;
    setUniverse([]);
    setLoading(true);
    load();
  }, [market, load]);

  const results = useMemo(() => {
    const filtered = applyFilters(universe, filters);
    const keys = activeMetricKeys(filters);
    const sortKey = keys[0] || 'market_cap';
    return sortStocks(filtered, sortKey, true);
  }, [universe, filters]);
  resultsRef.current = results;

  const refreshVisibleQuotes = useCallback(async () => {
    const visible = resultsRef.current.slice(0, 49);
    if (!visible.length) return;
    try {
      const r = await api.batchLiveQuotes(visible.map((s) => s.symbol));
      const quotes = r.quotes || [];
      if (!quotes.length) return;
      setUniverse((prev) => mergeLiveQuotes(prev, quotes));
    } catch {
      /* keep last prices */
    }
  }, []);

  const refreshFundamentals = useCallback(async () => {
    if (!market) return;
    try {
      const r = await api.screenerUniverse(market, true);
      setUniverse((prev) => {
        // Re-apply live prices onto the fresh fundamentals snapshot.
        const bySym = new Map(prev.map((s) => [s.symbol, s]));
        return r.stocks.map((s) => {
          const live = bySym.get(s.symbol);
          if (!live) return s;
          return {
            ...s,
            price: live.price ?? s.price,
            change: live.change ?? s.change,
            change_pct: live.change_pct ?? s.change_pct,
            volume: live.volume ?? s.volume,
          };
        });
      });
      setCurrency(r.currency);
    } catch {
      /* keep last fundamentals */
    }
  }, [market]);

  useFocusInterval(refreshVisibleQuotes, LIVE_QUOTE_MS, { immediate: true });
  useFocusInterval(refreshFundamentals, FUNDAMENTALS_REFRESH_MS, { immediate: false });

  const columns = useMemo<SortableColumn[]>(() => {
    const keys = [...BASE_COLS, ...activeMetricKeys(filters).filter((k) => !BASE_COLS.includes(k) && METRIC_BY_KEY[k]?.available)];
    return keys.map((key) => {
      const m = METRIC_BY_KEY[key];
      const label = (m?.label || key).replace(' (TTM)', '').replace(' Ratio', '').replace(' Capitalization', ' Cap');
      const fmt = m?.fmt || 'num';
      const width = fmt === 'big' ? 88 : fmt === 'pct' ? 78 : fmt === 'money' ? 76 : 66;
      const isPct = fmt === 'pct';
      return {
        key,
        label,
        width,
        align: 'right',
        mono: true,
        sortValue: (r: any) => (r[key] ?? null),
        tone: isPct ? (r: any) => { const v = r[key]; return v == null ? undefined : v >= 0 ? 'pos' : 'neg'; } : undefined,
        render: (r: any) => fmtMetric(key, r[key], currency),
      } as SortableColumn;
    });
  }, [filters, currency]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const hasFilters = Object.keys(filters).length > 0;

  const applyPreset = (p: Preset) => {
    setFilters(p.filters);
    setActivePreset(p.id);
    setMode('custom');
  };

  const clearAll = () => { setFilters({}); setActivePreset(null); };

  const goBack = () => {
    setMode('quick');
    setFilters({});
    setActivePreset(null);
    setSheetOpen(false);
  };

  const removeFilter = (key: string) => {
    const next = { ...filters }; delete (next as any)[key];
    setFilters(next); setActivePreset(null);
  };

  const onModeChange = (m: Mode) => {
    setMode(m);
    if (m === 'custom' && !hasFilters) setTimeout(() => setSheetOpen(true), 150);
  };

  if (!market) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="screener-screen">
        <LoadingState label="Loading market…" />
      </SafeAreaView>
    );
  }

  const customTitle = activePreset
    ? PRESETS.find((p) => p.id === activePreset)?.name
    : filters.sector
      ? String(filters.sector)
      : hasFilters
        ? 'Custom screen'
        : 'Custom';

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="screener-screen">
      <View style={styles.header}>
        {mode === 'custom' && (
          <TouchableOpacity onPress={goBack} style={styles.iconBtn} testID="screener-back">
            <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{mode === 'custom' ? customTitle : 'Screener'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'custom'
              ? `${results.length} of ${universe.length} stocks • ${market}`
              : `${hasFilters ? `${results.length} matches` : `${universe.length} stocks`} • ${market} • ${AVAILABLE_COUNT}+ metrics`}
          </Text>
        </View>
        <TouchableOpacity testID="open-filters" onPress={() => setSheetOpen(true)} style={styles.iconBtn}>
          <Ionicons name="options" size={20} color={theme.colors.text} />
          {hasFilters && <View style={styles.dot} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <LoadingState label="Loading universe…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : mode === 'quick' ? (
        <AppScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ChipRow
            testID="market-toggle"
            options={[
              { value: 'US', label: '🇺🇸 US', testID: 'market-US' },
              { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
            ]}
            value={market}
            onChange={(v) => { setMarket(v as Market); marketPref.set(v as Market); }}
          />

          <View style={styles.segment}>
            <SegBtn icon="flash" label="Quick Screens" active={mode === 'quick'} onPress={() => onModeChange('quick')} testID="mode-quick" />
            <SegBtn icon="construct" label="Custom" active={mode === 'custom'} onPress={() => onModeChange('custom')} testID="mode-custom" />
          </View>

          <View style={styles.grid}>
            <Text style={styles.gridHint}>Tap a screen to instantly load expert filters — then tweak any value.</Text>
            {PRESETS.map((p) => (
              <TouchableOpacity key={p.id} testID={`preset-${p.id}`} style={[styles.card, activePreset === p.id && styles.cardActive]} activeOpacity={0.85} onPress={() => applyPreset(p)}>
                <View style={[styles.cardIcon, { backgroundColor: p.color + '22' }]}>
                  <Ionicons name={p.icon as any} size={20} color={p.color} />
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{p.name}</Text>
                <Text style={styles.cardBlurb} numberOfLines={2}>{p.blurb}</Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.cardCount, { color: p.color }]}>{applyFilters(universe, p.filters).length} matches</Text>
                  <Ionicons name="arrow-forward" size={13} color={theme.colors.textMuted} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </AppScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ChipRow
            testID="market-toggle"
            options={[
              { value: 'US', label: '🇺🇸 US', testID: 'market-US' },
              { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
            ]}
            value={market}
            onChange={(v) => { setMarket(v as Market); marketPref.set(v as Market); }}
          />
          {/* Active summary bar */}
          <View style={styles.summaryBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summarySub}>{hasFilters ? 'Active filters' : 'No filters yet'}</Text>
              <Text style={styles.summaryTitle} numberOfLines={1}>
                {hasFilters ? `${Object.keys(filters).length} filter${Object.keys(filters).length === 1 ? '' : 's'} applied` : 'Tap Edit to add filters'}
              </Text>
            </View>
            <TouchableOpacity testID="edit-filters" onPress={() => setSheetOpen(true)} style={styles.editBtn}>
              <Ionicons name="options-outline" size={15} color={theme.colors.text} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            {hasFilters && (
              <TouchableOpacity testID="clear-filters" onPress={clearAll} style={styles.clearBtn}>
                <Ionicons name="close" size={16} color={theme.colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Active chips */}
          {hasFilters && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ maxHeight: 42 }}>
              {Object.entries(filters).map(([k, v]) => (
                <TouchableOpacity key={k} testID={`active-filter-${k}`} onPress={() => removeFilter(k)} style={styles.chip}>
                  <Text style={styles.chipText}>{chipLabel(k, v as Range | string)}</Text>
                  <Ionicons name="close" size={11} color={theme.colors.text} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Results */}
          {!hasFilters ? (
            <EmptyState title="Build your screen" subtitle="Tap Edit to add filters, or go back to Quick Screens." />
          ) : results.length === 0 ? (
            <EmptyState title="No matches" subtitle="Try loosening your filters." />
          ) : (
            <AppScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: theme.spacing.sm, paddingBottom: 120 }}
              showsVerticalScrollIndicator
            >
              <SortableDataTable
                testID="screener-table"
                columns={columns}
                rows={results}
                linkToStockField="symbol"
                stickyField="symbol"
                stickyWidth={90}
              />
            </AppScrollView>
          )}
        </View>
      )}

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        universe={universe}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => { setFilters(f); setActivePreset(null); setSheetOpen(false); if (mode === 'quick') setMode('custom'); }}
      />
    </SafeAreaView>
  );
}

function SegBtn({ icon, label, active, onPress, testID }: { icon: string; label: string; active: boolean; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity testID={testID} style={[styles.segBtn, active && styles.segBtnActive]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon as any} size={15} color={active ? theme.colors.bg : theme.colors.textMuted} />
      <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm, gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, position: 'relative' },
  dot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },

  segment: { flexDirection: 'row', gap: 8, paddingHorizontal: theme.spacing.lg, marginTop: 6, marginBottom: 8 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 12, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  segBtnActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  segBtnText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  segBtnTextActive: { color: theme.colors.bg },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingBottom: 120, gap: 0 },
  gridHint: { width: '100%', color: theme.colors.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  card: { width: '48.5%', backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardActive: { borderColor: theme.colors.success, backgroundColor: 'rgba(16,185,129,0.08)' },
  cardIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  cardBlurb: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4, lineHeight: 15, minHeight: 30 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  cardCount: { fontSize: 12, fontWeight: '700' },

  summaryBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: theme.spacing.lg, paddingVertical: 8 },
  summaryTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  summarySub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  editBtnText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  clearBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },

  chips: { paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: 'center', height: 42 },
  chip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.bg3, borderWidth: 1, borderColor: theme.colors.borderStrong },
  chipText: { color: theme.colors.text, fontSize: 11, fontWeight: '600' },
});
