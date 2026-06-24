import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, HistoryPoint, Stock } from '@/src/api';
import { theme, fmtPrice, fmtPct, fmtMarketCap, changeColor, fmtNum } from '@/src/theme';
import { watchlist } from '@/src/storage-keys';
import PriceChart from '@/src/components/PriceChart';
import { ErrorState, LoadingState } from '@/src/components/States';

const PERIODS: { label: string; period: string; interval: string }[] = [
  { label: '1D', period: '1d', interval: '5m' },
  { label: '1W', period: '5d', interval: '30m' },
  { label: '1M', period: '1mo', interval: '1d' },
  { label: '3M', period: '3mo', interval: '1d' },
  { label: '6M', period: '6mo', interval: '1d' },
  { label: '1Y', period: '1y', interval: '1d' },
  { label: '5Y', period: '5y', interval: '1wk' },
];

export default function StockDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const [stock, setStock] = useState<Stock | null>(null);
  const [periodIdx, setPeriodIdx] = useState(4); // 6M
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inList, setInList] = useState(false);

  const load = useCallback(async () => {
    if (!symbol) return;
    try {
      setError(null);
      const s = await api.stock(symbol);
      setStock(s);
      setInList(await watchlist.has(symbol));
    } catch (e: any) {
      setError(e?.message || 'Failed to load stock');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const loadHistory = useCallback(async () => {
    if (!symbol) return;
    setChartLoading(true);
    try {
      const p = PERIODS[periodIdx];
      const r = await api.history(symbol, p.period, p.interval);
      setHistory(r.points);
    } finally {
      setChartLoading(false);
    }
  }, [symbol, periodIdx]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggleWatch = async () => {
    if (!stock) return;
    if (inList) {
      await watchlist.remove(stock.symbol);
      setInList(false);
    } else {
      await watchlist.add({ symbol: stock.symbol, market: stock.symbol.endsWith('.NS') ? 'IN' : 'US', name: stock.name });
      setInList(true);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} title={symbol || ''} subtitle="" />
        <LoadingState />
      </SafeAreaView>
    );
  }
  if (error || !stock) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} title={symbol || ''} subtitle="" />
        <ErrorState message={error || 'Stock not found'} onRetry={load} />
      </SafeAreaView>
    );
  }

  const ccy = stock.currency || 'USD';
  const closes = history.map((p) => p.c || 0).filter((x) => x);
  const screenW = Dimensions.get('window').width;
  const symbolShort = stock.symbol.replace('.NS', '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="stock-detail-screen">
      <Header
        onBack={() => router.back()}
        title={symbolShort}
        subtitle={stock.name}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              testID="open-analyzer"
              onPress={() => router.push({ pathname: '/analyzer/[symbol]', params: { symbol: stock.symbol } })}
              style={[styles.iconBtn, { backgroundColor: 'rgba(167,139,250,0.18)', borderColor: 'rgba(167,139,250,0.5)' }]}
            >
              <Ionicons name="sparkles" size={18} color="#A78BFA" />
            </TouchableOpacity>
            <TouchableOpacity testID="toggle-watchlist" onPress={toggleWatch} style={styles.iconBtn}>
              <Ionicons name={inList ? 'bookmark' : 'bookmark-outline'} size={20} color={inList ? theme.colors.success : theme.colors.text} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.priceBlock}>
          <Text style={styles.price}>{fmtPrice(stock.price, ccy)}</Text>
          <Text style={[styles.change, { color: changeColor(stock.change_pct) }]}>
            {stock.change !== null ? `${(stock.change || 0) >= 0 ? '+' : ''}${(stock.change || 0).toFixed(2)} (${fmtPct(stock.change_pct)})` : '—'}
          </Text>
          <Text style={styles.meta}>{stock.exchange || ''}{stock.exchange ? ' • ' : ''}{ccy}</Text>
        </View>

        <View style={styles.chartWrap}>
          {chartLoading ? (
            <View style={styles.chartLoading}><ActivityIndicator color={theme.colors.textMuted} /></View>
          ) : (
            <PriceChart data={closes} width={screenW - 32} height={200} />
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
          {PERIODS.map((p, i) => (
            <TouchableOpacity
              key={p.label}
              testID={`period-${p.label}`}
              onPress={() => setPeriodIdx(i)}
              style={[styles.periodChip, periodIdx === i && styles.periodChipActive]}
            >
              <Text style={[styles.periodText, periodIdx === i && styles.periodTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Section title="Key Metrics">
          <MetricGrid items={[
            { label: 'Market Cap', value: fmtMarketCap(stock.market_cap, ccy) },
            { label: 'P/E', value: fmtNum(stock.pe) },
            { label: 'P/B', value: fmtNum(stock.pb) },
            { label: 'EPS', value: fmtNum(stock.eps) },
            { label: 'ROE', value: stock.roe != null ? `${stock.roe.toFixed(1)}%` : '—' },
            { label: 'Debt/Equity', value: fmtNum(stock.debt_to_equity) },
            { label: 'Div Yield', value: stock.dividend_yield != null ? `${stock.dividend_yield.toFixed(2)}%` : '—' },
            { label: 'Beta', value: fmtNum(stock.beta) },
            { label: 'Profit Margin', value: stock.profit_margin != null ? `${stock.profit_margin.toFixed(1)}%` : '—' },
          ]} />
        </Section>

        <Section title="Growth">
          <MetricGrid items={[
            { label: 'EPS Growth (Q)', value: stock.eps_growth != null ? `${stock.eps_growth.toFixed(1)}%` : '—', tone: stock.eps_growth && stock.eps_growth > 0 ? 'pos' : 'neg' },
            { label: 'Revenue Growth', value: stock.revenue_growth != null ? `${stock.revenue_growth.toFixed(1)}%` : '—', tone: stock.revenue_growth && stock.revenue_growth > 0 ? 'pos' : 'neg' },
            { label: 'Forward P/E', value: fmtNum(stock.forward_pe) },
          ]} />
        </Section>

        <Section title="Technicals">
          <View style={styles.techRow}>
            <RSIBadge rsi={stock.rsi} />
            <TechBadge label="50 DMA" value={fmtNum(stock.ma50)} />
            <TechBadge label="200 DMA" value={fmtNum(stock.ma200)} />
          </View>
          <MetricGrid items={[
            { label: 'MACD', value: fmtNum(stock.macd, 3) },
            { label: 'Signal', value: fmtNum(stock.macd_signal, 3) },
            { label: 'Volume Surge', value: stock.volume_surge != null ? `${stock.volume_surge.toFixed(2)}x` : '—', tone: (stock.volume_surge || 0) > 1.2 ? 'pos' : undefined },
            { label: '52w High', value: fmtPrice(stock.high_52w, ccy) },
            { label: '52w Low', value: fmtPrice(stock.low_52w, ccy) },
            { label: 'From 52w High', value: stock.from_52w_high_pct != null ? `${stock.from_52w_high_pct.toFixed(1)}%` : '—' },
          ]} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack, title, subtitle, right }: { onBack: () => void; title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity testID="back-btn" onPress={onBack} style={styles.iconBtn}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.hTitle}>{title}</Text>
        <Text style={styles.hSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      {right}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MetricGrid({ items }: { items: { label: string; value: string; tone?: 'pos' | 'neg' }[] }) {
  return (
    <View style={styles.metricGrid}>
      {items.map((m, i) => (
        <View key={i} style={styles.metricCard} testID={`metric-${m.label}`}>
          <Text style={styles.metricLabel}>{m.label}</Text>
          <Text style={[styles.metricValue, m.tone === 'pos' && { color: theme.colors.success }, m.tone === 'neg' && { color: theme.colors.error }]}>{m.value}</Text>
        </View>
      ))}
    </View>
  );
}

function RSIBadge({ rsi }: { rsi: number | null | undefined }) {
  if (rsi == null) return <TechBadge label="RSI" value="—" />;
  let label = 'Neutral'; let color = theme.colors.textMuted;
  if (rsi > 70) { label = 'Overbought'; color = theme.colors.error; }
  else if (rsi < 30) { label = 'Oversold'; color = theme.colors.warning; }
  else if (rsi > 50) { label = 'Bullish'; color = theme.colors.success; }
  else { label = 'Bearish'; color = theme.colors.textMuted; }
  return (
    <View style={styles.techBadge}>
      <Text style={styles.techBadgeLabel}>RSI ({rsi.toFixed(0)})</Text>
      <Text style={[styles.techBadgeValue, { color }]}>{label}</Text>
    </View>
  );
}

function TechBadge({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.techBadge}>
      <Text style={styles.techBadgeLabel}>{label}</Text>
      <Text style={styles.techBadgeValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md, gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  hTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  hSubtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  priceBlock: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  price: { color: theme.colors.text, fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontSize: 15, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },
  meta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
  chartWrap: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm, minHeight: 200 },
  chartLoading: { height: 200, alignItems: 'center', justifyContent: 'center' },
  periodRow: { paddingHorizontal: theme.spacing.lg, gap: 8, paddingVertical: theme.spacing.sm, alignItems: 'center' },
  periodChip: { flexShrink: 0, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border, minWidth: 44, alignItems: 'center' },
  periodChipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  periodText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  periodTextActive: { color: theme.colors.bg },
  section: { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: theme.spacing.sm },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  metricLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  metricValue: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  techRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  techBadge: { flex: 1, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  techBadgeLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  techBadgeValue: { color: theme.colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
});
