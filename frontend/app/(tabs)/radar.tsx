import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { api, Market, RadarResult, Strategy } from '@/src/api';
import { theme } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import StockRow from '@/src/components/StockRow';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';

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

  const onRefresh = () => {
    if (active) { setRefreshing(true); runStrategy(active, market); }
  };

  const exitDetail = () => { setActive(null); setResult(null); };

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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          active ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />
          ) : undefined
        }
      >
        {!active ? (
          loading ? (
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
          )
        ) : loading ? (
          <LoadingState label={`Scanning ${market} universe…`} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => runStrategy(active, market)} />
        ) : !result || result.stocks.length === 0 ? (
          <EmptyState title="No matches" subtitle="Try the other market or a different strategy." />
        ) : (
          <View>
            <Text style={styles.strategyDescription}>{result.subtitle}</Text>
            {result.stocks.map((s) => (
              <StockRow
                key={s.symbol}
                stock={s}
                testIDPrefix={`radar-${result.strategy}`}
                rightBadges={radarBadges(result.strategy, s)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function radarBadges(strategy: string, s: any) {
  switch (strategy) {
    case 'value_picks':
      return [
        { label: 'P/E', value: s.pe?.toFixed(1) ?? '—' },
        { label: 'ROE', value: (s.roe?.toFixed(0) ?? '—') + '%', tone: 'pos' as const },
      ];
    case 'momentum_breakouts':
      return [
        { label: 'RSI', value: s.rsi?.toFixed(0) ?? '—' },
        { label: 'Vol×', value: s.volume_surge?.toFixed(1) + 'x', tone: 'pos' as const },
      ];
    case 'high_roce_low_debt':
      return [
        { label: 'ROE', value: (s.roe?.toFixed(0) ?? '—') + '%', tone: 'pos' as const },
        { label: 'D/E', value: s.debt_to_equity?.toFixed(0) ?? '—' },
      ];
    case 'oversold_quality':
      return [
        { label: 'RSI', value: s.rsi?.toFixed(0) ?? '—', tone: 'neg' as const },
        { label: 'ROE', value: (s.roe?.toFixed(0) ?? '—') + '%' },
      ];
    case 'multibaggers':
      return [
        { label: 'EPS Δ', value: (s.eps_growth?.toFixed(0) ?? '—') + '%', tone: 'pos' as const },
        { label: 'Rev Δ', value: (s.revenue_growth?.toFixed(0) ?? '—') + '%', tone: 'pos' as const },
      ];
    case 'fifty_two_week_high':
      return [{ label: 'From 52w', value: (s.from_52w_high_pct?.toFixed(1) ?? '—') + '%' }];
    case 'dividend_aristocrats':
      return [
        { label: 'Yield', value: (s.dividend_yield?.toFixed(2) ?? '—') + '%', tone: 'pos' as const },
        { label: 'ROE', value: (s.roe?.toFixed(0) ?? '—') + '%' },
      ];
    case 'golden_cross':
      return [
        { label: '50DMA', value: s.ma50?.toFixed(0) ?? '—' },
        { label: '200DMA', value: s.ma200?.toFixed(0) ?? '—' },
      ];
    default:
      return undefined;
  }
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
