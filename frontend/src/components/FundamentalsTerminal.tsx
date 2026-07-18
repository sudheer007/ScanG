import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api, Fundamentals, Peers, PeerRow, DcfResult, ResearchNote, RedFlag, Ownership, InsiderTransaction, InstitutionalHolder } from '@/src/api';
import { theme, fmtNum, fmtMarketCap } from '@/src/theme';
import ScoreBar from '@/src/components/widgets/ScoreBar';
import DataTable, { Column } from '@/src/components/widgets/DataTable';
import Sparkline from '@/src/components/Sparkline';
import { LoadingState, ErrorState, EmptyState } from '@/src/components/States';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? (
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function toneColor(passed: boolean | null) {
  if (passed === null) return theme.colors.textSubtle;
  return passed ? theme.colors.success : theme.colors.error;
}

function severityColor(sev: RedFlag['severity']) {
  return sev === 'high' ? theme.colors.error : theme.colors.warning;
}

// ---------------------------------------------------------------------------
// Fundamentals fetch hook (shared by Quality / Valuation / Growth / Health)
// ---------------------------------------------------------------------------

function useFundamentals(symbol: string) {
  const [data, setData] = useState<Fundamentals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.fundamentals(symbol, force);
      setData(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to load fundamentals');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}

// ---------------------------------------------------------------------------
// Quality tab — Piotroski F-Score checklist + earnings quality
// ---------------------------------------------------------------------------

export function QualityTab({ symbol }: { symbol: string }) {
  const { data, loading, error, reload } = useFundamentals(symbol);

  if (loading && !data) return <LoadingState label="Scoring fundamentals…" />;
  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return <EmptyState title="No fundamentals available" />;

  const { piotroski, earnings_quality, pillar_scores } = data;

  return (
    <View>
      <Card title="Quality Score">
        <ScoreBar label="Quality" value={pillar_scores.quality} />
      </Card>

      <Card title={`Piotroski F-Score — ${piotroski.score}/${piotroski.max} (${piotroski.label})`}>
        {piotroski.checks.map((c) => (
          <View key={c.name} style={styles.checkRow} testID={`piotroski-${c.name}`}>
            <Ionicons
              name={c.passed === null ? 'help-circle-outline' : c.passed ? 'checkmark-circle' : 'close-circle'}
              size={18}
              color={toneColor(c.passed)}
              style={{ marginTop: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkName}>{c.name}</Text>
              <Text style={styles.checkDetail}>{c.detail}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card title="Earnings Quality">
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Accruals ratio</Text>
          <Text style={styles.metricValue}>{fmtNum(earnings_quality.accruals_ratio, 3)}</Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Cash conversion (OCF / NI)</Text>
          <Text style={styles.metricValue}>{earnings_quality.cash_conversion != null ? `${earnings_quality.cash_conversion.toFixed(2)}x` : '—'}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: (earnings_quality.label === 'high' ? theme.colors.success : earnings_quality.label === 'low' ? theme.colors.error : theme.colors.warning) + '22' }]}>
          <Text style={[styles.badgeText, { color: earnings_quality.label === 'high' ? theme.colors.success : earnings_quality.label === 'low' ? theme.colors.error : theme.colors.warning }]}>
            {earnings_quality.label ? `${earnings_quality.label} quality` : 'insufficient data'}
          </Text>
        </View>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Valuation tab — DCF (adjustable assumptions) + peer comparison
// ---------------------------------------------------------------------------

function Stepper({ label, value, unit, onChange, step = 1, min = -50, max = 50 }: { label: string; value: number; unit: string; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity testID={`stepper-${label}-down`} style={styles.stepperBtn} onPress={() => onChange(Math.max(min, +(value - step).toFixed(1)))}>
          <Ionicons name="remove" size={16} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value.toFixed(1)}{unit}</Text>
        <TouchableOpacity testID={`stepper-${label}-up`} style={styles.stepperBtn} onPress={() => onChange(Math.min(max, +(value + step).toFixed(1)))}>
          <Ionicons name="add" size={16} color={theme.colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ValuationTab({ symbol, currency }: { symbol: string; currency: string }) {
  const { data: fund, loading: fundLoading, error: fundError, reload: reloadFund } = useFundamentals(symbol);
  const [peers, setPeers] = useState<Peers | null>(null);
  const [peersLoading, setPeersLoading] = useState(true);

  const [growth, setGrowth] = useState<number | null>(null);
  const [discount, setDiscount] = useState(10);
  const [terminalGrowth, setTerminalGrowth] = useState(2.5);
  const [dcf, setDcf] = useState<DcfResult | null>(null);
  const [dcfLoading, setDcfLoading] = useState(false);

  useEffect(() => {
    api.peers(symbol).then(setPeers).catch(() => {}).finally(() => setPeersLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (fund?.dcf?.available) {
      setDcf(fund.dcf);
      if (growth === null) setGrowth(fund.dcf.assumptions?.growth_pct ?? 6);
      setDiscount(fund.dcf.assumptions?.discount_pct ?? 10);
      setTerminalGrowth(fund.dcf.assumptions?.terminal_growth_pct ?? 2.5);
    } else if (fund && !fund.dcf?.available) {
      setDcf(fund.dcf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fund]);

  const recalc = useCallback(async (g: number, d: number, tg: number) => {
    setDcfLoading(true);
    try {
      const r = await api.dcf(symbol, { growth: g, discount: d, terminalGrowth: tg });
      setDcf(r);
    } catch {
      // keep prior dcf on failure
    } finally {
      setDcfLoading(false);
    }
  }, [symbol]);

  const onGrowthChange = (v: number) => { setGrowth(v); recalc(v, discount, terminalGrowth); };
  const onDiscountChange = (v: number) => { setDiscount(v); recalc(growth ?? 6, v, terminalGrowth); };
  const onTerminalChange = (v: number) => { setTerminalGrowth(v); recalc(growth ?? 6, discount, v); };

  const columns: Column[] = useMemo(() => [
    { key: 'symbol', label: 'Symbol', width: 90 },
    { key: 'pe', label: 'P/E', width: 60, align: 'right', mono: true, render: (r: PeerRow) => <Text style={styles.tableCell}>{fmtNum(r.pe)}</Text> },
    { key: 'roe', label: 'ROE %', width: 70, align: 'right', mono: true, render: (r: PeerRow) => <Text style={styles.tableCell}>{fmtNum(r.roe, 1)}</Text> },
    { key: 'revenue_growth', label: 'Rev Gr %', width: 80, align: 'right', mono: true, render: (r: PeerRow) => <Text style={styles.tableCell}>{fmtNum(r.revenue_growth, 1)}</Text> },
    {
      key: 'composite_score', label: 'Score', width: 70, align: 'right',
      render: (r: PeerRow) => (
        <Text style={[styles.tableCell, { fontWeight: '800', color: r.is_target ? theme.colors.text : theme.colors.textMuted }]}>
          {r.composite_score ?? '—'}
        </Text>
      ),
    },
  ], []);

  if (fundLoading && !fund) return <LoadingState label="Building valuation model…" />;
  if (fundError) return <ErrorState message={fundError} onRetry={() => reloadFund()} />;
  if (!fund) return <EmptyState title="No valuation data available" />;

  return (
    <View>
      <Card
        title="DCF Intrinsic Value"
        right={dcfLoading ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : null}
      >
        {dcf?.available ? (
          <>
            <View style={styles.dcfHeadline}>
              <View>
                <Text style={styles.dcfBig}>{currency === 'INR' ? '₹' : '$'}{dcf.intrinsic_value_per_share?.toFixed(2)}</Text>
                <Text style={styles.metricLabelSmall}>intrinsic value / share</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.dcfUpside, { color: (dcf.upside_pct || 0) >= 0 ? theme.colors.success : theme.colors.error }]}>
                  {dcf.upside_pct != null ? `${dcf.upside_pct >= 0 ? '+' : ''}${dcf.upside_pct.toFixed(1)}%` : '—'}
                </Text>
                <Text style={styles.metricLabelSmall}>{dcf.verdict || ''}</Text>
              </View>
            </View>

            <Stepper label="Growth (5y)" value={growth ?? 6} unit="%" onChange={onGrowthChange} step={0.5} min={-10} max={30} />
            <Stepper label="Discount rate" value={discount} unit="%" onChange={onDiscountChange} step={0.5} min={4} max={20} />
            <Stepper label="Terminal growth" value={terminalGrowth} unit="%" onChange={onTerminalChange} step={0.5} min={0} max={5} />

            <Text style={styles.dcfNote}>
              Terminal value is {dcf.terminal_value_share_pct?.toFixed(0)}% of intrinsic value. Model is sensitive to assumptions — treat as a starting point, not a target price.
            </Text>
          </>
        ) : (
          <Text style={styles.metricLabel}>{dcf?.reason || 'DCF not available for this stock.'}</Text>
        )}
      </Card>

      <Card title={`Peer Comparison${peers?.sector ? ` — ${peers.sector}` : ''}`}>
        {peersLoading ? (
          <LoadingState label="Loading peers…" />
        ) : peers && peers.peers.length > 0 ? (
          <DataTable columns={columns} rows={peers.peers} rowKey={(r) => r.symbol} linkToStockField="symbol" testID="peer-table" />
        ) : (
          <Text style={styles.metricLabel}>No sector peers found.</Text>
        )}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Growth tab — trajectories
// ---------------------------------------------------------------------------

function TrendRow({ label, points, suffix = '', digits = 1 }: { label: string; points: { date: string; value: number }[]; suffix?: string; digits?: number }) {
  if (!points || points.length === 0) return null;
  const latest = points[points.length - 1].value;
  const values = points.map((p) => p.value);
  return (
    <View style={styles.trendRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{latest.toFixed(digits)}{suffix}</Text>
      </View>
      <Sparkline data={values} width={90} height={30} fill />
    </View>
  );
}

export function GrowthTab({ symbol }: { symbol: string }) {
  const { data, loading, error, reload } = useFundamentals(symbol);
  if (loading && !data) return <LoadingState label="Charting growth trajectory…" />;
  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return <EmptyState title="No growth data available" />;

  const t = data.trajectories;
  return (
    <View>
      <Card title="Growth Score">
        <ScoreBar label="Growth" value={data.pillar_scores.growth} />
      </Card>
      <Card title={`Trajectories · ${data.periods_available}y history`}>
        <TrendRow label="Revenue growth YoY" points={t.revenue_growth_pct} suffix="%" />
        <TrendRow label="Gross margin" points={t.gross_margin_pct} suffix="%" />
        <TrendRow label="Operating margin" points={t.operating_margin_pct} suffix="%" />
        <TrendRow label="Net margin" points={t.net_margin_pct} suffix="%" />
        <TrendRow label="ROIC" points={t.roic_pct} suffix="%" />
        <TrendRow label="Free cash flow" points={t.fcf.map((p) => ({ date: p.date, value: p.value / 1e9 }))} suffix="B" />
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Health tab — Altman Z-Score + red flags
// ---------------------------------------------------------------------------

const ZONE_LABEL: Record<string, string> = { safe: 'Safe Zone', grey: 'Grey Zone', distress: 'Distress Zone' };
const ZONE_COLOR: Record<string, string> = { safe: theme.colors.success, grey: theme.colors.warning, distress: theme.colors.error };

export function HealthTab({ symbol }: { symbol: string }) {
  const { data, loading, error, reload } = useFundamentals(symbol);
  if (loading && !data) return <LoadingState label="Checking financial health…" />;
  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return <EmptyState title="No health data available" />;

  const { altman, red_flags, trajectories, pillar_scores } = data;

  return (
    <View>
      <Card title="Health Score">
        <ScoreBar label="Health" value={pillar_scores.health} />
      </Card>

      <Card title="Altman Z-Score">
        {altman.score != null ? (
          <>
            <View style={styles.dcfHeadline}>
              <Text style={styles.dcfBig}>{altman.score.toFixed(2)}</Text>
              <View style={[styles.badge, { backgroundColor: (ZONE_COLOR[altman.zone || 'grey']) + '22' }]}>
                <Text style={[styles.badgeText, { color: ZONE_COLOR[altman.zone || 'grey'] }]}>{ZONE_LABEL[altman.zone || 'grey']}</Text>
              </View>
            </View>
            <Text style={styles.dcfNote}>
              Safe &gt; 2.99 · Grey 1.81–2.99 · Distress &lt; 1.81. Predicts bankruptcy risk from balance-sheet and earnings structure.
            </Text>
          </>
        ) : (
          <Text style={styles.metricLabel}>{altman.detail || 'Altman Z-Score not available.'}</Text>
        )}
      </Card>

      <Card title="Red Flags">
        {red_flags.length === 0 ? (
          <View style={styles.checkRow}>
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
            <Text style={styles.checkName}>No red flags detected by the automated screen</Text>
          </View>
        ) : (
          red_flags.map((f, i) => (
            <View key={i} style={styles.checkRow} testID={`redflag-${i}`}>
              <Ionicons name="warning" size={18} color={severityColor(f.severity)} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.checkName, { color: severityColor(f.severity) }]}>{f.title}</Text>
                <Text style={styles.checkDetail}>{f.detail}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      {trajectories.interest_coverage.length > 0 && (
        <Card title="Interest Coverage & Leverage">
          <TrendRow label="Interest coverage (EBIT / interest)" points={trajectories.interest_coverage} suffix="x" />
          <TrendRow label="Debt / equity" points={trajectories.debt_to_equity} />
        </Card>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ownership tab — SEC EDGAR insider transactions + institutional holders (Track B)
// ---------------------------------------------------------------------------

const SENTIMENT_COLOR: Record<string, string> = { bullish: theme.colors.success, bearish: theme.colors.error, neutral: theme.colors.textMuted };
const SENTIMENT_LABEL: Record<string, string> = { bullish: 'Net Buying', bearish: 'Net Selling', neutral: 'Mixed / Neutral' };

function fmtShares(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtUsd(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function InsiderRow({ t }: { t: InsiderTransaction }) {
  const color = t.sentiment === 'buy' ? theme.colors.success : t.sentiment === 'sell' ? theme.colors.error : theme.colors.textMuted;
  return (
    <View style={styles.insiderRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkName}>{t.owner_name}</Text>
        <Text style={styles.checkDetail}>{t.owner_role} · {t.transaction_date}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.badgeText, { color }]}>{t.transaction_label}</Text>
        <Text style={styles.metricLabelSmall}>
          {fmtShares(t.shares)} sh{t.price != null ? ` @ ${t.price.toFixed(2)}` : ''}{t.value != null ? ` (${fmtUsd(t.value)})` : ''}
        </Text>
      </View>
    </View>
  );
}

export function OwnershipTab({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Ownership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.ownership(symbol);
      setData(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to load ownership data');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <LoadingState label="Pulling SEC filings…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <EmptyState title="No ownership data available" />;

  if (!data.available) {
    return <EmptyState title="Not available for this market" subtitle={data.reason} />;
  }

  const insider = data.insider;
  const institutional = data.institutional;
  const columns: Column[] = [
    { key: 'organization', label: 'Institution', width: 160 },
    { key: 'pct_held', label: '% Held', width: 70, align: 'right', render: (r: InstitutionalHolder) => <Text style={styles.tableCell}>{fmtNum(r.pct_held, 2)}</Text> },
    { key: 'value', label: 'Value', width: 90, align: 'right', render: (r: InstitutionalHolder) => <Text style={styles.tableCell}>{fmtMarketCap(r.value, 'USD')}</Text> },
    { key: 'pct_change', label: 'Δ %', width: 70, align: 'right', render: (r: InstitutionalHolder) => <Text style={[styles.tableCell, { color: (r.pct_change || 0) >= 0 ? theme.colors.success : theme.colors.error }]}>{fmtNum(r.pct_change, 1)}</Text> },
  ];

  return (
    <View>
      <Card title="Insider Activity (SEC Form 4)">
        {insider?.available === false ? (
          <Text style={styles.metricLabel}>{insider.reason || 'No SEC EDGAR record for this symbol.'}</Text>
        ) : insider ? (
          <>
            <View style={styles.insiderSummaryRow}>
              <View style={[styles.badge, { marginTop: 0, backgroundColor: SENTIMENT_COLOR[insider.summary.net_sentiment] + '22' }]}>
                <Text style={[styles.badgeText, { color: SENTIMENT_COLOR[insider.summary.net_sentiment] }]}>{SENTIMENT_LABEL[insider.summary.net_sentiment]}</Text>
              </View>
              <Text style={styles.metricLabelSmall}>last {insider.summary.window_days} days</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Buys: {insider.summary.buy_count} ({fmtUsd(insider.summary.buy_value)})</Text>
              <Text style={styles.metricLabel}>Sells: {insider.summary.sell_count} ({fmtUsd(insider.summary.sell_value)})</Text>
            </View>
            {insider.transactions.length === 0 ? (
              <Text style={[styles.metricLabel, { marginTop: 8 }]}>No recent Form 4 filings.</Text>
            ) : (
              insider.transactions.slice(0, 20).map((t, i) => <InsiderRow key={`${t.accession}-${i}`} t={t} />)
            )}
          </>
        ) : null}
      </Card>

      <Card title="Institutional Holders">
        {institutional && institutional.holders.length > 0 ? (
          <>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Institutional: {fmtNum(institutional.pct_institutions, 1)}%</Text>
              <Text style={styles.metricLabel}>Insider: {fmtNum(institutional.pct_insiders, 1)}%</Text>
            </View>
            <DataTable columns={columns} rows={institutional.holders} rowKey={(r) => r.organization || ''} testID="institutional-table" />
            <Text style={styles.dcfNote}>Sourced from Yahoo Finance's aggregated 13F data, not a live per-filing SEC lookup (13F filings are per-institution portfolios, not searchable per-security).</Text>
          </>
        ) : (
          <Text style={styles.metricLabel}>No institutional ownership data available.</Text>
        )}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AI Note tab — Track C research note
// ---------------------------------------------------------------------------

const RATING_LABEL: Record<string, string> = {
  strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', sell: 'Sell', strong_sell: 'Strong Sell',
};
const RATING_COLOR: Record<string, string> = {
  strong_buy: theme.colors.success, buy: '#34D399', hold: theme.colors.warning, sell: '#F97316', strong_sell: theme.colors.error,
};

export function AINoteTab({ symbol }: { symbol: string }) {
  const [note, setNote] = useState<ResearchNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    try {
      const r = await api.research(symbol, force);
      setNote(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState label="Loading AI research note…" />;

  if (!note || note.error === 'unavailable') {
    return (
      <EmptyState
        title="AI Research Analyst not configured"
        subtitle={note?.detail || 'The server does not have an AI provider configured for this feature yet.'}
      />
    );
  }
  if (note.error === 'no_data') {
    return <EmptyState title="Not enough data" subtitle="This stock doesn't have enough fundamental data to research yet." />;
  }
  if (note.error) {
    return <ErrorState message={note.detail || 'Failed to generate research note'} onRetry={() => load(true)} />;
  }

  const ratingColor = RATING_COLOR[note.rating || 'hold'];

  return (
    <View>
      <Card
        right={
          <TouchableOpacity testID="research-refresh" onPress={() => load(true)} disabled={refreshing} style={styles.refreshBtn}>
            {refreshing ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <Ionicons name="refresh" size={16} color={theme.colors.textMuted} />}
          </TouchableOpacity>
        }
      >
        <View style={styles.ratingRow}>
          <View style={[styles.ratingBadge, { backgroundColor: ratingColor + '22', borderColor: ratingColor }]}>
            <Text style={[styles.ratingText, { color: ratingColor }]}>{RATING_LABEL[note.rating || 'hold']}</Text>
          </View>
          <Text style={styles.confidenceText}>{note.confidence} confidence</Text>
          {note.stale ? <Text style={styles.staleText}>stale — retry failed, showing last note</Text> : null}
        </View>
        <Text style={styles.thesis}>{note.thesis}</Text>
        {note.generated_at ? (
          <Text style={styles.metricLabelSmall}>Generated {new Date(note.generated_at).toLocaleString()} · {note.model}</Text>
        ) : null}
      </Card>

      <Card title="Bull Case">
        {(note.bull_case || []).map((b, i) => (
          <View key={i} style={styles.bulletRow}><Text style={[styles.bullet, { color: theme.colors.success }]}>▲</Text><Text style={styles.bulletText}>{b}</Text></View>
        ))}
      </Card>

      <Card title="Bear Case">
        {(note.bear_case || []).map((b, i) => (
          <View key={i} style={styles.bulletRow}><Text style={[styles.bullet, { color: theme.colors.error }]}>▼</Text><Text style={styles.bulletText}>{b}</Text></View>
        ))}
      </Card>

      <Card title="Risks">
        {(note.risks || []).map((r, i) => (
          <View key={i} style={styles.bulletRow}><Text style={[styles.bullet, { color: theme.colors.warning }]}>!</Text><Text style={styles.bulletText}>{r}</Text></View>
        ))}
      </Card>

      <Card title="Catalysts">
        {(note.catalysts || []).map((c, i) => (
          <View key={i} style={styles.catalystRow}>
            <Text style={styles.bulletText}>{c.title}</Text>
            <Text style={styles.catalystTimeframe}>{c.timeframe}</Text>
          </View>
        ))}
      </Card>

      <Card title="Valuation Summary">
        <Text style={styles.thesis}>{note.valuation_summary}</Text>
      </Card>

      <Text style={styles.disclaimer}>AI-generated research for informational purposes only — not personalized investment advice.</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
  cardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  checkRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, alignItems: 'flex-start' },
  checkName: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  checkDetail: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  metricLabel: { color: theme.colors.textMuted, fontSize: 12 },
  metricLabelSmall: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 2 },
  metricValue: { color: theme.colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, marginTop: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  stepperLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.colors.bg3, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', width: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  dcfHeadline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  dcfBig: { color: theme.colors.text, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dcfUpside: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dcfNote: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 10, lineHeight: 16 },
  trendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  tableCell: { color: theme.colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  refreshBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: theme.colors.bg3, alignItems: 'center', justifyContent: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ratingBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1 },
  ratingText: { fontSize: 13, fontWeight: '800' },
  confidenceText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  staleText: { color: theme.colors.warning, fontSize: 10, fontStyle: 'italic' },
  thesis: { color: theme.colors.text, fontSize: 13, lineHeight: 19, marginTop: 10 },
  bulletRow: { flexDirection: 'row', gap: 8, paddingVertical: 5, alignItems: 'flex-start' },
  bullet: { fontSize: 12, fontWeight: '900', marginTop: 2 },
  bulletText: { color: theme.colors.text, fontSize: 13, flex: 1, lineHeight: 18 },
  catalystRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  catalystTimeframe: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600', marginTop: 2, textTransform: 'uppercase' },
  disclaimer: { color: theme.colors.textSubtle, fontSize: 10, textAlign: 'center', marginTop: 4, marginBottom: theme.spacing.lg, fontStyle: 'italic' },
  insiderRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider, alignItems: 'flex-start' },
  insiderSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
});
