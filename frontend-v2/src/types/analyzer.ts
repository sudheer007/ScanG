export interface AnalyzerSectorContext {
  sector: string;
  stock_count?: number;
  avg_pe?: number;
  avg_pb?: number;
  avg_roe?: number;
  avg_revenue_growth?: number;
  avg_ai_score?: number;
  relative_pe?: number;
  vs_sector_pe_pct?: number;
  valuation_tag?: 'Discount' | 'Premium' | 'In-line';
  ai_score_percentile?: number;
  ai_score_rank?: number;
  pe_rank?: number;
  sector_total?: number;
}

export interface AnalyzerPeer {
  symbol: string;
  name?: string;
  ai_score: number;
  ai_rating: string;
  pe?: number;
  change_pct?: number;
  market_cap?: number;
  price?: number | null;
  currency?: string;
  roe?: number | null;
  revenue_growth?: number | null;
  rvol?: number | null;
  volume_growth_pct?: number | null;
}

export interface AnalyzerNewsHeadline {
  title: string;
  publisher?: string;
  link?: string;
  published_epoch?: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface AnalyzerNewsSentiment {
  score: number;
  label: 'Bullish' | 'Neutral' | 'Bearish';
  bullish_count: number;
  bearish_count: number;
  headlines: AnalyzerNewsHeadline[];
}

export interface AnalyzerValuation {
  pe?: number;
  forward_pe?: number;
  pb?: number;
  ps?: number;
  peg?: number;
  market_cap?: number;
  sector_avg_pe?: number;
  relative_pe?: number;
  vs_sector_pe_pct?: number;
  valuation_tag?: string;
}

export interface AnalyzerTradeIdea {
  stance: string;
  entry_zone?: [number, number] | null;
  stop_loss?: number | null;
  targets?: number[];
  horizon?: string;
  risk_reward?: number | null;
  size_hint?: string;
}

export interface AnalyzerResult {
  symbol: string;
  name?: string;
  price?: number;
  change_pct?: number;
  currency?: string;
  sector?: string;
  industry?: string;
  error?: string;
  verdict?: {
    rating?: string;
    score?: number;
    summary?: string;
    confidence?: string;
  };
  scores?: Record<string, number>;
  sector_context?: AnalyzerSectorContext | null;
  peers?: AnalyzerPeer[];
  news_sentiment?: AnalyzerNewsSentiment;
  real_analyst?: Record<string, any>;
  forecasts?: Record<string, any>;
  valuation?: AnalyzerValuation;
  financials?: Record<string, any>;
  technicals?: Record<string, any>;
  risk?: Record<string, any>;
  catalysts?: Record<string, any>;
  ownership?: {
    pct_institutions?: number;
    pct_insiders?: number;
    top_institution?: { organization?: string; pct_held?: number };
    float_shares?: number;
  };
  pros?: string[];
  cons?: string[];
  trade_idea?: AnalyzerTradeIdea | null;
  profile?: Record<string, any>;
}
