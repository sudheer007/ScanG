import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api, Market, Stock } from '@/src/api';
import { theme } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import StockRow from '@/src/components/StockRow';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';
import FilterSheet, { ActiveFilters } from '@/src/components/FilterSheet';

const SORTS: { value: string; label: string; desc: boolean }[] = [
  { value: 'market_cap', label: 'Mkt Cap', desc: true },
  { value: 'change_pct', label: '% Change', desc: true },
  { value: 'pe', label: 'P/E ↑', desc: false },
  { value: 'roe', label: 'ROE', desc: true },
  { value: 'dividend_yield', label: 'Div Yield', desc: true },
  { value: 'rsi', label: 'RSI ↑', desc: false },
];

export default function ScreenerScreen() {
  const [market, setMarket] = useState<Market>('US');
  const [sortBy, setSortBy] = useState<string>('market_cap');
  const [sortDesc, setSortDesc] = useState(true);
  const [filters, setFilters] = useState<ActiveFilters>({});
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  const run = useCallback(async () => {
    setError(null);
    try {
      const body = {
        market,
        filters: toApiFilters(filters),
        sort_by: sortBy,
        sort_desc: sortDesc,
        limit: 100,
      };
      const r = await api.customScreen(body);
      setStocks(r.stocks);
      setCount(r.count);
    } catch (e: any) {
      setError(e?.message || 'Screen failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market, filters, sortBy, sortDesc]);

  useEffect(() => {
    setLoading(true);
    run();
  }, [market, filters, sortBy, sortDesc, run]);

  const onRefresh = () => { setRefreshing(true); run(); };

  const activeFilterChips = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    Object.entries(filters).forEach(([k, v]) => {
      if (k === 'sector' && typeof v === 'string') {
        out.push({ key: k, label: `Sector: ${v}` });
      } else if (typeof v === 'object' && v) {
        const lo = (v as any).min;
        const hi = (v as any).max;
        const label = LABELS[k] || k;
        if (lo !== undefined && hi !== undefined) out.push({ key: k, label: `${lo} ≤ ${label} ≤ ${hi}` });
        else if (lo !== undefined) out.push({ key: k, label: `${label} ≥ ${lo}` });
        else if (hi !== undefined) out.push({ key: k, label: `${label} ≤ ${hi}` });
      }
    });
    return out;
  }, [filters]);

  const removeFilter = (key: string) => {
    const next = { ...filters }; delete (next as any)[key]; setFilters(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="screener-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Screener</Text>
          <Text style={styles.subtitle}>{count} of universe • {market}</Text>
        </View>
        <TouchableOpacity
          testID="open-filters"
          onPress={() => setSheetOpen(true)}
          style={styles.iconBtn}
        >
          <Ionicons name="options" size={20} color={theme.colors.text} />
          {Object.keys(filters).length > 0 && <View style={styles.dot} />}
        </TouchableOpacity>
      </View>

      <ChipRow
        testID="market-toggle"
        options={[
          { value: 'US', label: '🇺🇸 US', testID: 'market-US' },
          { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
        ]}
        value={market}
        onChange={(v) => { setMarket(v as Market); marketPref.set(v as Market); }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow} style={styles.sortWrap}>
        {SORTS.map((s) => (
          <TouchableOpacity
            key={s.value}
            testID={`sort-${s.value}`}
            style={[styles.sortChip, sortBy === s.value && styles.sortChipSelected]}
            onPress={() => { setSortBy(s.value); setSortDesc(s.desc); }}
          >
            <Text style={[styles.sortChipText, sortBy === s.value && styles.sortChipTextSelected]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeFilterChips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFilters} style={{ maxHeight: 44 }}>
          {activeFilterChips.map((c) => (
            <TouchableOpacity key={c.key} onPress={() => removeFilter(c.key)} testID={`active-filter-${c.key}`} style={styles.activeChip}>
              <Text style={styles.activeChipText}>{c.label}</Text>
              <Ionicons name="close" size={12} color={theme.colors.text} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      >
        {loading ? (
          <LoadingState label="Screening universe…" />
        ) : error ? (
          <ErrorState message={error} onRetry={run} />
        ) : stocks.length === 0 ? (
          <EmptyState title="No matches" subtitle="Try loosening your filters." />
        ) : (
          stocks.map((s) => (
            <StockRow
              key={s.symbol}
              stock={s}
              testIDPrefix="screener-result"
              rightBadges={inferBadges(sortBy, s)}
            />
          ))
        )}
      </ScrollView>

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => { setFilters(f); setSheetOpen(false); }}
      />
    </SafeAreaView>
  );
}

function toApiFilters(f: ActiveFilters) {
  const out: Record<string, any> = {};
  Object.entries(f).forEach(([k, v]) => {
    if (k === 'sector' && typeof v === 'string') out[k] = v;
    else if (typeof v === 'object' && v) {
      const o: any = {};
      if ((v as any).min !== undefined) o.min = (v as any).min;
      if ((v as any).max !== undefined) o.max = (v as any).max;
      if (Object.keys(o).length) out[k] = o;
    }
  });
  return out;
}

function inferBadges(sortBy: string, s: any) {
  const map: Record<string, [string, string]> = {
    market_cap: ['MCap', shortNum(s.market_cap)],
    change_pct: ['% Δ', (s.change_pct?.toFixed(2) ?? '—') + '%'],
    pe: ['P/E', s.pe?.toFixed(1) ?? '—'],
    roe: ['ROE', (s.roe?.toFixed(0) ?? '—') + '%'],
    dividend_yield: ['Yield', (s.dividend_yield?.toFixed(2) ?? '—') + '%'],
    rsi: ['RSI', s.rsi?.toFixed(0) ?? '—'],
  };
  const m = map[sortBy];
  return m ? [{ label: m[0], value: m[1] }] : undefined;
}

function shortNum(n: number | null | undefined) {
  if (!n) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return String(n);
}

const LABELS: Record<string, string> = {
  market_cap: 'Mkt Cap', pe: 'P/E', pb: 'P/B', roe: 'ROE', debt_to_equity: 'D/E',
  dividend_yield: 'Div Yield', eps_growth: 'EPS Δ', revenue_growth: 'Rev Δ',
  profit_margin: 'Margin', rsi: 'RSI', change_pct: '% Change', from_52w_high_pct: 'From 52w high',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm, gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, position: 'relative' },
  dot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  scroll: { flex: 1 },
  sortWrap: { maxHeight: 44, marginTop: 4 },
  sortRow: { gap: 8, paddingHorizontal: theme.spacing.lg, alignItems: 'center', height: 44 },
  sortChip: { flexShrink: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.sm, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  sortChipSelected: { borderColor: theme.colors.success, backgroundColor: 'rgba(16,185,129,0.1)' },
  sortChipText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  sortChipTextSelected: { color: theme.colors.text },
  activeFilters: { paddingHorizontal: theme.spacing.lg, gap: 8, height: 44, alignItems: 'center' },
  activeChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.bg3, borderWidth: 1, borderColor: theme.colors.borderStrong },
  activeChipText: { color: theme.colors.text, fontSize: 11, fontWeight: '600' },
});
