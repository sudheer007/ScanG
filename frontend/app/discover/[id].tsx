import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, Market } from '@/src/api';
import { theme, fmtPct, fmtPrice, fmtMarketCap, changeColor } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import { LoadingState, ErrorState, EmptyState } from '@/src/components/States';
import SegmentedTabs from '@/src/components/widgets/SegmentedTabs';
import DataTable, { Column } from '@/src/components/widgets/DataTable';
import RatingBar from '@/src/components/widgets/RatingBar';
import ScoreBar from '@/src/components/widgets/ScoreBar';
import ChipRow from '@/src/components/ChipRow';

const TITLES: Record<string, { title: string; subtitle: string; icon: any; accent: string }> = {
  'ai-picks':         { title: 'AI Stock Recommendations', subtitle: 'Multi-factor scoring across momentum, value, quality, growth & technicals', icon: 'sparkles', accent: '#A78BFA' },
  'events':           { title: 'Market-Moving Events',     subtitle: 'Breakouts, sell-offs, surges, RSI extremes & golden crosses', icon: 'flash', accent: '#F59E0B' },
  'analyst-ratings':  { title: 'Hot Analyst Ratings',      subtitle: 'Consensus ratings, upgrades, downgrades & price targets', icon: 'people', accent: '#60A5FA' },
  'popular-screeners':{ title: 'Popular Screeners',        subtitle: 'Strategies ranked by live match count', icon: 'filter', accent: '#34D399' },
  'valuation':        { title: 'Undervalued vs Overvalued',subtitle: 'Relative to sector average P/E with quality filter', icon: 'git-compare', accent: '#22D3EE' },
  'investor-picks':   { title: 'Top Investor Picks',       subtitle: 'Buffett · Lynch · Graham · Growth · Dividend portfolios', icon: 'trophy', accent: '#F472B6' },
  'most-active':      { title: 'Most Active',              subtitle: 'Highest volume vs 20-day average', icon: 'pulse', accent: '#FB7185' },
  'winners-losers':   { title: 'Daily Winners & Losers',   subtitle: 'Top gainers and biggest decliners', icon: 'podium', accent: '#84CC16' },
};

export default function DiscoverDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id || '');
  const meta = TITLES[id] || { title: 'Widget', subtitle: '', icon: 'sparkles', accent: theme.colors.text };

  const [market, setMarket] = useState<Market>('US');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('');

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  const load = useCallback(async (m: Market) => {
    try {
      setError(null);
      let res: any;
      switch (id) {
        case 'ai-picks':          res = await api.discoverAiPicks(m); setTab((t) => t || 'buy'); break;
        case 'events':            res = await api.discoverEvents(m); setTab((t) => t || 'all'); break;
        case 'analyst-ratings':   res = await api.discoverAnalystRatings(m); setTab((t) => t || 'upgrades'); break;
        case 'popular-screeners': res = await api.discoverPopularScreeners(m); break;
        case 'valuation':         res = await api.discoverValuation(m); setTab((t) => t || 'undervalued'); break;
        case 'investor-picks':    res = await api.discoverInvestorPicks(m); setTab((t) => t || 'buffett'); break;
        case 'most-active':       res = await api.discoverMostActive(m); break;
        case 'winners-losers':    res = await api.discoverWinnersLosers(m); setTab((t) => t || 'gainers'); break;
        default: res = null;
      }
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(market); }, [market, load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(market); }, [market, load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={`discover-detail-${id}`}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <View style={[styles.iconWrap, { backgroundColor: meta.accent + '22' }]}>
              <Ionicons name={meta.icon} size={16} color={meta.accent} />
            </View>
            <Text style={styles.title} numberOfLines={1}>{meta.title}</Text>
          </View>
          <Text style={styles.subtitle} numberOfLines={2}>{meta.subtitle}</Text>
        </View>
      </View>

      <ChipRow
        testID="market-toggle"
        options={[
          { value: 'US', label: '🇺🇸 US', testID: 'market-US' },
          { value: 'IN', label: '🇮🇳 IN', testID: 'market-IN' },
        ]}
        value={market}
        onChange={(v) => { setMarket(v as Market); setLoading(true); }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />}
      >
        {loading ? (
          <LoadingState label="Crunching market data…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); load(market); }} />
        ) : (
          <DetailBody id={id} data={data} tab={tab} setTab={setTab} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------- Body switcher -----------------------------
function DetailBody({ id, data, tab, setTab }: { id: string; data: any; tab: string; setTab: (v: string) => void }) {
  if (!data) return <EmptyState title="No data" />;

  if (id === 'ai-picks') return <AIPicksBody data={data} tab={tab} setTab={setTab} />;
  if (id === 'events') return <EventsBody data={data} tab={tab} setTab={setTab} />;
  if (id === 'analyst-ratings') return <AnalystBody data={data} tab={tab} setTab={setTab} />;
  if (id === 'popular-screeners') return <PopularScreenersBody data={data} />;
  if (id === 'valuation') return <ValuationBody data={data} tab={tab} setTab={setTab} />;
  if (id === 'investor-picks') return <InvestorBody data={data} tab={tab} setTab={setTab} />;
  if (id === 'most-active') return <MostActiveBody data={data} />;
  if (id === 'winners-losers') return <WinnersLosersBody data={data} tab={tab} setTab={setTab} />;
  return <EmptyState title="Unknown widget" subtitle={id} />;
}

// ----------------------------- 1. AI Picks -----------------------------
function AIPicksBody({ data, tab, setTab }: any) {
  const lists: Record<string, any[]> = { buy: data.buy || [], hold: data.hold || [], sell: data.sell || [] };
  const list = lists[tab] || [];
  return (
    <View>
      <StatStrip stats={[
        { label: 'Universe', value: `${data.universe_size}` },
        { label: 'Buy', value: `${data.buy?.length || 0}`, tone: 'pos' },
        { label: 'Hold', value: `${data.hold?.length || 0}`, tone: 'neutral' },
        { label: 'Sell', value: `${data.sell?.length || 0}`, tone: 'neg' },
      ]} />
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'buy', label: 'Buy', count: data.buy?.length },
          { value: 'hold', label: 'Hold', count: data.hold?.length },
          { value: 'sell', label: 'Sell', count: data.sell?.length },
        ]}
      />
      {/* Top pick spotlight */}
      {tab === 'buy' && list[0] ? <SpotlightAI stock={list[0]} /> : null}
      <DataTable
        linkToStockField="symbol"
        columns={[
          { key: 'symbol', label: 'Symbol', width: 90, render: (r) => <SymCell symbol={r.symbol} name={r.name} /> },
          { key: 'ai_score', label: 'Score', width: 60, align: 'right', mono: true,
            render: (r) => <Text style={{ color: r.ai_score >= 62 ? theme.colors.success : r.ai_score >= 48 ? theme.colors.warning : theme.colors.error, fontWeight: '800', textAlign: 'right' }}>{r.ai_score}</Text>,
          },
          { key: 'ai_rating', label: 'Rating', width: 90, render: (r) => <RatingPill r={r.ai_rating} /> },
          { key: 'price', label: 'Price', width: 80, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtPrice(r.price, r.currency)}</Text> },
          { key: 'change_pct', label: '%', width: 70, align: 'right', mono: true,
            render: (r) => <Text style={[cellText('right'), { color: changeColor(r.change_pct), fontWeight: '700' }]}>{fmtPct(r.change_pct)}</Text> },
          { key: 'pe', label: 'P/E', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.pe ? r.pe.toFixed(1) : '—'}</Text> },
          { key: 'roe', label: 'ROE', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.roe ? `${r.roe.toFixed(0)}%` : '—'}</Text> },
        ]}
        rows={list}
        rowKey={(r) => r.symbol}
      />
    </View>
  );
}

function SpotlightAI({ stock }: { stock: any }) {
  const b = stock.ai_breakdown || {};
  return (
    <View style={styles.spotlight}>
      <View style={styles.spotHead}>
        <View>
          <Text style={styles.spotSym}>{stock.symbol.replace('.NS', '')}</Text>
          <Text style={styles.spotName} numberOfLines={1}>{stock.name}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.spotPrice}>{fmtPrice(stock.price, stock.currency)}</Text>
          <Text style={[styles.spotChg, { color: changeColor(stock.change_pct) }]}>{fmtPct(stock.change_pct)}</Text>
        </View>
      </View>
      <View style={styles.spotBadgeRow}>
        <View style={[styles.bigBadge, { backgroundColor: 'rgba(167,139,250,0.18)' }]}>
          <Text style={[styles.bigBadgeText, { color: '#A78BFA' }]}>AI {stock.ai_score}</Text>
        </View>
        {(stock.ai_reasons || []).slice(0, 3).map((r: string) => (
          <View key={r} style={styles.reasonChip}><Text style={styles.reasonText}>{r}</Text></View>
        ))}
      </View>
      <View style={{ marginTop: 10 }}>
        <ScoreBar label="Momentum" value={b.momentum || 0} />
        <ScoreBar label="Value" value={b.value || 0} />
        <ScoreBar label="Quality" value={b.quality || 0} />
        <ScoreBar label="Growth" value={b.growth || 0} />
        <ScoreBar label="Technical" value={b.technical || 0} />
      </View>
    </View>
  );
}

// ----------------------------- 2. Events -----------------------------
function EventsBody({ data, tab, setTab }: any) {
  const byType: Record<string, any[]> = data.by_type || {};
  const types = Object.keys(byType);
  const list = tab === 'all' ? (data.events || []) : (byType[tab] || []);
  return (
    <View>
      <StatStrip stats={[
        { label: 'Total', value: `${data.total}` },
        { label: 'Categories', value: `${types.length}` },
      ]} />
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: 'All', count: data.total },
          ...types.map((t) => ({ value: t, label: titleCase(t.replace('_', ' ')), count: byType[t].length })),
        ]}
      />
      <View style={styles.eventList}>
        {list.map((ev: any, i: number) => <EventCard key={`${ev.symbol}-${ev.type}-${i}`} ev={ev} />)}
      </View>
    </View>
  );
}

function EventCard({ ev }: { ev: any }) {
  const router = useRouter();
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push({ pathname: '/stock/[symbol]', params: { symbol: ev.symbol } })} style={styles.eventCard}>
      <View style={[styles.eventIcon, { backgroundColor: ev.tone === 'pos' ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)' }]}>
        <Ionicons name={(ev.icon || 'flash') as any} size={16} color={ev.tone === 'pos' ? theme.colors.success : theme.colors.error} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.eventTopRow}>
          <Text style={styles.eventTitle}>{ev.title}</Text>
          <Text style={[styles.eventPct, { color: changeColor(ev.change_pct) }]}>{fmtPct(ev.change_pct)}</Text>
        </View>
        <Text style={styles.eventStock}>{ev.symbol.replace('.NS', '')} · {ev.name}</Text>
        <Text style={styles.eventDetail}>{ev.detail}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ----------------------------- 3. Analyst Ratings -----------------------------
function AnalystBody({ data, tab, setTab }: any) {
  const router = useRouter();
  const lists: Record<string, any[]> = { upgrades: data.upgrades || [], downgrades: data.downgrades || [], all: data.all || [] };
  const list = lists[tab] || [];
  return (
    <View>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upgrades', label: 'Upgrades', count: data.upgrades?.length },
          { value: 'downgrades', label: 'Downgrades', count: data.downgrades?.length },
          { value: 'all', label: 'All', count: data.all?.length },
        ]}
      />
      <View style={{ paddingHorizontal: 16 }}>
        {list.map((s: any) => (
          <View key={s.symbol} style={styles.analystCard}>
            <View style={styles.analystTopRow}>
              <TouchableOpacity onPress={() => router.push({ pathname: '/stock/[symbol]', params: { symbol: s.symbol } })}>
                <Text style={styles.analystSym}>{s.symbol.replace('.NS', '')}</Text>
                <Text style={styles.analystName} numberOfLines={1}>{s.name}</Text>
              </TouchableOpacity>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.analystPrice}>{fmtPrice(s.price, s.currency)}</Text>
                <Text style={[styles.analystTarget, { color: theme.colors.success }]}>
                  Target {fmtPrice(s.price_target, s.currency)} ({s.target_upside_pct >= 0 ? '+' : ''}{s.target_upside_pct?.toFixed(1)}%)
                </Text>
              </View>
            </View>
            <View style={styles.analystMetaRow}>
              <View style={styles.consensusBigBadge}>
                <Text style={styles.consensusBigText}>{s.consensus.replace('_', ' ')}</Text>
              </View>
              <Text style={styles.analystCount}>{s.analyst_count} analysts</Text>
              <Text style={[styles.analystChg, { color: changeColor(s.change_pct) }]}>{fmtPct(s.change_pct)}</Text>
            </View>
            <RatingBar
              strongBuy={s.ratings.strong_buy}
              buy={s.ratings.buy}
              hold={s.ratings.hold}
              sell={s.ratings.sell}
              height={10}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ----------------------------- 4. Popular Screeners -----------------------------
function PopularScreenersBody({ data }: any) {
  const router = useRouter();
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Text style={styles.helperText}>Strategies ranked by today&apos;s live match count across {data.market} universe.</Text>
      {(data.screeners || []).map((s: any) => (
        <View key={s.key} style={styles.screenerCard}>
          <View style={styles.screenerHead}>
            <View style={[styles.screenerCardIcon, { backgroundColor: 'rgba(52,211,153,0.18)' }]}>
              <Ionicons name={(s.icon || 'options') as any} size={18} color="#34D399" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.screenerCardTitle}>{s.title}</Text>
              <Text style={styles.screenerCardSub}>{s.subtitle}</Text>
            </View>
            <View style={styles.screenerCountBox}>
              <Text style={styles.screenerCountVal}>{s.count}</Text>
              <Text style={styles.screenerCountLbl}>matches</Text>
            </View>
          </View>
          {s.top?.length ? (
            <View style={styles.screenerTopRow}>
              {s.top.slice(0, 3).map((st: any) => (
                <TouchableOpacity key={st.symbol} onPress={() => router.push({ pathname: '/stock/[symbol]', params: { symbol: st.symbol } })} style={styles.screenerChip}>
                  <Text style={styles.screenerChipSym}>{st.symbol.replace('.NS', '')}</Text>
                  <Text style={[styles.screenerChipChg, { color: changeColor(st.change_pct) }]}>{fmtPct(st.change_pct)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ----------------------------- 5. Valuation -----------------------------
function ValuationBody({ data, tab, setTab }: any) {
  const lists: Record<string, any[]> = { undervalued: data.undervalued || [], overvalued: data.overvalued || [] };
  const list = lists[tab] || [];
  return (
    <View>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'undervalued', label: 'Undervalued', count: data.undervalued?.length },
          { value: 'overvalued', label: 'Overvalued', count: data.overvalued?.length },
        ]}
      />
      <DataTable
        linkToStockField="symbol"
        columns={[
          { key: 'symbol', label: 'Symbol', width: 100, render: (r) => <SymCell symbol={r.symbol} name={r.name} /> },
          { key: 'pe', label: 'P/E', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.pe?.toFixed(1) || '—'}</Text> },
          { key: 'sector_avg_pe', label: 'Sec.PE', width: 70, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.sector_avg_pe || '—'}</Text> },
          { key: 'relative_pe', label: 'Rel.PE', width: 70, align: 'right', mono: true,
            render: (r) => {
              if (r.relative_pe == null) return <Text style={cellText('right')}>—</Text>;
              const tone = r.relative_pe < 1 ? 'pos' : 'neg';
              return <Text style={[cellText('right'), { color: tone === 'pos' ? theme.colors.success : theme.colors.error, fontWeight: '700' }]}>{r.relative_pe.toFixed(2)}×</Text>;
            } },
          { key: 'pb', label: 'P/B', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.pb?.toFixed(2) || '—'}</Text> },
          { key: 'roe', label: 'ROE', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.roe ? `${r.roe.toFixed(0)}%` : '—'}</Text> },
          { key: 'valuation_score', label: 'Score', width: 60, align: 'right', mono: true,
            render: (r) => <Text style={[cellText('right'), { fontWeight: '800', color: tab === 'undervalued' ? theme.colors.success : theme.colors.error }]}>{r.valuation_score}</Text> },
        ]}
        rows={list}
        rowKey={(r) => r.symbol}
      />
    </View>
  );
}

// ----------------------------- 6. Investor Picks -----------------------------
function InvestorBody({ data, tab, setTab }: any) {
  const portfolios = data.portfolios || {};
  const keys = Object.keys(portfolios);
  const active = portfolios[tab] || portfolios[keys[0]] || {};
  return (
    <View>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={keys.map((k) => ({ value: k, label: portfolios[k].name.split('-')[0].trim().split(' ')[0], count: portfolios[k].count }))}
      />
      <View style={styles.styleHeader}>
        <View style={[styles.styleIcon, { backgroundColor: 'rgba(244,114,182,0.18)' }]}>
          <Ionicons name={(active.icon || 'star') as any} size={18} color="#F472B6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.styleName}>{active.name}</Text>
          <Text style={styles.styleSub}>{active.subtitle}</Text>
          <Text style={styles.styleCriteria}>Criteria: {active.criteria}</Text>
        </View>
      </View>
      <DataTable
        linkToStockField="symbol"
        columns={[
          { key: 'symbol', label: 'Symbol', width: 100, render: (r) => <SymCell symbol={r.symbol} name={r.name} /> },
          { key: 'style_score', label: 'Fit', width: 60, align: 'right', mono: true, render: (r) => <Text style={[cellText('right'), { color: '#F472B6', fontWeight: '800' }]}>{r.style_score}</Text> },
          { key: 'price', label: 'Price', width: 80, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtPrice(r.price, r.currency)}</Text> },
          { key: 'change_pct', label: '%', width: 70, align: 'right', mono: true, render: (r) => <Text style={[cellText('right'), { color: changeColor(r.change_pct), fontWeight: '700' }]}>{fmtPct(r.change_pct)}</Text> },
          { key: 'pe', label: 'P/E', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.pe?.toFixed(1) || '—'}</Text> },
          { key: 'roe', label: 'ROE', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.roe ? `${r.roe.toFixed(0)}%` : '—'}</Text> },
          { key: 'eps_growth', label: 'EPS↑', width: 70, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.eps_growth ? `${r.eps_growth.toFixed(0)}%` : '—'}</Text> },
          { key: 'market_cap', label: 'Mkt Cap', width: 90, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtMarketCap(r.market_cap, r.currency)}</Text> },
        ]}
        rows={active.stocks || []}
        rowKey={(r) => r.symbol}
      />
    </View>
  );
}

// ----------------------------- 7. Most Active -----------------------------
function MostActiveBody({ data }: any) {
  return (
    <DataTable
      linkToStockField="symbol"
      columns={[
        { key: 'symbol', label: 'Symbol', width: 110, render: (r) => <SymCell symbol={r.symbol} name={r.name} /> },
        { key: 'volume_surge', label: 'Vol ×', width: 70, align: 'right', mono: true, render: (r) => <Text style={[cellText('right'), { fontWeight: '800', color: '#FB7185' }]}>{r.volume_surge ? `${r.volume_surge.toFixed(1)}×` : '—'}</Text> },
        { key: 'price', label: 'Price', width: 80, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtPrice(r.price, r.currency)}</Text> },
        { key: 'change_pct', label: '%', width: 70, align: 'right', mono: true, render: (r) => <Text style={[cellText('right'), { color: changeColor(r.change_pct), fontWeight: '700' }]}>{fmtPct(r.change_pct)}</Text> },
        { key: 'rsi', label: 'RSI', width: 50, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.rsi?.toFixed(0) || '—'}</Text> },
        { key: 'sector', label: 'Sector', width: 130, render: (r) => <Text style={[cellText('left'), { color: theme.colors.textMuted, fontSize: 11 }]} numberOfLines={1}>{r.sector || '—'}</Text> },
        { key: 'market_cap', label: 'Mkt Cap', width: 90, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtMarketCap(r.market_cap, r.currency)}</Text> },
      ]}
      rows={data.stocks || []}
      rowKey={(r) => r.symbol}
    />
  );
}

// ----------------------------- 8. Winners & Losers -----------------------------
function WinnersLosersBody({ data, tab, setTab }: any) {
  const list = tab === 'losers' ? (data.losers || []) : (data.gainers || []);
  return (
    <View>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'gainers', label: 'Gainers', count: data.gainers?.length },
          { value: 'losers', label: 'Losers', count: data.losers?.length },
        ]}
      />
      <DataTable
        linkToStockField="symbol"
        columns={[
          { key: 'rank', label: '#', width: 36, align: 'right', render: (r) => {
              const idx = list.indexOf(r) + 1;
              return <Text style={[cellText('right'), { color: theme.colors.textSubtle, fontWeight: '800' }]}>{idx}</Text>;
            } },
          { key: 'symbol', label: 'Symbol', width: 100, render: (r) => <SymCell symbol={r.symbol} name={r.name} /> },
          { key: 'price', label: 'Price', width: 80, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{fmtPrice(r.price, r.currency)}</Text> },
          { key: 'change_pct', label: '%', width: 80, align: 'right', mono: true,
            render: (r) => <Text style={[cellText('right'), { color: changeColor(r.change_pct), fontWeight: '800' }]}>{fmtPct(r.change_pct)}</Text> },
          { key: 'volume_surge', label: 'Vol×', width: 60, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.volume_surge ? `${r.volume_surge.toFixed(1)}×` : '—'}</Text> },
          { key: 'rsi', label: 'RSI', width: 50, align: 'right', mono: true, render: (r) => <Text style={cellText('right')}>{r.rsi?.toFixed(0) || '—'}</Text> },
          { key: 'sector', label: 'Sector', width: 130, render: (r) => <Text style={[cellText('left'), { color: theme.colors.textMuted, fontSize: 11 }]} numberOfLines={1}>{r.sector || '—'}</Text> },
        ]}
        rows={list}
        rowKey={(r) => r.symbol}
      />
    </View>
  );
}

// ----------------------------- Shared bits -----------------------------
function SymCell({ symbol, name }: { symbol: string; name?: string }) {
  return (
    <View>
      <Text style={[styles.symCellSym]} numberOfLines={1}>{symbol.replace('.NS', '')}</Text>
      <Text style={styles.symCellName} numberOfLines={1}>{name || ''}</Text>
    </View>
  );
}

function RatingPill({ r }: { r: string }) {
  const color =
    r === 'STRONG_BUY' ? theme.colors.success :
    r === 'BUY' ? '#34D399' :
    r === 'HOLD' ? theme.colors.warning :
    theme.colors.error;
  return (
    <View style={[styles.ratingPill, { backgroundColor: color + '22' }]}>
      <Text style={[styles.ratingPillText, { color }]}>{r.replace('_', ' ')}</Text>
    </View>
  );
}

function StatStrip({ stats }: { stats: { label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }[] }) {
  return (
    <View style={styles.statStrip}>
      {stats.map((s, i) => (
        <View key={i} style={styles.statBlock}>
          <Text style={styles.statLabel}>{s.label}</Text>
          <Text style={[styles.statVal,
            s.tone === 'pos' && { color: theme.colors.success },
            s.tone === 'neg' && { color: theme.colors.error },
          ]}>{s.value}</Text>
        </View>
      ))}
    </View>
  );
}

function cellText(align: 'left' | 'right' | 'center' = 'left'): any {
  return { color: theme.colors.text, fontSize: 12, fontVariant: ['tabular-nums'], textAlign: align };
}

function titleCase(s: string) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

// ----------------------------- Styles -----------------------------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    gap: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: theme.colors.bg2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
    marginTop: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  helperText: { color: theme.colors.textMuted, fontSize: 12, marginVertical: 10 },
  statStrip: {
    flexDirection: 'row',
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingVertical: 10,
    marginBottom: 8,
  },
  statBlock: { flex: 1, alignItems: 'center' },
  statLabel: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  statVal: { color: theme.colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },

  spotlight: {
    margin: theme.spacing.lg,
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: '#A78BFA55',
    padding: 14,
  },
  spotHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  spotSym: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  spotName: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  spotPrice: { color: theme.colors.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spotChg: { fontSize: 13, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  spotBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  bigBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  bigBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  reasonChip: { backgroundColor: theme.colors.bg3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  reasonText: { color: theme.colors.text, fontSize: 10, fontWeight: '600' },

  // events
  eventList: { paddingHorizontal: theme.spacing.lg, gap: 8, paddingTop: 6 },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bg2,
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: 10,
  },
  eventIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  eventTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  eventPct: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  eventStock: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  eventDetail: { color: theme.colors.text, fontSize: 12, marginTop: 4 },

  // analyst
  analystCard: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: 14,
    marginVertical: 6,
  },
  analystTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  analystSym: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  analystName: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  analystPrice: { color: theme.colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  analystTarget: { fontSize: 11, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  analystMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 10 },
  consensusBigBadge: { backgroundColor: 'rgba(96,165,250,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  consensusBigText: { color: '#60A5FA', fontSize: 11, fontWeight: '800' },
  analystCount: { color: theme.colors.textMuted, fontSize: 11, flex: 1 },
  analystChg: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // popular screeners
  screenerCard: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: 14,
    marginVertical: 6,
  },
  screenerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  screenerCardIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  screenerCardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  screenerCardSub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  screenerCountBox: { alignItems: 'flex-end' },
  screenerCountVal: { color: '#34D399', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  screenerCountLbl: { color: theme.colors.textSubtle, fontSize: 9, letterSpacing: 0.5, fontWeight: '700' },
  screenerTopRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  screenerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.bg3,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  screenerChipSym: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  screenerChipChg: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // investor styles
  styleHeader: {
    flexDirection: 'row',
    margin: theme.spacing.lg,
    padding: 14,
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: 12,
  },
  styleIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  styleName: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  styleSub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  styleCriteria: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 6, fontStyle: 'italic' },

  // table cell helpers
  symCellSym: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  symCellName: { color: theme.colors.textMuted, fontSize: 10, marginTop: 1 },
  ratingPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' },
  ratingPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
