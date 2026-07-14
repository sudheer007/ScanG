import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { api, Market, RadarResult, Stock, Strategy } from '@/src/api';
import { theme } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import Sparkline from '@/src/components/Sparkline';
import AnalystGauge from '@/src/components/AnalystGauge';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';
import SortableDataTable, { SortableColumn } from '@/src/components/widgets/SortableDataTable';
import { fmtMetric } from '@/src/screener/engine';
import { METRIC_BY_KEY } from '@/src/screener/catalog';

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  'trending-up': 'trending-up',
  trophy: 'trophy',
  'shield-checkmark': 'shield-checkmark',
  pulse: 'pulse',
  rocket: 'rocket',
  ribbon: 'ribbon',
  cash: 'cash',
  'git-merge': 'git-merge',
};

const ACCENT: Record<string, string> = {
  momentum_breakouts: '#10B981',
  value_picks: '#F59E0B',
  high_roce_low_debt: '#34D399',
  oversold_quality: '#EF4444',
  multibaggers: '#A78BFA',
  fifty_two_week_high: '#10B981',
  dividend_aristocrats: '#F59E0B',
  golden_cross: '#34D399',
};

// strategy -> extra metric column keys (from the screener catalog)
const STRATEGY_METRICS: Record<string, string[]> = {
  value_picks: ['pe', 'roe'],
  momentum_breakouts: ['rsi', 'volume_surge'],
  high_roce_low_debt: ['roe', 'debt_to_equity'],
  oversold_quality: ['rsi', 'roe'],
  multibaggers: ['eps_growth', 'revenue_growth'],
  fifty_two_week_high: ['from_52w_high_pct', 'rsi'],
  dividend_aristocrats: ['dividend_yield', 'roe'],
  golden_cross: ['ma50', 'ma200'],
};

const upsidePct = (r: Stock) =>
  r.target_mean_price && r.price ? ((r.target_mean_price - r.price) / r.price) * 100 : null;

export default function RadarScreen() {
  const [market, setMarket] = useState<Market>('US');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  useEffect(() => {
    setLoading(true);
    api.strategies()
      .then((d) => { setStrategies(d.strategies); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const runStrategy = useCallback(async (key: string, m: Market) => {
    setActive(key);
    setLoading(true);
    setError(null);
    try {
      const r = await api.radar(key, m);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to run scan');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = () => { if (active) { setRefreshing(true); runStrategy(active, market); } };
  const exitDetail = () => { setActive(null); setResult(null); };

  const currency = result?.currency || (market === 'IN' ? 'INR' : 'USD');

  const columns = useMemo<SortableColumn[]>(() => {
    const metricCol = (key: string): SortableColumn => {
      const m = METRIC_BY_KEY[key];
      const label = (m?.label || key).replace(' (TTM)', '').replace(' Ratio', '').replace('Return on Equity (ROE)', 'ROE').replace(' (YoY)', ' Δ');
      const fmt = m?.fmt || 'num';
      const isPct = fmt === 'pct';
      return {
        key,
        label,
        width: fmt === 'pct' ? 76 : fmt === 'money' ? 74 : 64,
        align: 'right',
        mono: true,
        sortValue: (r: any) => r[key] ?? null,
        tone: isPct ? (r: any) => { const v = r[key]; return v == null ? undefined : v >= 0 ? 'pos' : 'neg'; } : undefined,
        render: (r: any) => fmtMetric(key, r[key], currency),
      };
    };

    const base: SortableColumn[] = [
      {
        key: 'price', label: 'Price', width: 74, align: 'right', mono: true,
        sortValue: (r: any) => r.price ?? null,
        render: (r: any) => fmtMetric('price', r.price, currency),
      },
      {
        key: 'change_pct', label: 'Chg%', width: 62, align: 'right', mono: true,
        sortValue: (r: any) => r.change_pct ?? null,
        tone: (r: any) => (r.change_pct == null ? undefined : r.change_pct >= 0 ? 'pos' : 'neg'),
        render: (r: any) => (r.change_pct == null ? '—' : `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%`),
      },
      {
        key: 'trend', label: 'Trend (30d)', width: 96, align: 'center',
        sortValue: () => null,
        render: (r: any) => <Sparkline data={r.sparkline || []} width={82} height={30} fill strokeWidth={1.6} />,
      },
      {
        key: 'rating', label: 'Analyst Rating', width: 132, align: 'right',
        sortValue: (r: any) => (r.recommendation_mean != null ? 5 - r.recommendation_mean : null),
        render: (r: any) => <AnalystGauge mean={r.recommendation_mean} count={r.analyst_count} />,
      },
      {
        key: 'upside', label: 'Upside', width: 78, align: 'right', mono: true,
        sortValue: (r: any) => upsidePct(r),
        tone: (r: any) => { const u = upsidePct(r); return u == null ? undefined : u >= 0 ? 'pos' : 'neg'; },
        render: (r: any) => { const u = upsidePct(r); return u == null ? '—' : `${u >= 0 ? '+' : ''}${u.toFixed(1)}%`; },
      },
    ];
    const extras = (STRATEGY_METRICS[active || ''] || ['pe', 'roe']).map(metricCol);
    return [...base, ...extras];
  }, [active, currency]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="radar-screen">
      <View style={styles.header}>
        {active && (
          <TouchableOpacity onPress={exitDetail} style={styles.iconBtn} testID="radar-back">
            <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{active && result ? result.title : 'Radar'}</Text>
          <Text style={styles.subtitle}>
            {active && result ? `${result.count} matches • ${market}` : 'Smart scans to surface super stocks'}
          </Text>
        </View>
        {active && (
          <TouchableOpacity onPress={onRefresh} style={styles.iconBtn} testID="radar-refresh">
            <Ionicons name="refresh" size={19} color={theme.colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ChipRow
        testID="market-toggle"
        options={[
          { value: 'US', label: '🇺🇸 US', testID: 'market-US' },
          { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
        ]}
        value={market}
        onChange={(v) => {
          setMarket(v as Market);
          marketPref.set(v as Market);
          if (active) runStrategy(active, v as Market);
        }}
      />

      {!active ? (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 120 }}>
          {loading ? (
            <LoadingState label="Loading strategies…" />
          ) : error ? (
            <ErrorState message={error} />
          ) : (
            <View style={styles.grid} testID="radar-grid">
              {strategies.map((s) => {
                const icon = ICON_MAP[s.icon] || 'flash';
                const accent = ACCENT[s.key] || theme.colors.success;
                return (
                  <TouchableOpacity
                    key={s.key}
                    testID={`radar-card-${s.key}`}
                    style={styles.card}
                    activeOpacity={0.85}
                    onPress={() => runStrategy(s.key, market)}
                  >
                    <LinearGradient
                      colors={[accent + '22', 'transparent']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={[styles.iconCircle, { backgroundColor: accent + '20', borderColor: accent + '55' }]}>
                      <Ionicons name={icon} size={20} color={accent} />
                    </View>
                    <Text style={styles.cardTitle}>{s.title}</Text>
                    <Text style={styles.cardSubtitle} numberOfLines={2}>{s.subtitle}</Text>
                    <View style={styles.cardFooter}>
                      <Text style={styles.cardCta}>Run scan</Text>
                      <Ionicons name="chevron-forward" size={14} color={theme.colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : loading ? (
        <LoadingState label={`Scanning ${market} universe…`} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => runStrategy(active, market)} />
      ) : !result || result.stocks.length === 0 ? (
        <EmptyState title="No matches" subtitle="Try the other market or a different strategy." />
      ) : (
        <View style={{ flex: 1 }}>
          <Text style={styles.strategyDescription}>{result.subtitle}</Text>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: theme.spacing.sm, paddingBottom: 120 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
          >
            <SortableDataTable
              testID="radar-table"
              columns={columns}
              rows={result.stocks}
              linkToStockField="symbol"
              stickyField="symbol"
              stickyWidth={94}
              defaultSort={{ key: 'rating', desc: true }}
            />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm, gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  scroll: { flex: 1 },
  grid: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  card: {
    width: '48.5%',
    minHeight: 152,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    overflow: 'hidden',
  },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: theme.spacing.md },
  cardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  cardSubtitle: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing.md },
  cardCta: { color: theme.colors.text, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  strategyDescription: {
    color: theme.colors.textMuted,
    fontSize: 13,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
});
