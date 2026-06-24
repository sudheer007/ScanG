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

export const api = {
  health: () => http('/health'),
  marketOverview: (market: Market) =>
    http<{ market: Market; currency: string; indices: IndexQuote[]; gainers: Stock[]; losers: Stock[] }>(
      `/markets/overview?market=${market}`,
    ),
  indices: (market: Market) => http<{ indices: IndexQuote[]; currency: string }>(`/markets/indices?market=${market}`),
  movers: (market: Market, type: 'gainers' | 'losers' = 'gainers', limit = 15) =>
    http<{ stocks: Stock[] }>(`/markets/movers?market=${market}&type=${type}&limit=${limit}`),
  stock: (symbol: string) => http<Stock>(`/stocks/${encodeURIComponent(symbol)}`),
  history: (symbol: string, period = '6mo', interval = '1d') =>
    http<{ points: HistoryPoint[] }>(`/stocks/${encodeURIComponent(symbol)}/history?period=${period}&interval=${interval}`),
  batchQuotes: (symbols: string[]) =>
    http<{ quotes: Stock[] }>(`/stocks/batch/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  strategies: () => http<{ strategies: Strategy[] }>(`/radar/strategies`),
  radar: (strategy: string, market: Market) => http<RadarResult>(`/radar/${strategy}?market=${market}`),
  customScreen: (body: { market: Market; filters: Record<string, any>; sort_by?: string; sort_desc?: boolean; limit?: number }) =>
    http<{ count: number; stocks: Stock[]; currency: string }>(`/screener/custom`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  search: (q: string) =>
    http<{ results: { symbol: string; name: string; market: Market; price: number; change_pct: number; currency: string }[] }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
  // ---- Discover ----
  discoverFeed: (market: Market) => http<any>(`/discover/feed?market=${market}`),
  discoverAiPicks: (market: Market) => http<any>(`/discover/ai-picks?market=${market}`),
  discoverEvents: (market: Market) => http<any>(`/discover/events?market=${market}`),
  discoverAnalystRatings: (market: Market) => http<any>(`/discover/analyst-ratings?market=${market}`),
  discoverPopularScreeners: (market: Market) => http<any>(`/discover/popular-screeners?market=${market}`),
  discoverValuation: (market: Market) => http<any>(`/discover/valuation?market=${market}`),
  discoverInvestorPicks: (market: Market) => http<any>(`/discover/investor-picks?market=${market}`),
  discoverMostActive: (market: Market) => http<any>(`/discover/most-active?market=${market}`),
  discoverWinnersLosers: (market: Market) => http<any>(`/discover/winners-losers?market=${market}`),
};
