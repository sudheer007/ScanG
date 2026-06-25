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
};
