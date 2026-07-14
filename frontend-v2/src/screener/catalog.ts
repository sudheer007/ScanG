// Screener metric catalog — buckets, availability, formatting.
// `available: false` => "coming soon" (greyed, not filterable).
// `scale` => raw value is multiplied by this for display + filter input (default 1).

export type MetricFmt = 'money' | 'pct' | 'ratio' | 'num' | 'big' | 'int';

export interface Metric {
  key: string;        // backend stock field
  label: string;
  unit?: string;      // e.g. '%', '×'
  available: boolean;
  scale?: number;     // raw * scale = displayed/entered value
  fmt: MetricFmt;
  decimals?: number;
  hint?: string;      // example range
}

export interface Bucket {
  id: string;
  title: string;
  color: string;      // accent dot
  metrics: Metric[];
}

export const BUCKETS: Bucket[] = [
  {
    id: 'price',
    title: 'Price & Performance',
    color: '#10B981',
    metrics: [
      { key: 'price', label: 'Last Price', available: true, fmt: 'money' },
      { key: 'open', label: 'Open', available: true, fmt: 'money' },
      { key: 'day_high', label: 'Day High', available: true, fmt: 'money' },
      { key: 'day_low', label: 'Day Low', available: true, fmt: 'money' },
      { key: 'prev_close', label: 'Previous Close', available: true, fmt: 'money' },
      { key: 'change_pct', label: 'Daily Change', unit: '%', available: true, fmt: 'pct' },
      { key: 'change', label: 'Daily Change (abs)', available: true, fmt: 'money' },
      { key: 'high_52w', label: '52wk High', available: true, fmt: 'money' },
      { key: 'low_52w', label: '52wk Low', available: true, fmt: 'money' },
      { key: 'from_52w_high_pct', label: '% From 52wk High', unit: '%', available: true, fmt: 'pct', hint: 'negative = below high' },
      { key: 'from_52w_low_pct', label: '% From 52wk Low', unit: '%', available: true, fmt: 'pct' },
      { key: 'one_year_change_pct', label: '1-Year Change', unit: '%', available: true, fmt: 'pct' },
      { key: 'ytd_pct', label: 'YTD Return', unit: '%', available: true, fmt: 'pct' },
      { key: 'atr', label: 'Average True Range (ATR)', available: true, fmt: 'num' },
      { key: '_prev_month_chg', label: 'Previous Month % Change', unit: '%', available: false, fmt: 'pct' },
      { key: '_gap', label: 'Gap Up / Gap Down', unit: '%', available: false, fmt: 'pct' },
    ],
  },
  {
    id: 'valuation',
    title: 'Valuation',
    color: '#3B82F6',
    metrics: [
      { key: 'market_cap', label: 'Market Capitalization', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: 'enterprise_value', label: 'Enterprise Value (EV)', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: 'eps', label: 'EPS (TTM)', available: true, fmt: 'num' },
      { key: 'pe', label: 'P/E Ratio (TTM)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'forward_pe', label: 'Forward P/E', unit: '×', available: true, fmt: 'ratio' },
      { key: 'peg_ratio', label: 'PEG Ratio', unit: '×', available: true, fmt: 'ratio' },
      { key: 'ps_ratio', label: 'Price to Sales (TTM)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'p_fcf', label: 'Price to Free Cash Flow', unit: '×', available: true, fmt: 'ratio' },
      { key: 'pb', label: 'Price to Book (MRQ)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'ev_sales', label: 'EV / Sales', unit: '×', available: true, fmt: 'ratio' },
      { key: 'ev_ebitda', label: 'EV / EBITDA', unit: '×', available: true, fmt: 'ratio' },
      { key: 'book_value_per_share', label: 'Book Value / Share', available: true, fmt: 'money' },
      { key: '_forward_eps', label: 'Forward EPS', available: false, fmt: 'num' },
      { key: '_p_cf', label: 'Price to Cash Flow (MRQ)', unit: '×', available: false, fmt: 'ratio' },
      { key: '_p_tbv', label: 'Price to Tangible Book', unit: '×', available: false, fmt: 'ratio' },
      { key: '_cash_per_share', label: 'Cash per Share', available: false, fmt: 'money' },
    ],
  },
  {
    id: 'growth',
    title: 'Earnings & Growth',
    color: '#8B5CF6',
    metrics: [
      { key: 'eps_growth', label: 'EPS Growth (YoY)', unit: '%', available: true, fmt: 'pct' },
      { key: 'revenue_growth', label: 'Revenue Growth (YoY)', unit: '%', available: true, fmt: 'pct' },
      { key: 'eps_growth_next_year_pct', label: 'Projected EPS Growth', unit: '%', available: true, fmt: 'pct' },
      { key: 'revenue_growth_next_year_pct', label: 'Projected Revenue Growth', unit: '%', available: true, fmt: 'pct' },
      { key: '_eps_ttm_yoy', label: 'EPS (TTM) vs TTM 1Yr Ago', unit: '%', available: false, fmt: 'pct' },
      { key: '_eps_5y', label: '5 Year EPS Growth', unit: '%', available: false, fmt: 'pct' },
      { key: '_sales_5y', label: '5 Year Sales Growth', unit: '%', available: false, fmt: 'pct' },
      { key: '_capex_5y', label: '5 Year Capital Spending Growth', unit: '%', available: false, fmt: 'pct' },
    ],
  },
  {
    id: 'profitability',
    title: 'Profitability & Quality',
    color: '#F59E0B',
    metrics: [
      { key: 'gross_margin', label: 'Gross Margin (TTM)', unit: '%', available: true, fmt: 'pct', scale: 100 },
      { key: 'operating_margin', label: 'Operating Margin (TTM)', unit: '%', available: true, fmt: 'pct', scale: 100 },
      { key: 'profit_margin', label: 'Net Profit Margin (TTM)', unit: '%', available: true, fmt: 'pct' },
      { key: 'roe', label: 'Return on Equity (ROE)', unit: '%', available: true, fmt: 'pct' },
      { key: 'roa', label: 'Return on Assets (ROA)', unit: '%', available: true, fmt: 'pct' },
      { key: '_roce', label: 'Return on Capital Employed (ROCE)', unit: '%', available: false, fmt: 'pct' },
      { key: '_roic', label: 'Return on Invested Capital (ROIC)', unit: '%', available: false, fmt: 'pct' },
      { key: '_ebit_margin', label: 'EBIT Margin', unit: '%', available: false, fmt: 'pct' },
      { key: '_ebitda_margin', label: 'EBITDA Margin', unit: '%', available: false, fmt: 'pct' },
      { key: '_pretax_margin', label: 'Pretax Margin (TTM)', unit: '%', available: false, fmt: 'pct' },
      { key: '_gross_margin_5y', label: 'Gross Margin (5YA)', unit: '%', available: false, fmt: 'pct' },
      { key: '_op_margin_5y', label: 'Operating Margin (5YA)', unit: '%', available: false, fmt: 'pct' },
    ],
  },
  {
    id: 'health',
    title: 'Financial Health',
    color: '#EF4444',
    metrics: [
      { key: 'current_ratio', label: 'Current Ratio (MRQ)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'quick_ratio', label: 'Quick Ratio (MRQ)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'debt_to_equity', label: 'Total Debt to Equity', unit: '%', available: true, fmt: 'num' },
      { key: 'total_debt', label: 'Total Debt', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: 'total_cash', label: 'Total Cash', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: '_lt_de', label: 'LT Debt to Equity (MRQ)', unit: '%', available: false, fmt: 'num' },
      { key: '_debt_assets', label: 'Debt / Assets', available: false, fmt: 'ratio' },
      { key: '_interest_cov', label: 'Interest Coverage', unit: '×', available: false, fmt: 'ratio' },
      { key: '_cash_ratio', label: 'Cash Ratio', unit: '×', available: false, fmt: 'ratio' },
      { key: '_working_capital', label: 'Working Capital', available: false, fmt: 'big' },
      { key: '_net_debt', label: 'Net Debt', available: false, fmt: 'big' },
    ],
  },
  {
    id: 'cashflow',
    title: 'Cash Flow',
    color: '#D97706',
    metrics: [
      { key: 'operating_cashflow', label: 'Operating Cash Flow', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: 'free_cashflow', label: 'Free Cash Flow', available: true, fmt: 'big', hint: 'enter in billions' },
      { key: '_fcf_growth', label: 'Free Cash Flow Growth', unit: '%', available: false, fmt: 'pct' },
      { key: '_cf_margin', label: 'Cash Flow Margin', unit: '%', available: false, fmt: 'pct' },
    ],
  },
  {
    id: 'dividends',
    title: 'Dividends',
    color: '#14B8A6',
    metrics: [
      { key: 'dividend_yield', label: 'Dividend Yield', unit: '%', available: true, fmt: 'pct' },
      { key: 'payout_ratio', label: 'Payout Ratio (TTM)', unit: '%', available: true, fmt: 'pct' },
      { key: '_div_yield_5y', label: 'Dividend Yield 5Y Avg', unit: '%', available: false, fmt: 'pct' },
      { key: '_div_growth', label: 'Dividend Growth Rate (Ann.)', unit: '%', available: false, fmt: 'pct' },
      { key: '_div_cagr', label: 'Dividend CAGR', unit: '%', available: false, fmt: 'pct' },
      { key: '_years_div_growth', label: 'Years of Dividend Growth', available: false, fmt: 'int' },
    ],
  },
  {
    id: 'technicals',
    title: 'Technical Indicators',
    color: '#06B6D4',
    metrics: [
      { key: 'rsi', label: 'RSI (14)', available: true, fmt: 'num', decimals: 0, hint: '0–100' },
      { key: 'macd', label: 'MACD (12,26)', available: true, fmt: 'num' },
      { key: 'ma50', label: 'Moving Average (SMA 50)', available: true, fmt: 'money' },
      { key: 'ma200', label: 'Moving Average (SMA 200)', available: true, fmt: 'money' },
      { key: 'volume_surge', label: 'Volume Surge', unit: '×', available: true, fmt: 'ratio', hint: '>1 = above avg' },
      { key: '_adx', label: 'ADX (14)', available: false, fmt: 'num' },
      { key: '_cci', label: 'CCI (14)', available: false, fmt: 'num' },
      { key: '_stoch', label: 'Stochastic (14)', available: false, fmt: 'num' },
      { key: '_willr', label: 'Williams %R', available: false, fmt: 'num' },
      { key: '_bbands', label: 'Bollinger Bands', available: false, fmt: 'num' },
      { key: '_ichimoku', label: 'Ichimoku Cloud', available: false, fmt: 'num' },
      { key: '_supertrend', label: 'SuperTrend', available: false, fmt: 'num' },
      { key: '_psar', label: 'Parabolic SAR', available: false, fmt: 'num' },
      { key: '_vwap', label: 'VWAP', available: false, fmt: 'money' },
    ],
  },
  {
    id: 'ownership',
    title: 'Ownership',
    color: '#D946EF',
    metrics: [
      { key: 'pct_institutions', label: 'Institutional Holding', unit: '%', available: true, fmt: 'pct' },
      { key: 'pct_insiders', label: 'Insider Holding', unit: '%', available: true, fmt: 'pct' },
      { key: '_promoter', label: 'Promoter Holding', unit: '%', available: false, fmt: 'pct' },
      { key: '_fii', label: 'FII Holding', unit: '%', available: false, fmt: 'pct' },
      { key: '_dii', label: 'DII Holding', unit: '%', available: false, fmt: 'pct' },
      { key: '_mf', label: 'Mutual Fund Holding', unit: '%', available: false, fmt: 'pct' },
      { key: '_public', label: 'Public Holding', unit: '%', available: false, fmt: 'pct' },
    ],
  },
  {
    id: 'size',
    title: 'Size & Liquidity',
    color: '#EAB308',
    metrics: [
      { key: 'volume', label: 'Volume', available: true, fmt: 'big' },
      { key: 'avg_volume', label: 'Average Volume', available: true, fmt: 'big' },
      { key: 'rvol', label: 'Relative Volume (RVOL)', unit: '×', available: true, fmt: 'ratio' },
      { key: 'shares_outstanding', label: 'Shares Outstanding', available: true, fmt: 'big' },
      { key: 'float_shares', label: 'Float Shares', available: true, fmt: 'big' },
      { key: '_free_float', label: 'Free Float %', unit: '%', available: false, fmt: 'pct' },
      { key: '_delivery', label: 'Delivery Percentage', unit: '%', available: false, fmt: 'pct' },
      { key: '_turnover', label: 'Turnover', available: false, fmt: 'big' },
    ],
  },
  {
    id: 'risk',
    title: 'Risk & Volatility',
    color: '#6366F1',
    metrics: [
      { key: 'beta', label: 'Beta', available: true, fmt: 'ratio' },
      { key: '_stddev', label: 'Standard Deviation', available: false, fmt: 'num' },
      { key: '_volatility', label: 'Volatility', unit: '%', available: false, fmt: 'pct' },
      { key: '_sharpe', label: 'Sharpe Ratio', available: false, fmt: 'ratio' },
      { key: '_sortino', label: 'Sortino Ratio', available: false, fmt: 'ratio' },
      { key: '_maxdd', label: 'Max Drawdown', unit: '%', available: false, fmt: 'pct' },
    ],
  },
];

// Flat lookup by key (available metrics only have real data).
export const METRIC_BY_KEY: Record<string, Metric> = (() => {
  const m: Record<string, Metric> = {};
  BUCKETS.forEach((b) => b.metrics.forEach((mt) => { m[mt.key] = mt; }));
  return m;
})();

export const AVAILABLE_COUNT = BUCKETS.reduce(
  (acc, b) => acc + b.metrics.filter((m) => m.available).length,
  0,
);
