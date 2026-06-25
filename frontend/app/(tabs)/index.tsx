import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { api, IndexQuote, Market, Stock, NewsItem, SectorRow } from '@/src/api';
import { theme, fmtPrice, fmtPct, fmtMarketCap, changeColor } from '@/src/theme';
import { fmtDayShort, daysUntilLabel } from '@/src/utils/date';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import SegmentedTabs from '@/src/components/widgets/SegmentedTabs';
import StockRow from '@/src/components/StockRow';
import Sparkline from '@/src/components/Sparkline';
import NewsList from '@/src/components/NewsList';
import SectorHeatmap from '@/src/components/SectorHeatmap';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';

type Tab = 'overview' | 'movers' | 'sectors' | 'news' | 'calendar';

export default function MarketsScreen() {
  const router = useRouter();
  const [market, setMarket] = useState<Market>('US');
  const [tab, setTab] = useState<Tab>('overview');

  // data
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [gainers, setGainers] = useState<Stock[]>([]);
  const [losers, setLosers] = useState<Stock[]>([]);
  const [mostActive, setMostActive] = useState<Stock[]>([]);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [earnings, setEarnings] = useState<any[]>([]);
  const [dividends, setDividends] = useState<any[]>([]);

  // sub toggles
  const [moverSub, setMoverSub] = useState<'gainers' | 'losers' | 'active'>('gainers');
  const [calSub, setCalSub] = useState<'earnings' | 'dividends'>('earnings');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  const loadTab = useCallback(async (t: Tab, m: Market, force = false) => {
    try {
      setError(null);
      if (t === 'overview') {
        const [ov, sec] = await Promise.all([api.marketOverview(m, force), api.discoverSectorRotation(m, force)]);
        setIndices(ov.indices || []); setGainers(ov.gainers || []); setLosers(ov.losers || []);
        setSectors(sec.sectors || []);
      } else if (t === 'movers') {
        const [ov, ma] = await Promise.all([api.marketOverview(m, force), api.discoverMostActive(m, force)]);
        setGainers(ov.gainers || []); setLosers(ov.losers || []); setMostActive(ma.stocks || []);
      } else if (t === 'sectors') {
        const sec = await api.discoverSectorRotation(m, force); setSectors(sec.sectors || []);
      } else if (t === 'news') {
        const n = await api.newsMarket(m, force); setNews(n.news || []);
      } else if (t === 'calendar') {
        const [ec, dc] = await Promise.all([api.discoverEarningsCalendar(m, force), api.discoverDividendCalendar(m, force)]);
        setEarnings(ec.items || []); setDividends(dc.items || []);
      }
      loadedRef.current.add(`${m}:${t}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to load market data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // load on market/tab change
  useEffect(() => {
    const key = `${market}:${tab}`;
    if (!loadedRef.current.has(key)) setLoading(true);
    loadTab(tab, market);
    marketPref.set(market);
  }, [market, tab, loadTab]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTab(tab, market, true);
  }, [tab, market, loadTab]);

  const goStock = (sym: string) => router.push({ pathname: '/stock/[symbol]', params: { symbol: sym } });

  const hasData = (() => {
    switch (tab) {
      case 'overview': return indices.length > 0 || gainers.length > 0;
      case 'movers': return gainers.length > 0 || losers.length > 0 || mostActive.length > 0;
      case 'sectors': return sectors.length > 0;
      case 'news': return news.length > 0;
      case 'calendar': return earnings.length > 0 || dividends.length > 0;
    }
  })();

  const breadth = sectors.reduce((acc, s) => { acc.w += s.winners; acc.l += s.losers; return acc; }, { w: 0, l: 0 });
  const breadthPct = breadth.w + breadth.l > 0 ? Math.round((breadth.w * 100) / (breadth.w + breadth.l)) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="markets-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Markets</Text>
          <Text style={styles.subtitle}>Live • {market === 'US' ? 'United States' : 'India'}</Text>
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

      <SegmentedTabs
        testID="markets-tabs"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'movers', label: 'Movers' },
          { value: 'sectors', label: 'Sectors' },
          { value: 'news', label: 'News' },
          { value: 'calendar', label: 'Calendar' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 130, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      >
        {loading && !hasData ? (
          <LoadingState label="Fetching live market data…" />
        ) : error && !hasData ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); loadTab(tab, market, true); }} />
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab
                indices={indices} gainers={gainers} losers={losers} sectors={sectors}
                breadthPct={breadthPct} onStock={goStock} onSeeMore={() => setTab('movers')}
                onSectors={() => setTab('sectors')}
              />
            )}
            {tab === 'movers' && (
              <MoversTab
                sub={moverSub} setSub={setMoverSub}
                gainers={gainers} losers={losers} active={mostActive}
              />
            )}
            {tab === 'sectors' && <SectorsTab sectors={sectors} />}
            {tab === 'news' && (
              <View style={{ paddingTop: 8 }}>
                <NewsList news={news} onTickerPress={goStock} emptyLabel="No market headlines right now." />
              </View>
            )}
            {tab === 'calendar' && (
              <CalendarTab sub={calSub} setSub={setCalSub} earnings={earnings} dividends={dividends} onStock={goStock} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ indices, gainers, losers, sectors, breadthPct, onStock, onSeeMore, onSectors }: {
  indices: IndexQuote[]; gainers: Stock[]; losers: Stock[]; sectors: SectorRow[];
  breadthPct: number; onStock: (s: string) => void; onSeeMore: () => void; onSectors: () => void;
}) {
  const topSectors = [...sectors].slice(0, 6);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.indicesRow} style={styles.indicesScroll} testID="indices-row">
        {indices.map((idx) => (
          <View key={idx.symbol} style={styles.indexCard} testID={`index-card-${idx.symbol}`}>
            <Text style={styles.indexName} numberOfLines={1}>{idx.name}</Text>
            <Text style={styles.indexValue}>{fmtPrice(idx.price, idx.currency).replace('$', '').replace('₹', '')}</Text>
            <View style={styles.indexChangeRow}>
              <Text style={[styles.indexChange, { color: changeColor(idx.change_pct) }]}>{fmtPct(idx.change_pct)}</Text>
              <Sparkline data={idx.sparkline || []} width={60} height={20} />
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Breadth bar */}
      <View style={styles.breadthCard}>
        <View style={styles.breadthHead}>
          <Text style={styles.breadthTitle}>Market Breadth</Text>
          <Text style={styles.breadthPctText}>{breadthPct}% advancing</Text>
        </View>
        <View style={styles.breadthBar}>
          <View style={[styles.breadthFill, { width: `${breadthPct}%`, backgroundColor: theme.colors.success }]} />
          <View style={[styles.breadthFill, { width: `${100 - breadthPct}%`, backgroundColor: theme.colors.error }]} />
        </View>
      </View>

      {/* Sector heatmap */}
      <SectionHeader title="Sector Heatmap" actionLabel="All sectors" onAction={onSectors} />
      <SectorHeatmap sectors={topSectors} onSelect={onSectors} />

      {/* Top gainers / losers preview */}
      <SectionHeader title="Top Gainers" actionLabel="All movers" onAction={onSeeMore} />
      <View>{gainers.slice(0, 5).map((s) => <StockRow key={s.symbol} stock={s} testIDPrefix="ov-gainer" />)}</View>
      <SectionHeader title="Top Losers" actionLabel="All movers" onAction={onSeeMore} />
      <View>{losers.slice(0, 5).map((s) => <StockRow key={s.symbol} stock={s} testIDPrefix="ov-loser" />)}</View>
    </>
  );
}

// ---------------- Movers ----------------
function MoversTab({ sub, setSub, gainers, losers, active }: {
  sub: 'gainers' | 'losers' | 'active'; setSub: (s: any) => void;
  gainers: Stock[]; losers: Stock[]; active: Stock[];
}) {
  const list = sub === 'gainers' ? gainers : sub === 'losers' ? losers : active;
  return (
    <View style={{ paddingTop: 6 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, marginBottom: 6 }}>
        <SegmentedTabs
          options={[
            { value: 'gainers', label: '📈 Gainers' },
            { value: 'losers', label: '📉 Losers' },
            { value: 'active', label: '🔥 Most Active' },
          ]}
          value={sub}
          onChange={setSub}
        />
      </View>
      {list.length === 0 ? (
        <EmptyState title="No data" subtitle="Pull to refresh." />
      ) : (
        list.map((s) => (
          <StockRow
            key={s.symbol}
            stock={s}
            testIDPrefix={`mover-${sub}`}
            rightBadges={sub === 'active' && s.volume_surge ? [{ label: 'Vol', value: `${s.volume_surge.toFixed(1)}x`, tone: 'pos' }] : undefined}
          />
        ))
      )}
    </View>
  );
}

// ---------------- Sectors ----------------
function SectorsTab({ sectors }: { sectors: SectorRow[] }) {
  if (sectors.length === 0) return <EmptyState title="No sector data" subtitle="Pull to refresh." />;
  const leaders = sectors.slice(0, 3);
  const laggards = [...sectors].slice(-3).reverse();
  return (
    <View style={{ paddingTop: 8 }}>
      <View style={styles.rotationRow}>
        <View style={styles.rotationCol}>
          <Text style={[styles.rotationLabel, { color: theme.colors.success }]}>↑ LEADERS</Text>
          {leaders.map((s) => (
            <Text key={s.sector} style={styles.rotationItem} numberOfLines={1}>{s.sector} <Text style={{ color: theme.colors.success }}>{s.avg_change_pct.toFixed(2)}%</Text></Text>
          ))}
        </View>
        <View style={styles.rotationCol}>
          <Text style={[styles.rotationLabel, { color: theme.colors.error }]}>↓ LAGGARDS</Text>
          {laggards.map((s) => (
            <Text key={s.sector} style={styles.rotationItem} numberOfLines={1}>{s.sector} <Text style={{ color: theme.colors.error }}>{s.avg_change_pct.toFixed(2)}%</Text></Text>
          ))}
        </View>
      </View>
      <SectionHeader title="All Sectors" />
      <SectorHeatmap sectors={sectors} />
    </View>
  );
}

// ---------------- Calendar ----------------
function CalendarTab({ sub, setSub, earnings, dividends, onStock }: {
  sub: 'earnings' | 'dividends'; setSub: (s: any) => void;
  earnings: any[]; dividends: any[]; onStock: (s: string) => void;
}) {
  const list = sub === 'earnings' ? earnings : dividends;
  return (
    <View style={{ paddingTop: 6 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, marginBottom: 6 }}>
        <SegmentedTabs
          options={[
            { value: 'earnings', label: '📊 Earnings', count: earnings.length },
            { value: 'dividends', label: '💰 Ex-Dividend', count: dividends.length },
          ]}
          value={sub}
          onChange={setSub}
        />
      </View>
      {list.length === 0 ? (
        <EmptyState title="Nothing scheduled" subtitle="No upcoming events in range." />
      ) : (
        <View style={{ paddingHorizontal: theme.spacing.lg, gap: 8 }}>
          {list.map((it) => (
            <TouchableOpacity key={it.symbol} activeOpacity={0.8} onPress={() => onStock(it.symbol)} style={styles.calItem}>
              <View style={styles.calDateBox}>
                <Text style={styles.calDateTop}>{fmtDayShort(sub === 'earnings' ? it.earnings_date_epoch : it.ex_dividend_epoch)}</Text>
                <Text style={styles.calDateBadge}>{daysUntilLabel(sub === 'earnings' ? it.earnings_date_epoch : it.ex_dividend_epoch)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.calSym}>{it.symbol.replace('.NS', '')}</Text>
                <Text style={styles.calName} numberOfLines={1}>{it.name}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.calMeta}>{fmtMarketCap(it.market_cap, it.currency)}</Text>
                {sub === 'earnings' && it.last_surprise_pct != null ? (
                  <Text style={[styles.calSub, { color: it.last_surprise_pct >= 0 ? theme.colors.success : theme.colors.error }]}>
                    Last {it.last_surprise_pct >= 0 ? 'beat' : 'miss'} {Math.abs(it.last_surprise_pct).toFixed(1)}%
                  </Text>
                ) : null}
                {sub === 'dividends' && it.dividend_yield != null ? (
                  <Text style={[styles.calSub, { color: theme.colors.success }]}>Yield {it.dividend_yield.toFixed(2)}%</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction}><Text style={styles.sectionAction}>{actionLabel} ›</Text></TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  scroll: { flex: 1 },
  indicesScroll: { flexGrow: 0, height: 116 },
  indicesRow: { paddingHorizontal: theme.spacing.lg, gap: 10, paddingVertical: theme.spacing.sm, alignItems: 'center' },
  indexCard: { width: 150, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  indexName: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  indexValue: { color: theme.colors.text, fontSize: 20, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  indexChangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  indexChange: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  breadthCard: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md },
  breadthHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  breadthTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  breadthPctText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  breadthBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.colors.bg3 },
  breadthFill: { height: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  sectionAction: { color: theme.colors.radar, fontSize: 12, fontWeight: '700' },
  rotationRow: { flexDirection: 'row', gap: 10, paddingHorizontal: theme.spacing.lg },
  rotationCol: { flex: 1, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md, gap: 6 },
  rotationLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 2 },
  rotationItem: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  calItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md },
  calDateBox: { width: 64, alignItems: 'center' },
  calDateTop: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  calDateBadge: { color: theme.colors.radar, fontSize: 10, fontWeight: '700', marginTop: 2 },
  calSym: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  calName: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  calMeta: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  calSub: { fontSize: 11, fontWeight: '600', marginTop: 2 },
});
