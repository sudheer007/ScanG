import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, PortfolioInsights, SinceAdded, TrackRecord, Stock } from '@/src/api';
import { theme } from '@/src/theme';
import { fmtDayShort } from '@/src/utils/date';
import { watchlist, WatchItem } from '@/src/storage-keys';
import StockRow from '@/src/components/StockRow';
import { EmptyState, LoadingState } from '@/src/components/States';

export default function WatchlistScreen() {
  const router = useRouter();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Stock[]>([]);
  const [insights, setInsights] = useState<PortfolioInsights | null>(null);
  const [sinceAdded, setSinceAdded] = useState<SinceAdded | null>(null);
  const [trackRecord, setTrackRecord] = useState<TrackRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await watchlist.list();
    setItems(list);
    if (list.length === 0) {
      setQuotes([]);
      setInsights(null);
      setSinceAdded(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const symbols = list.map((x) => x.symbol);
    if (symbols.length >= 2) {
      api.portfolioInsights(symbols).then(setInsights).catch(() => setInsights(null));
    } else {
      setInsights(null);
    }
    const withAddedAt = list.filter((x) => x.addedAt != null);
    if (withAddedAt.length > 0) {
      api.sinceAdded(withAddedAt.map((x) => ({ symbol: x.symbol, market: x.market, added_at: x.addedAt! })))
        .then(setSinceAdded).catch(() => setSinceAdded(null));
    } else {
      setSinceAdded(null);
    }
    api.trackRecord().then(setTrackRecord).catch(() => setTrackRecord(null));
    try {
      const r = await api.batchQuotes(symbols);
      const ordered: Stock[] = [];
      list.forEach((wi) => {
        const q = r.quotes.find((x) => x.symbol === wi.symbol);
        if (q) ordered.push(q as Stock);
      });
      setQuotes(ordered);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const remove = async (symbol: string) => {
    await watchlist.remove(symbol);
    setQuotes((prev) => prev.filter((x) => x.symbol !== symbol));
    setItems((prev) => prev.filter((x) => x.symbol !== symbol));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="watchlist-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Watchlist</Text>
          <Text style={styles.subtitle}>{items.length} tracked</Text>
        </View>
        <TouchableOpacity testID="open-search" onPress={() => router.push('/search')} style={styles.iconBtn}>
          <Ionicons name="add" size={22} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.text} />}
      >
        {loading ? (
          <LoadingState />
        ) : quotes.length === 0 ? (
          <View style={styles.emptyWrap} testID="watchlist-empty">
            <Ionicons name="bookmarks-outline" size={48} color={theme.colors.borderStrong} />
            <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
            <Text style={styles.emptySubtitle}>Tap a stock in Markets, Radar, or Screener to add it here.</Text>
            <TouchableOpacity testID="empty-cta" onPress={() => router.push('/(tabs)/screener')} style={styles.ctaBtn}>
              <Text style={styles.ctaBtnText}>Go to Screener</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {sinceAdded?.available ? <SinceAddedPanel data={sinceAdded} /> : null}
            {trackRecord ? <TrackRecordPanel data={trackRecord} /> : null}
            {insights?.available ? <InsightsPanel insights={insights} /> : null}
            {quotes.map((s) => (
              <View key={s.symbol} style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1 }}>
                  <StockRow stock={s} testIDPrefix="watchlist-row" />
                </View>
                <TouchableOpacity
                  testID={`remove-${s.symbol}`}
                  onPress={() => remove(s.symbol)}
                  style={styles.removeBtn}
                >
                  <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const MATURITY_LABEL: Record<string, string> = {
  no_data: 'No graded calls yet', building: 'Still building a track record',
  early: 'Early track record', established: 'Established track record',
};

function SinceAddedPanel({ data }: { data: SinceAdded }) {
  const avgColor = (data.avg_return_pct || 0) >= 0 ? theme.colors.success : theme.colors.error;
  return (
    <View style={styles.insightsCard} testID="watchlist-since-added">
      <View style={styles.insightsHead}>
        <Text style={styles.insightsTitle}>Since You Added These</Text>
        <Text style={[styles.sinceAddedBig, { color: avgColor }]}>
          {(data.avg_return_pct || 0) >= 0 ? '+' : ''}{data.avg_return_pct?.toFixed(1)}%
        </Text>
      </View>
      <Text style={styles.insightsMeta}>
        {data.win_count}/{data.count} positions up{data.avg_alpha_pct != null ? ` · ${data.avg_alpha_pct >= 0 ? '+' : ''}${data.avg_alpha_pct.toFixed(1)}% avg vs benchmark` : ''}
      </Text>
      {(data.items || []).slice(0, 5).map((it) => (
        <View key={it.symbol} style={styles.sinceAddedRow}>
          <Text style={styles.sinceAddedSym}>{it.symbol.replace('.NS', '')}</Text>
          <Text style={styles.sinceAddedDays}>{it.added_days_ago}d ago</Text>
          <Text style={[styles.sinceAddedReturn, { color: it.return_pct >= 0 ? theme.colors.success : theme.colors.error }]}>
            {it.return_pct >= 0 ? '+' : ''}{it.return_pct.toFixed(1)}%
          </Text>
        </View>
      ))}
      <Text style={styles.dcfNoteSmall}>This is your own performance since adding each symbol — not the app's prediction, your actual outcome.</Text>
    </View>
  );
}

function TrackRecordPanel({ data }: { data: TrackRecord }) {
  const o = data.overall;
  const maturityColor = o.maturity === 'established' ? theme.colors.success : o.maturity === 'early' ? theme.colors.warning : theme.colors.textMuted;
  return (
    <View style={styles.insightsCard} testID="watchlist-track-record">
      <View style={styles.insightsHead}>
        <Text style={styles.insightsTitle}>App Track Record</Text>
        <View style={[styles.divBadge, { backgroundColor: maturityColor + '22' }]}>
          <Text style={[styles.divBadgeText, { color: maturityColor }]}>{MATURITY_LABEL[o.maturity]}</Text>
        </View>
      </View>
      {o.n === 0 ? (
        <Text style={styles.insightsMeta}>No calls have matured yet — the ledger started tracking today's radar matches, ratings, and forecasts. Check back as they resolve.</Text>
      ) : (
        <>
          <Text style={styles.insightsMeta}>
            {o.hit_rate_pct}% hit rate · {(o.avg_alpha_pct || 0) >= 0 ? '+' : ''}{o.avg_alpha_pct?.toFixed(1)}% avg alpha vs benchmark · n={o.n}
          </Text>
          <Text style={styles.dcfNoteSmall}>Every graded call, wins and losses both — nothing here is cherry-picked or hidden after the fact.</Text>
        </>
      )}
    </View>
  );
}

const DIVERSIFICATION_COLOR: Record<string, string> = {
  Diversified: theme.colors.success, Moderate: theme.colors.warning, Concentrated: theme.colors.error,
};
const SEVERITY_COLOR: Record<string, string> = {
  high: theme.colors.error, medium: theme.colors.warning, low: theme.colors.textMuted,
};

function InsightsPanel({ insights }: { insights: PortfolioInsights }) {
  const divColor = DIVERSIFICATION_COLOR[insights.diversification || 'Moderate'];
  const avg = insights.averages;
  const topSectors = (insights.sector_exposure || []).slice(0, 3);
  return (
    <View style={styles.insightsCard} testID="watchlist-insights">
      <View style={styles.insightsHead}>
        <Text style={styles.insightsTitle}>Watchlist Intelligence</Text>
        <View style={[styles.divBadge, { backgroundColor: divColor + '22' }]}>
          <Text style={[styles.divBadgeText, { color: divColor }]}>{insights.diversification}</Text>
        </View>
      </View>

      <Text style={styles.insightsMeta}>
        {topSectors.map((s) => `${s.sector} ${s.weight_pct.toFixed(0)}%`).join(' · ')}
        {insights.avg_pairwise_correlation != null ? ` · avg correlation ${insights.avg_pairwise_correlation.toFixed(2)}` : ''}
      </Text>

      <View style={styles.insightsStatsRow}>
        <View style={styles.insightsStat}>
          <Text style={styles.insightsStatLabel}>Avg Beta</Text>
          <Text style={styles.insightsStatValue}>{avg?.beta != null ? avg.beta.toFixed(2) : '—'}</Text>
        </View>
        <View style={styles.insightsStat}>
          <Text style={styles.insightsStatLabel}>Avg P/E</Text>
          <Text style={styles.insightsStatValue}>{avg?.pe != null ? avg.pe.toFixed(1) : '—'}</Text>
        </View>
        <View style={styles.insightsStat}>
          <Text style={styles.insightsStatLabel}>Day</Text>
          <Text style={[styles.insightsStatValue, { color: (avg?.day_change_pct || 0) >= 0 ? theme.colors.success : theme.colors.error }]}>
            {avg?.day_change_pct != null ? `${avg.day_change_pct >= 0 ? '+' : ''}${avg.day_change_pct.toFixed(2)}%` : '—'}
          </Text>
        </View>
        <View style={styles.insightsStat}>
          <Text style={styles.insightsStatLabel}>YTD</Text>
          <Text style={[styles.insightsStatValue, { color: (avg?.ytd_pct || 0) >= 0 ? theme.colors.success : theme.colors.error }]}>
            {avg?.ytd_pct != null ? `${avg.ytd_pct >= 0 ? '+' : ''}${avg.ytd_pct.toFixed(1)}%` : '—'}
          </Text>
        </View>
      </View>

      {(insights.risk_flags || []).slice(0, 3).map((f, i) => (
        <View key={i} style={styles.flagRow}>
          <Ionicons name="warning" size={14} color={SEVERITY_COLOR[f.severity] || theme.colors.warning} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.flagTitle, { color: SEVERITY_COLOR[f.severity] || theme.colors.warning }]}>{f.title}</Text>
            <Text style={styles.flagDetail}>{f.detail}</Text>
          </View>
        </View>
      ))}

      {(insights.upcoming_earnings || []).length > 0 ? (
        <View style={styles.earnRow}>
          <Ionicons name="calendar" size={14} color={theme.colors.textMuted} />
          <Text style={styles.earnText} numberOfLines={2}>
            Earnings ahead:{' '}
            {(insights.upcoming_earnings || []).slice(0, 4)
              .map((e) => `${e.symbol.replace('.NS', '')} ${fmtDayShort(e.earnings_date_epoch)}`)
              .join(' · ')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', padding: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginTop: theme.spacing.md },
  emptySubtitle: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
  ctaBtn: { marginTop: theme.spacing.lg, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
  ctaBtnText: { color: theme.colors.bg, fontWeight: '700' },
  removeBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  insightsCard: { marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md },
  insightsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  insightsTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  divBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  divBadgeText: { fontSize: 11, fontWeight: '800' },
  insightsMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 6 },
  insightsStatsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  insightsStat: { flex: 1, backgroundColor: theme.colors.bg3, borderRadius: theme.radius.sm, paddingVertical: 6, paddingHorizontal: 8 },
  insightsStatLabel: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  insightsStatValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  flagRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-start' },
  flagTitle: { fontSize: 12, fontWeight: '700' },
  flagDetail: { color: theme.colors.textMuted, fontSize: 10, marginTop: 1, lineHeight: 14 },
  earnRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-start' },
  earnText: { color: theme.colors.textMuted, fontSize: 11, flex: 1, lineHeight: 15 },
  sinceAddedBig: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sinceAddedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.divider, marginTop: 6 },
  sinceAddedSym: { color: theme.colors.text, fontSize: 12, fontWeight: '700', width: 70 },
  sinceAddedDays: { color: theme.colors.textSubtle, fontSize: 10, flex: 1 },
  sinceAddedReturn: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dcfNoteSmall: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 8, lineHeight: 14, fontStyle: 'italic' },
});
