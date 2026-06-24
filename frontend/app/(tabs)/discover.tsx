import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { api, Market } from '@/src/api';
import { theme, fmtPct, changeColor } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import { LoadingState, ErrorState } from '@/src/components/States';
import WidgetCard from '@/src/components/widgets/WidgetCard';
import MiniRow from '@/src/components/widgets/MiniRow';
import RatingBar from '@/src/components/widgets/RatingBar';

export default function DiscoverScreen() {
  const router = useRouter();
  const [market, setMarket] = useState<Market>('US');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  const load = useCallback(async (m: Market) => {
    try {
      setError(null);
      const res = await api.discoverFeed(m);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load discover feed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(market); marketPref.set(market); }, [market, load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(market); }, [market, load]);

  const w = data?.widgets || {};

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="discover-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.subtitle}>Insights, picks & events across {data?.universe_size || '—'} stocks</Text>
        </View>
        <TouchableOpacity testID="open-search" onPress={() => router.push('/search')} style={styles.iconBtn}>
          <Ionicons name="search" size={20} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <ChipRow
        testID="market-toggle"
        options={[
          { value: 'US', label: '🇺🇸 United States', testID: 'market-US' },
          { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
        ]}
        value={market}
        onChange={(v) => setMarket(v as Market)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 140, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      >
        {loading ? (
          <LoadingState label="Building your Discover feed…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); load(market); }} />
        ) : (
          <>
            {/* AI Picks */}
            <WidgetCard
              id="ai-picks"
              title="AI Stock Recommendations"
              subtitle="Multi-factor model · Buy / Hold / Sell signals"
              icon="sparkles"
              accent="#A78BFA"
              rightBadge={{ label: 'AI', tone: 'neutral' }}
              testID="widget-ai-picks"
            >
              {(w.ai_picks?.preview || []).slice(0, 5).map((s: any) => (
                <MiniRow
                  key={s.symbol}
                  symbol={s.symbol}
                  name={s.name}
                  price={s.price}
                  currency={s.currency}
                  sparkline={s.sparkline}
                  rightLabel={s.ai_rating?.replace('_', ' ')}
                  rightValue={`${s.ai_score}`}
                  rightTone={s.ai_score >= 62 ? 'pos' : s.ai_score >= 48 ? 'neutral' : 'neg'}
                />
              ))}
            </WidgetCard>

            {/* Market-Moving Events */}
            <WidgetCard
              id="events"
              title="Market-Moving Events"
              subtitle="Breakouts, sell-offs, volume surges, RSI extremes"
              icon="flash"
              accent="#F59E0B"
              rightBadge={{ label: `${w.events?.preview?.length || 0} live`, tone: 'pos' }}
              testID="widget-events"
            >
              {(w.events?.preview || []).slice(0, 4).map((ev: any, i: number) => (
                <View key={`${ev.symbol}-${ev.type}-${i}`} style={styles.eventRow}>
                  <View style={[styles.eventDot, { backgroundColor: ev.tone === 'pos' ? theme.colors.success : theme.colors.error }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{ev.title} · {ev.symbol.replace('.NS', '')}</Text>
                    <Text style={styles.eventDetail} numberOfLines={1}>{ev.detail}</Text>
                  </View>
                  <Text style={[styles.eventChange, { color: changeColor(ev.change_pct) }]}>{fmtPct(ev.change_pct)}</Text>
                </View>
              ))}
            </WidgetCard>

            {/* Hot Analyst Ratings */}
            <WidgetCard
              id="analyst-ratings"
              title="Hot Analyst Ratings"
              subtitle="Consensus, upgrades & price targets"
              icon="people"
              accent="#60A5FA"
              testID="widget-analyst-ratings"
            >
              {(w.analyst_ratings?.preview || []).slice(0, 3).map((s: any) => (
                <View key={s.symbol} style={styles.analystRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.analystHead}>
                      <Text style={styles.analystSym}>{s.symbol.replace('.NS', '')}</Text>
                      <View style={styles.consensusBadge}>
                        <Text style={styles.consensusText}>{s.consensus.replace('_', ' ')}</Text>
                      </View>
                    </View>
                    <RatingBar
                      strongBuy={s.ratings.strong_buy}
                      buy={s.ratings.buy}
                      hold={s.ratings.hold}
                      sell={s.ratings.sell}
                    />
                  </View>
                </View>
              ))}
            </WidgetCard>

            {/* Popular Screeners */}
            <WidgetCard
              id="popular-screeners"
              title="Popular Screeners"
              subtitle="Strategies with the most matches today"
              icon="filter"
              accent="#34D399"
              testID="widget-popular-screeners"
            >
              {(w.popular_screeners?.preview || []).slice(0, 4).map((s: any) => (
                <View key={s.key} style={styles.screenerRow}>
                  <View style={[styles.screenerIcon, { backgroundColor: 'rgba(52,211,153,0.15)' }]}>
                    <Ionicons name={(s.icon || 'options') as any} size={14} color="#34D399" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.screenerTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={styles.screenerSub} numberOfLines={1}>{s.subtitle}</Text>
                  </View>
                  <Text style={styles.screenerCount}>{s.count}</Text>
                </View>
              ))}
            </WidgetCard>

            {/* Undervalued / Overvalued */}
            <WidgetCard
              id="valuation"
              title="Undervalued vs Overvalued"
              subtitle="Relative to sector P/E with quality filter"
              icon="git-compare"
              accent="#22D3EE"
              testID="widget-valuation"
            >
              <View style={styles.valRow}>
                <View style={styles.valCol}>
                  <Text style={[styles.valHeader, { color: theme.colors.success }]}>UNDERVALUED</Text>
                  {(w.valuation?.undervalued || []).slice(0, 3).map((s: any) => (
                    <View key={s.symbol} style={styles.valItem}>
                      <Text style={styles.valSym}>{s.symbol.replace('.NS', '')}</Text>
                      <Text style={styles.valMetric}>PE {s.pe?.toFixed(1) || '—'}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.valDiv} />
                <View style={styles.valCol}>
                  <Text style={[styles.valHeader, { color: theme.colors.error }]}>OVERVALUED</Text>
                  {(w.valuation?.overvalued || []).slice(0, 3).map((s: any) => (
                    <View key={s.symbol} style={styles.valItem}>
                      <Text style={styles.valSym}>{s.symbol.replace('.NS', '')}</Text>
                      <Text style={styles.valMetric}>PE {s.pe?.toFixed(1) || '—'}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </WidgetCard>

            {/* Top Investor Picks */}
            <WidgetCard
              id="investor-picks"
              title="Top Investor Picks"
              subtitle="Buffett · Lynch · Graham · Growth · Dividend"
              icon="trophy"
              accent="#F472B6"
              testID="widget-investor-picks"
            >
              {(w.investor_picks?.preview || []).slice(0, 4).map((p: any) => (
                <View key={p.key} style={styles.invRow}>
                  <View style={[styles.invIcon, { backgroundColor: 'rgba(244,114,182,0.15)' }]}>
                    <Ionicons name={(p.icon || 'star') as any} size={14} color="#F472B6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invTitle} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.invSub} numberOfLines={1}>
                      {(p.top || []).map((t: any) => t.symbol.replace('.NS', '')).join(' · ') || 'Loading…'}
                    </Text>
                  </View>
                  <Text style={styles.invCount}>{p.count}</Text>
                </View>
              ))}
            </WidgetCard>

            {/* Most Active */}
            <WidgetCard
              id="most-active"
              title="Most Active"
              subtitle="Highest volume vs 20-day average"
              icon="pulse"
              accent="#FB7185"
              testID="widget-most-active"
            >
              {(w.most_active?.preview || []).slice(0, 5).map((s: any) => (
                <MiniRow
                  key={s.symbol}
                  symbol={s.symbol}
                  name={s.name}
                  price={s.price}
                  changePct={s.change_pct}
                  currency={s.currency}
                  sparkline={s.sparkline}
                  rightLabel="Vol×"
                  rightValue={s.volume_surge ? `${s.volume_surge.toFixed(1)}×` : '—'}
                  rightTone={s.change_pct >= 0 ? 'pos' : 'neg'}
                />
              ))}
            </WidgetCard>

            {/* Winners & Losers */}
            <WidgetCard
              id="winners-losers"
              title="Daily Winners & Losers"
              subtitle="Top gainers and biggest decliners"
              icon="podium"
              accent="#84CC16"
              testID="widget-winners-losers"
            >
              <View style={styles.valRow}>
                <View style={styles.valCol}>
                  <Text style={[styles.valHeader, { color: theme.colors.success }]}>WINNERS</Text>
                  {(w.winners_losers?.gainers || []).slice(0, 4).map((s: any) => (
                    <View key={s.symbol} style={styles.valItem}>
                      <Text style={styles.valSym}>{s.symbol.replace('.NS', '')}</Text>
                      <Text style={[styles.valMetric, { color: theme.colors.success }]}>{fmtPct(s.change_pct)}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.valDiv} />
                <View style={styles.valCol}>
                  <Text style={[styles.valHeader, { color: theme.colors.error }]}>LOSERS</Text>
                  {(w.winners_losers?.losers || []).slice(0, 4).map((s: any) => (
                    <View key={s.symbol} style={styles.valItem}>
                      <Text style={styles.valSym}>{s.symbol.replace('.NS', '')}</Text>
                      <Text style={[styles.valMetric, { color: theme.colors.error }]}>{fmtPct(s.change_pct)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </WidgetCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.bg2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  scroll: { flex: 1 },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  eventTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  eventDetail: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  eventChange: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  analystRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  analystHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  analystSym: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  consensusBadge: { backgroundColor: 'rgba(96,165,250,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  consensusText: { color: '#60A5FA', fontSize: 10, fontWeight: '700' },
  screenerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  screenerIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  screenerTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  screenerSub: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 1 },
  screenerCount: { color: theme.colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  valRow: { flexDirection: 'row', paddingTop: 4 },
  valCol: { flex: 1 },
  valDiv: { width: 1, backgroundColor: theme.colors.divider, marginHorizontal: 8 },
  valHeader: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  valItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  valSym: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  valMetric: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  invRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  invIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  invTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  invSub: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 1 },
  invCount: { color: theme.colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
