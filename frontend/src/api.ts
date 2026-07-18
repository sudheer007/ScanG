const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function http<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${txt || path}`);
  }
  return res.json();
}

// -------------------------------------------------------------------
// Client cache — memory TTL + optional disk persistence.
// Goal: instant tab switches (served from memory), fresh on pull-to-refresh.
// -------------------------------------------------------------------
import { storage } from '@/src/utils/storage';

type CacheEntry = { data: any; ts: number };
const mem = new Map<string, CacheEntry>();
const PERSIST_PREFIX = 'radar.cache.';

async function cget<T = any>(path: string, ttl = 120000, force = false, persist = false): Promise<T> {
  const now = Date.now();
  let hit = mem.get(path);
  if (!hit && persist) {
    try {
      const raw = await storage.getItem(PERSIST_PREFIX + path, '');
      if (raw) {
        const p = JSON.parse(raw as string);
        if (p && p.data !== undefined) { mem.set(path, p); hit = p; }
      }
    } catch { /* ignore */ }
  }
  if (!force && hit && now - hit.ts < ttl) return hit.data as T;
  const data = await http<T>(path);
  const entry: CacheEntry = { data, ts: Date.now() };
  mem.set(path, entry);
  if (persist) { void storage.setItem(PERSIST_PREFIX + path, JSON.stringify(entry)); }
  return data;
}

// Instant (possibly stale) read for no-spinner first paint. null if nothing cached.
async function peek<T = any>(path: string, persist = true): Promise<T | null> {
  const hit = mem.get(path);
  if (hit) return hit.data as T;
  if (persist) {
    try {
      const raw = await storage.getItem(PERSIST_PREFIX + path, '');
      if (raw) {
        const p = JSON.parse(raw as string);
        if (p && p.data !== undefined) { mem.set(path, p); return p.data as T; }
      }
    } catch { /* ignore */ }
  }
  return null;
}

export type Market = 'US' | 'IN';

export interface Stock {
  symbol: string;
  name: string;
  sector?: string | null;
  industry?: string | null;
  currency: string;
  exchange?: string | null;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  market_cap?: number | null;
  pe?: number | null;
  forward_pe?: number | null;
  pb?: number | null;
  roe?: number | null;
  debt_to_equity?: number | null;
  dividend_yield?: number | null;
  eps?: number | null;
  eps_growth?: number | null;
  revenue_growth?: number | null;
  profit_margin?: number | null;
  beta?: number | null;
  sparkline: number[];
  rsi?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  volume_surge?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  from_52w_high_pct?: number | null;
  // --- Extended screener metrics ---
  open?: number | null;
  day_high?: number | null;
  day_low?: number | null;
  prev_close?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
  rvol?: number | null;
  shares_outstanding?: number | null;
  float_shares?: number | null;
  enterprise_value?: number | null;
  ev_ebitda?: number | null;
  ev_sales?: number | null;
  book_value_per_share?: number | null;
  payout_ratio?: number | null;
  ps_ratio?: number | null;
  peg_ratio?: number | null;
  roa?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  current_ratio?: number | null;
  quick_ratio?: number | null;
  free_cashflow?: number | null;
  operating_cashflow?: number | null;
  total_cash?: number | null;
  total_debt?: number | null;
  p_fcf?: number | null;
  from_52w_low_pct?: number | null;
  atr?: number | null;
  one_year_change_pct?: number | null;
  ytd_pct?: number | null;
  eps_growth_next_year_pct?: number | null;
  revenue_growth_next_year_pct?: number | null;
  pct_institutions?: number | null;
  pct_insiders?: number | null;
  recommendation_mean?: number | null;
  recommendation_key?: string | null;
  analyst_count?: number | null;
  target_mean_price?: number | null;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  sparkline: number[];
  currency: string;
}

export interface Strategy {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
}

export interface RadarResult {
  strategy: string;
  title: string;
  subtitle: string;
  icon: string;
  count: number;
  market: Market;
  currency: string;
  stocks: Stock[];
}

export interface HistoryPoint { t: string; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null; }

export interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  published_epoch: number | null;
  type: string;
  thumbnail: string | null;
  related_tickers: string[];
}

export interface AnalystAction {
  date_epoch: number | null;
  firm: string | null;
  from_grade: string | null;
  to_grade: string | null;
  action: string | null;
  tone: 'pos' | 'neg' | 'neutral';
}

export interface EarningsHistoryItem {
  quarter_epoch: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  eps_difference: number | null;
  surprise_pct: number | null;
}

export interface StockEvents {
  symbol: string;
  calendar: {
    next_earnings_epoch: number | null;
    ex_dividend_epoch: number | null;
    dividend_date_epoch: number | null;
    eps_estimate_avg: number | null;
    eps_estimate_low: number | null;
    eps_estimate_high: number | null;
    revenue_estimate_avg: number | null;
    next_quarter_eps_est: number | null;
    next_year_eps_est: number | null;
  };
  analyst_actions: AnalystAction[];
  earnings_history: EarningsHistoryItem[];
  recommendation_key: string | null;
  target_mean_price: number | null;
}

// ---- Fundamentals engine (Track A) ----
export interface PiotroskiCheck { name: string; passed: boolean | null; detail: string }
export interface Piotroski { score: number; max: number; evaluated: number; label: 'strong' | 'moderate' | 'weak'; checks: PiotroskiCheck[] }
export interface Altman { score: number | null; zone: 'safe' | 'grey' | 'distress' | null; components: Record<string, number>; detail: string | null }
export interface EarningsQuality { accruals_ratio: number | null; cash_conversion: number | null; label: 'high' | 'adequate' | 'low' | null }
export interface RedFlag { severity: 'high' | 'medium'; title: string; detail: string }
export interface TrajectoryPoint { date: string; value: number }
export interface Trajectories {
  revenue: TrajectoryPoint[]; revenue_growth_pct: TrajectoryPoint[]; gross_margin_pct: TrajectoryPoint[];
  operating_margin_pct: TrajectoryPoint[]; net_margin_pct: TrajectoryPoint[]; roic_pct: TrajectoryPoint[];
  debt_to_equity: TrajectoryPoint[]; fcf: TrajectoryPoint[]; shares: TrajectoryPoint[]; interest_coverage: TrajectoryPoint[];
}
export interface DcfProjection { year: number; fcf: number; pv: number }
export interface DcfResult {
  available: boolean; reason?: string;
  assumptions?: { base_fcf: number; growth_pct: number; discount_pct: number; terminal_growth_pct: number; years: number };
  intrinsic_value_per_share?: number; price?: number | null; upside_pct?: number | null;
  pv_stage_cashflows?: number; pv_terminal_value?: number; terminal_value_share_pct?: number;
  projections?: DcfProjection[]; verdict?: 'undervalued' | 'overvalued' | 'fairly valued' | null;
  symbol?: string; default_growth_pct?: number;
}
export interface PillarScores { quality: number; health: number; growth: number }
export interface Fundamentals {
  symbol: string; available: boolean; name: string; currency: string; price: number | null;
  market_cap: number | null; as_of: string | null; periods_available: number;
  pillar_scores: PillarScores; piotroski: Piotroski; altman: Altman; earnings_quality: EarningsQuality;
  trajectories: Trajectories; red_flags: RedFlag[]; dcf: DcfResult;
}
export interface PeerRow {
  symbol: string; name: string; is_target: boolean; market_cap: number | null;
  pe: number | null; pb: number | null; ev_ebitda: number | null; revenue_growth: number | null;
  eps_growth: number | null; roe: number | null; profit_margin: number | null; debt_to_equity: number | null;
  valuation_score: number | null; growth_score: number | null; quality_score: number | null;
  composite_score: number | null; rank: number;
}
export interface Peers { symbol: string; available: boolean; market: Market; currency: string; sector: string | null; count: number; peers: PeerRow[] }
export interface ResearchCatalyst { title: string; timeframe: string }
export interface ResearchNote {
  rating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence?: 'low' | 'medium' | 'high';
  thesis?: string; bull_case?: string[]; bear_case?: string[]; risks?: string[];
  catalysts?: ResearchCatalyst[]; valuation_summary?: string;
  symbol?: string; generated_at?: string; model?: string; as_of_price?: number | null; stale?: boolean;
  error?: string; detail?: string;
}

// ---- Insider & institutional ownership (Track B) ----
export interface InsiderTransaction {
  owner_name: string;
  owner_role: string;
  transaction_date: string;
  filing_date: string;
  transaction_code: string | null;
  transaction_label: string;
  sentiment: 'buy' | 'sell' | 'neutral';
  acquired_disposed: string | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  shares_owned_after: number | null;
  accession: string;
}
export interface InsiderSummary {
  buy_count: number; sell_count: number; buy_value: number; sell_value: number;
  net_sentiment: 'bullish' | 'bearish' | 'neutral'; window_days: number;
}
export interface InstitutionalHolder {
  organization: string | null; pct_held: number | null; shares: number | null;
  value: number | null; pct_change: number | null; report_date: string | null;
}
export interface Ownership {
  symbol: string; available: boolean; reason?: string;
  insider?: { available: boolean; reason?: string; transactions: InsiderTransaction[]; summary: InsiderSummary };
  institutional?: { holders: InstitutionalHolder[]; pct_institutions: number | null; pct_insiders: number | null; source: string };
}

export interface SectorRow {
  sector: string;
  stock_count: number;
  avg_change_pct: number;
  winners: number;
  losers: number;
  breadth_pct: number;
  market_cap_total: number;
}

export const api = {
  health: () => http('/health'),
  peek,
  marketOverview: (market: Market, force = false) =>
    cget<{ market: Market; currency: string; indices: IndexQuote[]; gainers: Stock[]; losers: Stock[] }>(
      `/markets/overview?market=${market}`, 60000, force, true,
    ),
  indices: (market: Market, force = false) => cget<{ indices: IndexQuote[]; currency: string }>(`/markets/indices?market=${market}`, 60000, force),
  movers: (market: Market, type: 'gainers' | 'losers' = 'gainers', limit = 15, force = false) =>
    cget<{ stocks: Stock[] }>(`/markets/movers?market=${market}&type=${type}&limit=${limit}`, 60000, force),
  stock: (symbol: string, force = false) => cget<Stock>(`/stocks/${encodeURIComponent(symbol)}`, 120000, force),
  stockEvents: (symbol: string, force = false) => cget<StockEvents>(`/stocks/${encodeURIComponent(symbol)}/events`, 1800000, force),
  history: (symbol: string, period = '6mo', interval = '1d', force = false) =>
    cget<{ points: HistoryPoint[] }>(`/stocks/${encodeURIComponent(symbol)}/history?period=${period}&interval=${interval}`, 180000, force),
  batchQuotes: (symbols: string[]) =>
    http<{ quotes: Stock[] }>(`/stocks/batch/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  strategies: () => cget<{ strategies: Strategy[] }>(`/radar/strategies`, 3600000),
  radar: (strategy: string, market: Market, force = false) => cget<RadarResult>(`/radar/${strategy}?market=${market}`, 120000, force),
  customScreen: (body: { market: Market; filters: Record<string, any>; sort_by?: string; sort_desc?: boolean; limit?: number }) =>
    http<{ count: number; stocks: Stock[]; currency: string }>(`/screener/custom`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  screenerUniverse: (market: Market, force = false) =>
    cget<{ market: Market; currency: string; count: number; stocks: Stock[] }>(`/screener/universe?market=${market}`, 120000, force),
  search: (q: string) =>
    http<{ results: { symbol: string; name: string; market: Market; price: number; change_pct: number; currency: string }[] }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
  // ---- News (Yahoo Finance) ----
  newsMarket: (market: Market, force = false, limit = 30) =>
    cget<{ market: Market; currency: string; count: number; news: NewsItem[] }>(`/news/market?market=${market}&limit=${limit}`, 600000, force, true),
  newsStock: (symbol: string, force = false, limit = 20) =>
    cget<{ symbol: string; count: number; news: NewsItem[] }>(`/news/stock/${encodeURIComponent(symbol)}?limit=${limit}`, 600000, force),
  // ---- Discover ----
  discoverFeed: (market: Market, force = false) => cget<any>(`/discover/feed?market=${market}`, 120000, force),
  discoverAiPicks: (market: Market, force = false) => cget<any>(`/discover/ai-picks?market=${market}`, 120000, force),
  discoverEvents: (market: Market, force = false) => cget<any>(`/discover/events?market=${market}`, 120000, force),
  discoverAnalystRatings: (market: Market, force = false) => cget<any>(`/discover/analyst-ratings?market=${market}`, 120000, force),
  discoverPopularScreeners: (market: Market, force = false) => cget<any>(`/discover/popular-screeners?market=${market}`, 120000, force),
  discoverValuation: (market: Market, force = false) => cget<any>(`/discover/valuation?market=${market}`, 120000, force),
  discoverInvestorPicks: (market: Market, force = false) => cget<any>(`/discover/investor-picks?market=${market}`, 120000, force),
  discoverMostActive: (market: Market, force = false) => cget<any>(`/discover/most-active?market=${market}`, 60000, force),
  discoverWinnersLosers: (market: Market, force = false) => cget<any>(`/discover/winners-losers?market=${market}`, 60000, force),
  discoverForecast: (market: Market, force = false) => cget<any>(`/discover/forecast?market=${market}`, 120000, force),
  discoverEarningsCalendar: (market: Market, force = false) => cget<any>(`/discover/earnings-calendar?market=${market}`, 300000, force),
  discoverDividendCalendar: (market: Market, force = false) => cget<any>(`/discover/dividend-calendar?market=${market}`, 300000, force),
  discoverSectorRotation: (market: Market, force = false) => cget<{ market: Market; currency: string; sectors: SectorRow[] }>(`/discover/sector-rotation?market=${market}`, 120000, force),
  discoverInstitutional: (market: Market, force = false) => cget<any>(`/discover/institutional-activity?market=${market}`, 300000, force),
  analyzer: (symbol: string, force = false) => cget<any>(`/analyzer/${encodeURIComponent(symbol)}`, 300000, force),
  // ---- Fundamentals engine (Track A) ----
  fundamentals: (symbol: string, force = false) =>
    cget<Fundamentals>(`/fundamentals/${encodeURIComponent(symbol)}`, 300000, force),
  dcf: (symbol: string, opts: { growth?: number; discount?: number; terminalGrowth?: number; years?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.growth !== undefined) qs.set('growth', String(opts.growth));
    if (opts.discount !== undefined) qs.set('discount', String(opts.discount));
    if (opts.terminalGrowth !== undefined) qs.set('terminal_growth', String(opts.terminalGrowth));
    if (opts.years !== undefined) qs.set('years', String(opts.years));
    const q = qs.toString();
    return http<DcfResult>(`/fundamentals/${encodeURIComponent(symbol)}/dcf${q ? `?${q}` : ''}`);
  },
  peers: (symbol: string, force = false) =>
    cget<Peers>(`/fundamentals/${encodeURIComponent(symbol)}/peers`, 600000, force),
  // ---- Insider & institutional ownership (Track B) ----
  ownership: (symbol: string, force = false) =>
    cget<Ownership>(`/ownership/${encodeURIComponent(symbol)}`, 600000, force),
  // ---- AI Research Analyst (Track C) ----
  research: async (symbol: string, force = false): Promise<ResearchNote> => {
    try {
      return await cget<ResearchNote>(`/research/${encodeURIComponent(symbol)}`, 1800000, force);
    } catch (e: any) {
      const msg: string = e?.message || '';
      const match = msg.match(/API (\d+): (.*)/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[2]);
          return { error: match[1] === '503' ? 'unavailable' : 'error', detail: parsed.detail };
        } catch {
          return { error: 'error', detail: msg };
        }
      }
      return { error: 'error', detail: msg };
    }
  },
};
