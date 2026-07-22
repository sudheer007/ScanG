import { getAuthToken } from '@/src/auth/tokenBridge';

function resolveBackendBase(): string {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
  // Note: Android *emulators* map host localhost to 10.0.2.2, but physical
  // devices over USB (adb reverse tcp:8000 tcp:8000) or Wi-Fi (LAN IP) need
  // the URL as configured in .env. Don't auto-rewrite — set
  // EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8000 manually if you use an emulator.
  return base;
}

const BASE = resolveBackendBase();

export function getBackendBaseUrl(): string {
  return BASE;
}

type HttpOptions = RequestInit & { auth?: boolean };

function portfolioUploadMimeType(filename: string, mimeType?: string | null): string {
  if (mimeType) return mimeType;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'text/csv';
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function parseErrorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    /* ignore */
  }
  return text;
}

async function http<T = any>(path: string, opts: HttpOptions = {}): Promise<T> {
  const { auth: requireAuth = false, headers: extraHeaders, ...fetchOpts } = opts;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string> | undefined),
  };

  const token = await getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (requireAuth) {
    throw new Error('Authentication required');
  }

  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    ...fetchOpts,
    headers,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const detail = parseErrorDetail(txt);
    throw new ApiError(res.status, detail || `API ${res.status}: ${path}`);
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
  avg_volume_growth_pct?: number | null;
  volume_breadth_pct?: number | null;
  high_volume_count?: number;
  top_gainer?: string | null;
  top_loser?: string | null;
}

export type NiftyDirection = 'UP' | 'DOWN' | 'FLAT';

export interface NiftyTick {
  t: string;
  p: number;
}

export interface NiftyBankSignal {
  price: number | null;
  mom_bps: number;
  confirms: 'up' | 'down' | 'neutral';
}

export interface NiftyVixSignal {
  price: number | null;
  mom_bps: number;
  pressure: 'bearish' | 'bullish' | 'neutral';
}

export interface NiftyVolumeSignal {
  etf_symbol: string;
  surge_ratio: number;
  label: 'high' | 'low' | 'normal';
}

export interface NiftySignals {
  bank_nifty: NiftyBankSignal;
  india_vix: NiftyVixSignal;
  volume: NiftyVolumeSignal;
  spread_bps: number;
  range_position: number;
  from_open_bps: number;
}

export interface NiftyPredictResponse {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  horizon_sec: number;
  direction: NiftyDirection;
  confidence: number;
  score: number;
  features: Record<string, number>;
  signals: NiftySignals;
  as_of: string;
  session: 'open' | 'closed';
  ticks: NiftyTick[];
  stats: {
    hit_rate_5s?: number | null;
    hit_rate_10s?: number | null;
    hit_rate_15s?: number | null;
    hit_rate_30s?: number | null;
    hit_rate_60s?: number | null;
    n?: number;
    hits?: number;
    misses?: number;
    [key: string]: number | null | undefined;
  };
  poll_count: number;
  last_error: string | null;
  disclaimer: string;
}

export interface NiftyPredictHistoryItem {
  id: string;
  horizon_sec: number;
  direction: NiftyDirection;
  confidence: number;
  price_at: number;
  predicted_at: string;
  outcome: 'hit' | 'miss' | 'flat' | null;
  price_after: number | null;
  resolved_at: string | null;
}

export interface NiftyPredictHistoryResponse {
  symbol: string;
  count: number;
  predictions: NiftyPredictHistoryItem[];
  disclaimer: string;
}

export interface NiftyHorizonStats {
  n: number;
  hits: number;
  misses: number;
  flats: number;
  hit_rate: number | null;
}

export interface NiftyPredictStatsResponse {
  symbol: string;
  overall: NiftyHorizonStats;
  by_horizon: Record<string, NiftyHorizonStats>;
  poll_count: number;
  tick_count: number;
  session: 'open' | 'closed';
  disclaimer: string;
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
  analyzer: (symbol: string, force = false) => cget<import('@/src/types/analyzer').AnalyzerResult>(`/analyzer/${encodeURIComponent(symbol)}`, 300000, force),

  // ---- Nifty 50 short-horizon pulse (uncached — poll every 1–2s) ----
  niftyPredict: (horizon: 5 | 10 | 15 | 30 | 60 = 10) =>
    http<NiftyPredictResponse>(`/predict/nifty?horizon=${horizon}`),
  niftyPredictHistory: (limit = 50) =>
    http<NiftyPredictHistoryResponse>(`/predict/nifty/history?limit=${limit}`),
  niftyPredictStats: () => http<NiftyPredictStatsResponse>(`/predict/nifty/stats`),

  // ---- Ingestion admin (Phase 3) ----
  ingestionStatus: (force = false) =>
    cget<import('@/src/types/ingestion').IngestionStatus>(`/ingestion/status`, 30000, force),
  ingestionPartitions: () => http<{ partitions: import('@/src/types/ingestion').IngestionPartition[] }>(`/ingestion/partitions`),
  ingestionRuns: (limit = 25, runType?: string) =>
    http<{ count: number; runs: import('@/src/types/ingestion').IngestionRun[] }>(
      `/ingestion/runs?limit=${limit}${runType ? `&run_type=${encodeURIComponent(runType)}` : ''}`,
    ),
  ingestionRun: (runId: string) =>
    http<import('@/src/types/ingestion').IngestionRun>(`/ingestion/runs/${encodeURIComponent(runId)}`),
  ingestionRefreshSymbol: (symbol: string, body: { market?: Market; datasets?: string[]; sync?: boolean; force?: boolean } = {}) =>
    http(`/ingestion/refresh/symbol/${encodeURIComponent(symbol)}`, { method: 'POST', body: JSON.stringify(body) }),
  ingestionPreviewSymbol: (symbol: string, body: { market?: Market; datasets?: string[]; force?: boolean } = {}) =>
    http(`/ingestion/preview/symbol/${encodeURIComponent(symbol)}`, { method: 'POST', body: JSON.stringify(body) }),
  ingestionRefreshMarket: (body: {
    market: Market;
    datasets?: string[];
    batch_size?: number;
    dry_run?: boolean;
    sync?: boolean;
    offset?: number;
    limit?: number;
    force?: boolean;
  }) => http(`/ingestion/refresh/market`, { method: 'POST', body: JSON.stringify(body) }),
  ingestionRefreshDataset: (body: {
    dataset: string;
    symbol?: string;
    market?: Market;
    batch_size?: number;
    dry_run?: boolean;
    sync?: boolean;
    offset?: number;
    limit?: number;
    force?: boolean;
  }) => http(`/ingestion/refresh/dataset`, { method: 'POST', body: JSON.stringify(body) }),
  ingestionRefreshNightly: (body: {
    partitions?: string[];
    datasets?: string[];
    batch_size?: number;
    dry_run?: boolean;
    sync?: boolean;
    offset?: number;
    limit?: number;
    force?: boolean;
  } = {}) => http(`/ingestion/refresh/nightly`, { method: 'POST', body: JSON.stringify(body) }),

  // ---- User profile / onboarding (Firebase auth required) ----
  getMe: () =>
    http<{
      uid: string;
      email?: string | null;
      display_name?: string | null;
      onboarding_completed: boolean;
      created_at?: string;
      updated_at?: string;
    }>('/me', { auth: true }),
  completeOnboarding: (displayName: string) =>
    http<{
      uid: string;
      email?: string | null;
      display_name?: string | null;
      onboarding_completed: boolean;
      created_at?: string;
      updated_at?: string;
    }>('/me/onboarding', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName }),
      auth: true,
    }),

  // ---- User data (Firebase auth required) ----
  listWatchlist: (userId: string) =>
    http<{ items: { id: string; user_id: string; symbol: string; market: Market; added_at: string }[] }>(
      `/watchlist/${encodeURIComponent(userId)}`,
      { auth: true },
    ),
  addWatchlist: (body: { symbol: string; market: Market }) =>
    http<{ ok: boolean; duplicate?: boolean; item?: unknown }>('/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
      auth: true,
    }),
  removeWatchlist: (userId: string, symbol: string) =>
    http<{ ok: boolean; deleted: number }>(
      `/watchlist/${encodeURIComponent(userId)}/${encodeURIComponent(symbol)}`,
      { method: 'DELETE', auth: true },
    ),
  importWatchlistPortfolio: async (
    file: { uri: string; name: string; mimeType?: string | null; file?: File },
    opts?: { market?: Market },
  ) => {
    const token = await getAuthToken();
    if (!token) throw new Error('Authentication required');

    const form = new FormData();
    const uploadName = file.name || 'portfolio.csv';
    if (file.file) {
      form.append('file', file.file, uploadName);
    } else {
      form.append('file', {
        uri: file.uri,
        name: uploadName,
        type: portfolioUploadMimeType(uploadName, file.mimeType),
      } as any);
    }
    if (opts?.market) form.append('market', opts.market);

    const url = `${BASE}/api/watchlist/import`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const detail = parseErrorDetail(txt);
      throw new ApiError(res.status, detail || `API ${res.status}: /watchlist/import`);
    }
    return res.json() as Promise<{
      ok: boolean;
      summary: {
        parsed: number;
        added: number;
        duplicates: number;
        invalid: number;
        truncated: boolean;
        source?: string;
      };
      added: { symbol: string; market: Market }[];
      invalid: { raw: string; reason: string }[];
    }>;
  },

  // ---- Portfolio (holdings) ----
  listPortfolio: (userId: string) =>
    http<{
      items: {
        id: string;
        user_id: string;
        symbol: string;
        market: Market;
        quantity: number;
        avg_price: number;
        added_at: string;
        updated_at?: string;
      }[];
    }>(`/portfolio/${encodeURIComponent(userId)}`, { auth: true }),

  upsertPortfolioHolding: (body: {
    symbol: string;
    market: Market;
    quantity: number;
    avg_price: number;
  }) =>
    http<{ ok: boolean; updated?: boolean; item?: unknown }>('/portfolio', {
      method: 'POST',
      body: JSON.stringify(body),
      auth: true,
    }),

  removePortfolioHolding: (userId: string, symbol: string) =>
    http<{ ok: boolean; deleted: number }>(
      `/portfolio/${encodeURIComponent(userId)}/${encodeURIComponent(symbol)}`,
      { method: 'DELETE', auth: true },
    ),

  importPortfolio: async (
    file: { uri: string; name: string; mimeType?: string | null; file?: File },
    opts?: { market?: Market },
  ) => {
    const token = await getAuthToken();
    if (!token) throw new Error('Authentication required');

    const form = new FormData();
    const uploadName = file.name || 'portfolio.csv';
    if (file.file) {
      form.append('file', file.file, uploadName);
    } else {
      form.append('file', {
        uri: file.uri,
        name: uploadName,
        type: portfolioUploadMimeType(uploadName, file.mimeType),
      } as any);
    }
    if (opts?.market) form.append('market', opts.market);

    const url = `${BASE}/api/portfolio/import`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const detail = parseErrorDetail(txt);
      throw new ApiError(res.status, detail || `API ${res.status}: /portfolio/import`);
    }
    return res.json() as Promise<{
      ok: boolean;
      summary: {
        parsed: number;
        added: number;
        updated: number;
        invalid: number;
        truncated: boolean;
        source?: string;
      };
      added: { symbol: string; market: Market; quantity: number; avg_price: number }[];
      invalid: { raw: string; reason: string }[];
    }>;
  },

  listScreens: (userId: string) =>
    http<{ items: { id: string; user_id: string; name: string; market: Market; filters: Record<string, any> }[] }>(
      `/screens/${encodeURIComponent(userId)}`,
      { auth: true },
    ),
  saveScreen: (body: { name: string; market: Market; filters: Record<string, any> }) =>
    http('/screens', { method: 'POST', body: JSON.stringify(body), auth: true }),
  deleteScreen: (screenId: string) =>
    http(`/screens/${encodeURIComponent(screenId)}`, { method: 'DELETE', auth: true }),

  // ----- Payments (Razorpay Premium) -----
  getPlans: () =>
    http<{ items: PaymentPlan[] }>('/payments/plans'),

  createSubscription: (planId: string) =>
    http<CreateSubscriptionResponse>('/payments/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId }),
      auth: true,
    }),

  verifyPayment: (payload: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) =>
    http<VerifyPaymentResponse>('/payments/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
      auth: true,
    }),

  getMySubscription: () =>
    http<SubscriptionEntitlement>('/payments/me/subscription', { auth: true }),

  cancelSubscription: () =>
    http<{ ok: boolean; subscription: SubscriptionEntitlement }>(
      '/payments/me/subscription/cancel',
      { method: 'POST', auth: true },
    ),

  getPaymentHistory: () =>
    http<{ items: PaymentHistoryItem[] }>('/payments/me/payments', { auth: true }),
};

export type PaymentPlan = {
  id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval: string;
  features: string[];
};

export type SubscriptionEntitlement = {
  is_premium: boolean;
  plan_id: string | null;
  status: string | null;
  current_period_end: string | null;
  current_period_start?: string | null;
  subscription_id: string | null;
  cancel_at_cycle_end: boolean;
  amount?: number | null;
  currency?: string;
};

export type CreateSubscriptionResponse = {
  ok: boolean;
  subscription_id: string;
  key_id: string;
  plan: {
    id: string;
    name: string;
    amount: number;
    currency: string;
    interval: string;
  };
  name: string;
  description: string;
  prefill: { email?: string; name?: string; contact?: string };
  theme: { color: string };
};

export type VerifyPaymentResponse = {
  ok: boolean;
  verified: boolean;
  status: string;
  subscription: SubscriptionEntitlement;
  payment_id: string;
  amount?: number;
  currency?: string;
};

export type PaymentHistoryItem = {
  id?: string;
  razorpay_payment_id: string;
  razorpay_subscription_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  error_reason?: string;
  created_at?: string;
  plan_id?: string;
};
