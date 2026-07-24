import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/src/api';
import type { AnalyzerResult, AnalyzerPeer } from '@/src/types/analyzer';
import { theme, fmtPrice, fmtPct, fmtMarketCap, changeColor, fmtNum } from '@/src/theme';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';
import { LoadingState, ErrorState } from '@/src/components/States';
import ScoreBar from '@/src/components/widgets/ScoreBar';
import RatingBar from '@/src/components/widgets/RatingBar';
import SortableDataTable, { SortableColumn } from '@/src/components/widgets/SortableDataTable';

export default function AnalyzerScreen() {
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol || '');
  const [data, setData] = useState<AnalyzerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (sym) {
      router.replace({ pathname: '/stock/[symbol]', params: { symbol: sym } });
      return;
    }
    router.replace('/(tabs)' as Href);
  }, [router, sym]);

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      const r = await api.analyzer(sym, force);
      if (r?.error) { setError('No analyzer data available for ' + sym); setData(null); }
      else setData(r);
    } catch (e: any) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [sym]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  if (loading) return (
    <SafeAreaView style={styles.safe} edges={['top']}><Header onBack={goBack} title="AI Analyzer" subtitle={sym} /><LoadingState label="Running deep analysis…" /></SafeAreaView>
  );
  if (error || !data) return (
    <SafeAreaView style={styles.safe} edges={['top']}><Header onBack={goBack} title="AI Analyzer" subtitle={sym} /><ErrorState message={error || 'No data'} onRetry={() => { setLoading(true); load(); }} /></SafeAreaView>
  );

  const v = data.verdict || {};
  const sc = data.scores || {};
  const ra = data.real_analyst || {};
  const fc = data.forecasts || {};
  const val = data.valuation || {};
  const fin = data.financials || {};
  const tech = data.technicals || {};
  const risk = data.risk || {};
  const cat = data.catalysts || {};
  const own = data.ownership || {};
  const sec = data.sector_context;
  const peers = data.peers || [];
  const newsSent = data.news_sentiment;
  const ccy = data.currency || 'USD';

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={`analyzer-${sym}`}>
      <Header
        onBack={goBack}
        title="AI Analyzer"
        subtitle={`${sym.replace('.NS', '')} · ${data.name || ''}`}
      />
      <AppScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
      >
        {/* VERDICT HERO */}
        <View style={[styles.heroCard, verdictBorderColor(v.rating)]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.priceBig}>{fmtPrice(data.price, ccy)}</Text>
              <Text style={[styles.chgBig, { color: changeColor(data.change_pct) }]}>{fmtPct(data.change_pct)}</Text>
              <Text style={styles.sector}>{data.sector || ''}{data.industry ? ` · ${data.industry}` : ''}</Text>
            </View>
            <View style={styles.scoreCircle}>
              <Text style={styles.scoreNum}>{(v.score || 0).toFixed(0)}</Text>
              <Text style={styles.scoreOf}>/100</Text>
            </View>
          </View>
          <View style={[styles.ratingBigPill, verdictBgColor(v.rating)]}>
            <Ionicons name="sparkles" size={14} color={verdictTextColor(v.rating)} />
            <Text style={[styles.ratingBigText, { color: verdictTextColor(v.rating) }]}>{(v.rating || '').replace('_', ' ')}</Text>
            <Text style={styles.confText}>· {v.confidence} confidence</Text>
          </View>
          <Text style={styles.summary}>{v.summary}</Text>
        </View>

        {/* FACTOR SCORES */}
        <Section title="Factor Breakdown" subtitle="How the AI score is composed">
          <View style={styles.card}>
            <ScoreBar label="Momentum" value={sc.momentum || 0} />
            <ScoreBar label="Value" value={sc.value || 0} />
            <ScoreBar label="Quality" value={sc.quality || 0} />
            <ScoreBar label="Growth" value={sc.growth || 0} />
            <ScoreBar label="Technical" value={sc.technical || 0} />
          </View>
        </Section>

        {/* SECTOR CONTEXT */}
        {sec ? (
          <Section title="Sector Context" subtitle={`${sec.sector} · ${sec.stock_count || 0} stocks`}>
            <View style={styles.card}>
              <View style={styles.row3}>
                <Stat label="Sector Avg P/E" value={fmtNum(sec.avg_pe)} />
                <Stat
                  label="Your P/E"
                  value={fmtNum(val.pe)}
                  tone={sec.vs_sector_pe_pct != null && sec.vs_sector_pe_pct <= -10 ? 'pos' : sec.vs_sector_pe_pct != null && sec.vs_sector_pe_pct >= 15 ? 'neg' : undefined}
                />
                <Stat
                  label="vs Sector"
                  value={sec.vs_sector_pe_pct != null ? `${sec.vs_sector_pe_pct > 0 ? '+' : ''}${sec.vs_sector_pe_pct.toFixed(0)}%` : '—'}
                  tone={sec.vs_sector_pe_pct != null && sec.vs_sector_pe_pct <= -10 ? 'pos' : sec.vs_sector_pe_pct != null && sec.vs_sector_pe_pct >= 15 ? 'neg' : undefined}
                />
              </View>
              <View style={[styles.row3, { marginTop: 8 }]}>
                <Stat label="Sector Avg ROE" value={sec.avg_roe != null ? `${sec.avg_roe.toFixed(1)}%` : '—'} />
                <Stat label="AI Score Rank" value={sec.ai_score_rank && sec.sector_total ? `#${sec.ai_score_rank}/${sec.sector_total}` : '—'} />
                <Stat label="Percentile" value={sec.ai_score_percentile != null ? `Top ${100 - sec.ai_score_percentile}%` : '—'} />
              </View>
              {sec.valuation_tag ? (
                <View style={[styles.valTagPill, valuationTagStyle(sec.valuation_tag)]}>
                  <Text style={[styles.valTagText, valuationTagTextStyle(sec.valuation_tag)]}>{sec.valuation_tag}</Text>
                </View>
              ) : null}
            </View>
          </Section>
        ) : null}

        {/* PEER COMPARISON */}
        {peers.length > 0 ? (
          <Section title="Peer Comparison" subtitle="Similar market-cap peers in same sector">
            <View style={styles.card}>
              <PeerComparisonTable
                peers={peers}
                onPeerPress={(symbol: string) => router.push({ pathname: '/analyzer/[symbol]', params: { symbol } })}
              />
            </View>
          </Section>
        ) : null}

        {/* NEWS SENTIMENT */}
        {newsSent && newsSent.headlines?.length > 0 ? (
          <Section title="News Sentiment" subtitle="Rule-based tone from recent headlines">
            <View style={styles.card}>
              <View style={styles.newsHeader}>
                <View style={[styles.sentimentPill, sentimentPillStyle(newsSent.label)]}>
                  <Text style={[styles.sentimentText, sentimentTextStyle(newsSent.label)]}>{newsSent.label}</Text>
                </View>
                <Text style={styles.sentimentScore}>Score {newsSent.score > 0 ? '+' : ''}{newsSent.score}</Text>
              </View>
              {newsSent.headlines.map((h, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.newsRow}
                  onPress={() => h.link && Linking.openURL(h.link)}
                  disabled={!h.link}
                >
                  <View style={[styles.sentimentDot, { backgroundColor: sentimentDotColor(h.sentiment) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.newsTitle} numberOfLines={2}>{h.title}</Text>
                    {h.publisher ? <Text style={styles.newsPub}>{h.publisher}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </Section>
        ) : null}

        {/* WALL STREET CONSENSUS */}
        <Section title="Wall Street Consensus" subtitle="Real analyst data from Yahoo Finance">
          <View style={styles.card}>
            <View style={styles.row3}>
              <Stat label="Analysts" value={ra.analyst_count != null ? String(ra.analyst_count) : '—'} />
              <Stat label="Consensus" value={(ra.consensus_key || '—').toUpperCase().replace('_', ' ')} />
              <Stat label="Upside" value={ra.upside_pct != null ? `${ra.upside_pct > 0 ? '+' : ''}${ra.upside_pct.toFixed(1)}%` : '—'} tone={ra.upside_pct >= 0 ? 'pos' : 'neg'} />
            </View>
            <View style={[styles.targetBox, { marginTop: 12 }]}>
              <View style={styles.targetCol}>
                <Text style={styles.targetLbl}>LOW</Text>
                <Text style={styles.targetVal}>{fmtPrice(ra.target_low, ccy)}</Text>
              </View>
              <View style={[styles.targetCol, styles.targetMid]}>
                <Text style={styles.targetLbl}>MEAN</Text>
                <Text style={[styles.targetVal, { fontSize: 16, color: theme.colors.success }]}>{fmtPrice(ra.target_mean, ccy)}</Text>
                {ra.target_median != null ? (
                  <Text style={styles.targetMed}>Med {fmtPrice(ra.target_median, ccy)}</Text>
                ) : null}
              </View>
              <View style={styles.targetCol}>
                <Text style={styles.targetLbl}>HIGH</Text>
                <Text style={styles.targetVal}>{fmtPrice(ra.target_high, ccy)}</Text>
              </View>
            </View>
            {ra.distribution ? (
              <View style={{ marginTop: 14 }}>
                <RatingBar
                  strongBuy={ra.distribution.strong_buy || 0}
                  buy={ra.distribution.buy || 0}
                  hold={ra.distribution.hold || 0}
                  sell={ra.distribution.sell || 0}
                  height={12}
                />
                {ra.distribution.source ? (
                  <Text style={styles.sourceTag}>Source: {ra.distribution.source === 'yahoo' ? 'Yahoo Finance (real)' : 'AI model'}</Text>
                ) : null}
              </View>
            ) : null}
            {ra.latest_change ? (
              <View style={styles.changeBox}>
                <Ionicons name={ra.latest_change.action === 'up' ? 'trending-up' : ra.latest_change.action === 'down' ? 'trending-down' : 'people'} size={14} color={ra.latest_change.action === 'up' ? theme.colors.success : ra.latest_change.action === 'down' ? theme.colors.error : theme.colors.text} />
                <Text style={styles.changeText}>
                  <Text style={{ fontWeight: '800' }}>{ra.latest_change.firm || 'Analyst'}</Text>: {ra.latest_change.from_grade || '—'} → {ra.latest_change.to_grade || '—'}
                </Text>
              </View>
            ) : null}
          </View>
        </Section>

        {/* FORECAST HORIZONS */}
        <Section title="Forecast Horizons" subtitle="Expected return at 1M / 3M / 6M / 1Y">
          <View style={styles.forecastGrid}>
            {(['1M', '3M', '6M', '1Y'] as const).map((h) => {
              const f = fc[h];
              if (!f) return <View key={h} style={styles.forecastCell}><Text style={styles.forecastH}>{h}</Text><Text style={styles.forecastV}>—</Text></View>;
              const pos = f.expected_return_pct >= 0;
              return (
                <View key={h} style={styles.forecastCell}>
                  <Text style={styles.forecastH}>{h}</Text>
                  <Text style={[styles.forecastV, { color: pos ? theme.colors.success : theme.colors.error }]}>
                    {pos ? '+' : ''}{f.expected_return_pct?.toFixed(1)}%
                  </Text>
                  <Text style={styles.forecastT}>{fmtPrice(f.target_price, ccy)}</Text>
                  <Text style={styles.forecastSrc}>{f.source === 'analyst_consensus' ? 'REAL · Wall St.' : 'AI Model'}</Text>
                  <Text style={styles.forecastConf}>conf: {f.confidence}</Text>
                </View>
              );
            })}
          </View>
        </Section>

        {/* PROS / CONS */}
        <Section title="Pros & Cons" subtitle="Bullish vs bearish factors">
          <View style={styles.row2}>
            <View style={[styles.proConCol, { backgroundColor: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.4)' }]}>
              <Text style={[styles.proConHead, { color: theme.colors.success }]}>✓ PROS</Text>
              {(data.pros || []).map((p: string, i: number) => (
                <Text key={i} style={styles.proConItem}>• {p}</Text>
              ))}
            </View>
            <View style={[styles.proConCol, { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.4)' }]}>
              <Text style={[styles.proConHead, { color: theme.colors.error }]}>✗ CONS</Text>
              {(data.cons || []).map((c: string, i: number) => (
                <Text key={i} style={styles.proConItem}>• {c}</Text>
              ))}
            </View>
          </View>
        </Section>

        {/* TRADE IDEA */}
        {data.trade_idea ? (
          <Section title="Trade Idea" subtitle={data.trade_idea.stance}>
            <View style={[styles.card, { borderColor: 'rgba(96,165,250,0.4)' }]}>
              {data.trade_idea.entry_zone ? (
                <View style={styles.tradeRow}>
                  <Text style={styles.tradeLbl}>Entry Zone</Text>
                  <Text style={styles.tradeVal}>{fmtPrice(data.trade_idea.entry_zone[0], ccy)} – {fmtPrice(data.trade_idea.entry_zone[1], ccy)}</Text>
                </View>
              ) : null}
              {data.trade_idea.stop_loss != null ? (
                <View style={styles.tradeRow}>
                  <Text style={styles.tradeLbl}>Stop Loss</Text>
                  <Text style={[styles.tradeVal, { color: theme.colors.error }]}>{fmtPrice(data.trade_idea.stop_loss, ccy)}</Text>
                </View>
              ) : null}
              {data.trade_idea.targets?.map((t: number, i: number) => (
                <View key={i} style={styles.tradeRow}>
                  <Text style={styles.tradeLbl}>Target {i + 1}</Text>
                  <Text style={[styles.tradeVal, { color: theme.colors.success }]}>{fmtPrice(t, ccy)}</Text>
                </View>
              ))}
              <View style={styles.tradeRow}>
                <Text style={styles.tradeLbl}>Horizon</Text>
                <Text style={styles.tradeVal}>{data.trade_idea.horizon}</Text>
              </View>
              {data.trade_idea.risk_reward ? (
                <View style={styles.tradeRow}>
                  <Text style={styles.tradeLbl}>Risk/Reward</Text>
                  <Text style={styles.tradeVal}>{data.trade_idea.risk_reward}× R</Text>
                </View>
              ) : null}
              <Text style={styles.tradeHint}>{data.trade_idea.size_hint}</Text>
            </View>
          </Section>
        ) : null}

        {/* VALUATION */}
        <Section title="Valuation" subtitle={val.sector_avg_pe ? `Multiples vs sector avg P/E ${fmtNum(val.sector_avg_pe)}` : 'Vs. multiples'}>
          <View style={styles.row3}>
            <Stat
              label="P/E (TTM)"
              value={fmtNum(val.pe)}
              sub={val.vs_sector_pe_pct != null ? `${val.vs_sector_pe_pct > 0 ? '+' : ''}${val.vs_sector_pe_pct.toFixed(0)}% vs sector` : undefined}
            />
            <Stat label="Fwd P/E" value={fmtNum(val.forward_pe)} />
            <Stat label="P/B" value={fmtNum(val.pb)} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="P/S" value={fmtNum(val.ps)} />
            <Stat label="PEG" value={fmtNum(val.peg)} />
            <Stat label="Mkt Cap" value={fmtMarketCap(val.market_cap, ccy)} />
          </View>
        </Section>

        {/* FINANCIALS */}
        <Section title="Financials" subtitle="Income, cashflow & balance sheet">
          <View style={styles.row3}>
            <Stat label="Revenue" value={fmtMarketCap(fin.revenue, ccy)} />
            <Stat label="EBITDA" value={fmtMarketCap(fin.ebitda, ccy)} />
            <Stat label="Free CF" value={fmtMarketCap(fin.free_cashflow, ccy)} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="Gross Margin" value={fin.gross_margin != null ? `${(fin.gross_margin * 100).toFixed(1)}%` : '—'} />
            <Stat label="Op. Margin" value={fin.operating_margin != null ? `${(fin.operating_margin * 100).toFixed(1)}%` : '—'} />
            <Stat label="Net Margin" value={fin.profit_margin != null ? `${fin.profit_margin.toFixed(1)}%` : '—'} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="ROE" value={fin.roe != null ? `${fin.roe.toFixed(1)}%` : '—'} tone={(fin.roe || 0) >= 15 ? 'pos' : undefined} />
            <Stat label="ROA" value={fin.roa != null ? `${fin.roa.toFixed(1)}%` : '—'} />
            <Stat label="D/E" value={fmtNum(fin.debt_to_equity)} tone={(fin.debt_to_equity || 0) > 150 ? 'neg' : undefined} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="Total Cash" value={fmtMarketCap(fin.total_cash, ccy)} />
            <Stat label="Total Debt" value={fmtMarketCap(fin.total_debt, ccy)} />
            <Stat label="Current Ratio" value={fmtNum(fin.current_ratio)} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="EPS Growth" value={fin.eps_growth != null ? `${fin.eps_growth.toFixed(1)}%` : '—'} tone={(fin.eps_growth || 0) > 0 ? 'pos' : 'neg'} />
            <Stat label="Rev Growth" value={fin.revenue_growth != null ? `${fin.revenue_growth.toFixed(1)}%` : '—'} tone={(fin.revenue_growth || 0) > 0 ? 'pos' : 'neg'} />
            <Stat label="EPS Surprise" value={fin.latest_eps_surprise_pct != null ? `${fin.latest_eps_surprise_pct > 0 ? '+' : ''}${fin.latest_eps_surprise_pct.toFixed(1)}%` : '—'} tone={(fin.latest_eps_surprise_pct || 0) > 0 ? 'pos' : 'neg'} />
          </View>
        </Section>

        {/* TECHNICALS */}
        <Section title="Technicals" subtitle={`Trend: ${tech.trend || 'Neutral'}`}>
          <View style={styles.row3}>
            <Stat label="RSI (14)" value={fmtNum(tech.rsi)} tone={(tech.rsi || 50) > 70 ? 'neg' : (tech.rsi || 50) < 30 ? 'pos' : undefined} />
            <Stat label="MA 50" value={fmtPrice(tech.ma50, ccy)} />
            <Stat label="MA 200" value={fmtPrice(tech.ma200, ccy)} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="52w High" value={fmtPrice(tech.high_52w, ccy)} />
            <Stat label="52w Low" value={fmtPrice(tech.low_52w, ccy)} />
            <Stat label="From High" value={tech.from_52w_high_pct != null ? `${tech.from_52w_high_pct.toFixed(1)}%` : '—'} />
          </View>
          <View style={[styles.row3, { marginTop: 8 }]}>
            <Stat label="MACD" value={fmtNum(tech.macd, 3)} />
            <Stat label="Signal" value={fmtNum(tech.macd_signal, 3)} />
            <Stat label="Vol Surge" value={tech.volume_surge != null ? `${tech.volume_surge.toFixed(2)}×` : '—'} tone={(tech.volume_surge || 0) > 1.5 ? 'pos' : undefined} />
          </View>
        </Section>

        {/* RISK */}
        <Section title="Risk Profile" subtitle={`Volatility level: ${risk.level || 'Moderate'}`}>
          <View style={styles.row3}>
            <Stat label="Beta" value={fmtNum(risk.beta)} />
            <Stat label="D/E" value={fmtNum(risk.debt_to_equity)} />
            <Stat label="Drawdown" value={risk.drawdown_from_52w_high_pct != null ? `${risk.drawdown_from_52w_high_pct.toFixed(1)}%` : '—'} tone="neg" />
          </View>
        </Section>

        {/* CATALYSTS */}
        <Section title="Upcoming Catalysts">
          <View style={styles.card}>
            {cat.next_earnings_epoch ? (
              <CatalystRow icon="podium" label="Next Earnings" value={fmtDate(cat.next_earnings_epoch)} tone="neutral" />
            ) : null}
            {cat.ex_dividend_epoch ? (
              <CatalystRow icon="cash" label="Ex-Dividend Date" value={fmtDate(cat.ex_dividend_epoch)} tone="pos" />
            ) : null}
            {cat.dividend_date_epoch ? (
              <CatalystRow icon="wallet" label="Dividend Pay Date" value={fmtDate(cat.dividend_date_epoch)} tone="pos" />
            ) : null}
            {cat.latest_upgrade_downgrade ? (
              <CatalystRow
                icon={cat.latest_upgrade_downgrade.action === 'up' ? 'trending-up' : 'trending-down'}
                label={cat.latest_upgrade_downgrade.firm || 'Analyst'}
                value={`${cat.latest_upgrade_downgrade.from_grade || '—'} → ${cat.latest_upgrade_downgrade.to_grade || '—'}`}
                tone={cat.latest_upgrade_downgrade.action === 'up' ? 'pos' : 'neg'}
              />
            ) : null}
            {!cat.next_earnings_epoch && !cat.ex_dividend_epoch && !cat.latest_upgrade_downgrade ? (
              <Text style={styles.emptyText}>No upcoming catalysts identified.</Text>
            ) : null}
          </View>
        </Section>

        {/* OWNERSHIP */}
        <Section title="Ownership">
          <View style={styles.row3}>
            <Stat label="Institutions" value={own.pct_institutions != null ? `${own.pct_institutions.toFixed(1)}%` : '—'} />
            <Stat label="Insiders" value={own.pct_insiders != null ? `${own.pct_insiders.toFixed(2)}%` : '—'} />
            <Stat label="Float" value={own.float_shares != null ? fmtShares(own.float_shares) : '—'} />
          </View>
          {own.top_institution ? (
            <View style={[styles.card, { marginTop: 8 }]}>
              <Text style={styles.metricLabel}>TOP INSTITUTIONAL HOLDER</Text>
              <Text style={styles.metricValue}>{own.top_institution.organization}</Text>
              <Text style={styles.metricSub}>{own.top_institution.pct_held ? `${(own.top_institution.pct_held * 100).toFixed(2)}% held` : ''}</Text>
            </View>
          ) : null}
        </Section>

        {/* PROFILE */}
        {data.profile?.description ? (
          <Section title="About">
            <View style={styles.card}>
              <Text style={styles.descText}>{data.profile.description}</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                {data.profile.country ? <Text style={styles.profileTag}>🌍 {data.profile.country}</Text> : null}
                {data.profile.employees ? <Text style={styles.profileTag}>👥 {Number(data.profile.employees).toLocaleString()} emp</Text> : null}
                {data.profile.website ? (
                  <TouchableOpacity onPress={() => Linking.openURL(data.profile.website)}>
                    <Text style={[styles.profileTag, { color: '#60A5FA' }]}>🔗 {(data.profile.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </Section>
        ) : null}

        <Text style={styles.disclaimer}>
          Disclaimer: All analysis is for informational purposes. Real analyst data sourced from Yahoo Finance. AI scores
          and short-horizon forecasts are model-derived and not investment advice.
        </Text>
      </AppScrollView>
    </SafeAreaView>
  );
}

// ---------- helpers ----------
function fmtShares(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

function valuationTagStyle(tag: string) {
  if (tag === 'Discount') return { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.4)' };
  if (tag === 'Premium') return { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)' };
  return { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)' };
}
function valuationTagTextStyle(tag: string) {
  if (tag === 'Discount') return { color: theme.colors.success };
  if (tag === 'Premium') return { color: theme.colors.error };
  return { color: theme.colors.warning };
}
function sentimentPillStyle(label: string) {
  if (label === 'Bullish') return { backgroundColor: 'rgba(16,185,129,0.18)' };
  if (label === 'Bearish') return { backgroundColor: 'rgba(239,68,68,0.18)' };
  return { backgroundColor: 'rgba(148,163,184,0.18)' };
}
function sentimentTextStyle(label: string) {
  if (label === 'Bullish') return { color: theme.colors.success };
  if (label === 'Bearish') return { color: theme.colors.error };
  return { color: theme.colors.textMuted };
}
function sentimentDotColor(s: string) {
  if (s === 'bullish') return theme.colors.success;
  if (s === 'bearish') return theme.colors.error;
  return theme.colors.textSubtle;
}

function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  try {
    const d = new Date(epoch * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function verdictBgColor(r?: string) {
  if (r === 'STRONG_BUY' || r === 'BUY') return { backgroundColor: 'rgba(16,185,129,0.18)' };
  if (r === 'HOLD') return { backgroundColor: 'rgba(245,158,11,0.18)' };
  return { backgroundColor: 'rgba(239,68,68,0.18)' };
}
function verdictTextColor(r?: string) {
  if (r === 'STRONG_BUY' || r === 'BUY') return theme.colors.success;
  if (r === 'HOLD') return theme.colors.warning;
  return theme.colors.error;
}
function verdictBorderColor(r?: string) {
  if (r === 'STRONG_BUY' || r === 'BUY') return { borderColor: 'rgba(16,185,129,0.4)' };
  if (r === 'HOLD') return { borderColor: 'rgba(245,158,11,0.4)' };
  return { borderColor: 'rgba(239,68,68,0.4)' };
}

function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        testID="back-btn"
        onPress={onBack}
        style={styles.iconBtn}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="sparkles" size={16} color="#A78BFA" />
          <Text style={styles.hTitle}>{title}</Text>
        </View>
        <Text style={styles.hSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
    </View>
  );
}

function peerScoreColor(score: number | undefined): string {
  const s = score || 0;
  if (s >= 62) return theme.colors.success;
  if (s >= 48) return theme.colors.warning;
  return theme.colors.error;
}

function peerCell(align: 'left' | 'right' | 'center' = 'left'): any {
  return { color: theme.colors.text, fontSize: 12, fontVariant: ['tabular-nums'], textAlign: align };
}

const PEER_COLUMNS: SortableColumn[] = [
  {
    key: 'ai_score', label: 'Score', width: 56, align: 'right', mono: true,
    sortValue: (r) => r.ai_score,
    render: (r) => (
      <Text style={[peerCell('right'), { color: peerScoreColor(r.ai_score), fontWeight: '800' }]}>
        {r.ai_score?.toFixed(0)}
      </Text>
    ),
  },
  {
    key: 'pe', label: 'P/E', width: 52, align: 'right', mono: true,
    sortValue: (r) => r.pe,
    render: (r) => <Text style={peerCell('right')}>{r.pe != null ? fmtNum(r.pe) : '—'}</Text>,
  },
  {
    key: 'roe', label: 'ROE', width: 52, align: 'right', mono: true,
    sortValue: (r) => r.roe,
    render: (r) => (
      <Text style={[peerCell('right'), { color: (r.roe || 0) >= 15 ? theme.colors.success : theme.colors.text }]}>
        {r.roe != null ? fmtPct(r.roe) : '—'}
      </Text>
    ),
  },
  {
    key: 'volume_growth_pct', label: 'Vol', width: 52, align: 'right', mono: true,
    sortValue: (r) => r.volume_growth_pct,
    render: (r) => (
      <Text style={[peerCell('right'), { color: changeColor(r.volume_growth_pct), fontWeight: '700' }]}>
        {r.volume_growth_pct != null ? fmtPct(r.volume_growth_pct) : '—'}
      </Text>
    ),
  },
  {
    key: 'revenue_growth', label: 'Rev Gr', width: 58, align: 'right', mono: true,
    sortValue: (r) => r.revenue_growth,
    render: (r) => (
      <Text style={[peerCell('right'), { color: changeColor(r.revenue_growth), fontWeight: '700' }]}>
        {r.revenue_growth != null ? fmtPct(r.revenue_growth) : '—'}
      </Text>
    ),
  },
  {
    key: 'change_pct', label: 'Chg', width: 58, align: 'right', mono: true,
    sortValue: (r) => r.change_pct,
    render: (r) => (
      <Text style={[peerCell('right'), { color: changeColor(r.change_pct), fontWeight: '700' }]}>
        {fmtPct(r.change_pct)}
      </Text>
    ),
  },
];

function PeerComparisonTable({ peers, onPeerPress }: { peers: AnalyzerPeer[]; onPeerPress: (symbol: string) => void }) {
  return (
    <SortableDataTable
      testID="peer-comparison-table"
      columns={PEER_COLUMNS}
      rows={peers}
      rowKey={(r) => r.symbol}
      stickyField="symbol"
      stickyWidth={100}
      defaultSort={{ key: 'ai_score', desc: true }}
      onRowPress={(r) => onPeerPress(r.symbol)}
      renderSticky={(r) => (
        <View>
          <Text style={styles.peerSym}>{r.symbol.replace('.NS', '')}</Text>
          <Text style={styles.peerName} numberOfLines={1}>{r.name || ''}</Text>
        </View>
      )}
    />
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'pos' | 'neg' | 'neutral'; sub?: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[
        styles.metricValue,
        tone === 'pos' && { color: theme.colors.success },
        tone === 'neg' && { color: theme.colors.error },
      ]}>{value}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
    </View>
  );
}

function CatalystRow({ icon, label, value, tone }: { icon: any; label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  const color = tone === 'pos' ? theme.colors.success : tone === 'neg' ? theme.colors.error : theme.colors.text;
  return (
    <View style={styles.catRow}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.catLabel}>{label}</Text>
      <Text style={[styles.catValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    gap: 10,
    zIndex: 20,
    elevation: 20,
    backgroundColor: theme.colors.bg,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  hTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  hSubtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },

  heroCard: { margin: theme.spacing.lg, padding: 14, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  priceBig: { color: theme.colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chgBig: { fontSize: 15, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  sector: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 4 },
  scoreCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#A78BFA' },
  scoreNum: { color: theme.colors.text, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreOf: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600' },
  ratingBigPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 12 },
  ratingBigText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  confText: { color: theme.colors.textSubtle, fontSize: 11 },
  summary: { color: theme.colors.text, fontSize: 13, lineHeight: 19, marginTop: 12 },

  section: { marginHorizontal: theme.spacing.lg, marginBottom: 14 },
  sectionHead: { marginBottom: 8 },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  sectionSub: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 2 },
  card: { backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border },

  row2: { flexDirection: 'row', gap: 8 },
  row3: { flexDirection: 'row', gap: 8 },
  statCell: { flex: 1, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, padding: 10, borderWidth: 1, borderColor: theme.colors.border },
  metricLabel: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  metricValue: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  metricSub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },

  targetBox: { flexDirection: 'row', backgroundColor: theme.colors.bg, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  targetCol: { flex: 1, alignItems: 'center' },
  targetMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.colors.divider },
  targetLbl: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  targetVal: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  targetMed: { color: theme.colors.textMuted, fontSize: 9, marginTop: 2, fontVariant: ['tabular-nums'] },
  sourceTag: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '600', marginTop: 6, textAlign: 'right' },
  changeBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 8, backgroundColor: theme.colors.bg3, borderRadius: 8 },
  changeText: { color: theme.colors.text, fontSize: 11, flex: 1 },

  forecastGrid: { flexDirection: 'row', gap: 6 },
  forecastCell: { flex: 1, backgroundColor: theme.colors.bg2, padding: 10, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  forecastH: { color: theme.colors.textSubtle, fontSize: 11, fontWeight: '800' },
  forecastV: { fontSize: 18, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  forecastT: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  forecastSrc: { color: theme.colors.textSubtle, fontSize: 8, marginTop: 4, letterSpacing: 0.5 },
  forecastConf: { color: theme.colors.textSubtle, fontSize: 8, marginTop: 2 },

  proConCol: { flex: 1, borderWidth: 1, borderRadius: theme.radius.md, padding: 10 },
  proConHead: { fontSize: 11, fontWeight: '900', marginBottom: 6, letterSpacing: 0.5 },
  proConItem: { color: theme.colors.text, fontSize: 11, marginVertical: 2 },

  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  tradeLbl: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  tradeVal: { color: theme.colors.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tradeHint: { color: theme.colors.textSubtle, fontSize: 10, fontStyle: 'italic', marginTop: 8 },

  valTagPill: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  valTagText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  peerSym: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  peerName: { color: theme.colors.textMuted, fontSize: 10, marginTop: 1 },

  newsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sentimentPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sentimentText: { fontSize: 12, fontWeight: '800' },
  sentimentScore: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  newsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  sentimentDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  newsTitle: { color: theme.colors.text, fontSize: 12, lineHeight: 17 },
  newsPub: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 2 },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  catLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '600', flex: 1 },
  catValue: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  emptyText: { color: theme.colors.textMuted, fontSize: 12, paddingVertical: 8 },

  descText: { color: theme.colors.text, fontSize: 12, lineHeight: 18 },
  profileTag: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },

  disclaimer: { color: theme.colors.textSubtle, fontSize: 10, marginHorizontal: theme.spacing.lg, marginTop: 8, lineHeight: 14, fontStyle: 'italic' },
});
