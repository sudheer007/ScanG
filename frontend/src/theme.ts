// Centralised design tokens from /app/design_guidelines.json
export const theme = {
  colors: {
    bg: '#0A0A0C',
    bg2: '#141417',
    bg3: '#202024',
    text: '#FAFAFA',
    textMuted: '#A1A1AA',
    textSubtle: '#71717A',
    border: '#27272A',
    borderStrong: '#3F3F46',
    divider: '#1F1F22',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    accentBg: '#0E1F1A', // for badges
    radar: '#34D399',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    // Use system font, prefer monospaced numerics for data
    body: undefined as undefined | string,
  },
};

export const fmtPrice = (v: number | null | undefined, currency: string = 'USD') => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return symbol + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return symbol + v.toFixed(2);
};

export const fmtPct = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
};

export const fmtNum = (v: number | null | undefined, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
};

export const fmtMarketCap = (v: number | null | undefined, currency: string = 'USD') => {
  if (!v) return '—';
  const symbol = currency === 'INR' ? '₹' : '$';
  if (v >= 1e12) return `${symbol}${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${symbol}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e7 && currency === 'INR') return `${symbol}${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e6) return `${symbol}${(v / 1e6).toFixed(2)}M`;
  return `${symbol}${v.toFixed(0)}`;
};

export const changeColor = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return theme.colors.textMuted;
  return v >= 0 ? theme.colors.success : theme.colors.error;
};
