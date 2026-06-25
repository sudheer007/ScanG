import { Stock } from '@/src/api';
import { fmtMarketCap } from '@/src/theme';
import { Metric, METRIC_BY_KEY } from './catalog';
import { ActiveFilters, Range } from './types';

// User-input units -> raw multiplier for a metric.
export function inputMul(m: Metric): number {
  if (m.scale) return 1 / m.scale;                       // margins: enter %, raw is fraction
  if (m.fmt === 'big' && (m.hint || '').includes('billion')) return 1e9; // enter billions
  return 1;
}

function rawThreshold(m: Metric, userVal: number): number {
  return userVal * inputMul(m);
}

// A stock passes a single metric range (user-entered values).
function passesRange(stock: Stock, key: string, rng: Range): boolean {
  const m = METRIC_BY_KEY[key];
  if (!m || !m.available) return true; // ignore unknown / coming-soon
  const raw = (stock as any)[key];
  if (raw === null || raw === undefined || Number.isNaN(raw)) return false;
  if (rng.min !== undefined && raw < rawThreshold(m, rng.min)) return false;
  if (rng.max !== undefined && raw > rawThreshold(m, rng.max)) return false;
  return true;
}

export function applyFilters(stocks: Stock[], filters: ActiveFilters): Stock[] {
  const entries = Object.entries(filters || {});
  if (entries.length === 0) return stocks;
  return stocks.filter((s) => {
    for (const [key, val] of entries) {
      if (key === 'sector') {
        if (val && (s.sector || '').toLowerCase() !== String(val).toLowerCase()) return false;
        continue;
      }
      if (typeof val === 'object' && val) {
        if (!passesRange(s, key, val as Range)) return false;
      }
    }
    return true;
  });
}

export function sortStocks(stocks: Stock[], sortKey: string, desc: boolean): Stock[] {
  const arr = [...stocks];
  arr.sort((a, b) => {
    const av = (a as any)[sortKey];
    const bv = (b as any)[sortKey];
    const an = av === null || av === undefined || Number.isNaN(av) ? (desc ? -Infinity : Infinity) : av;
    const bn = bv === null || bv === undefined || Number.isNaN(bv) ? (desc ? -Infinity : Infinity) : bv;
    if (an < bn) return desc ? 1 : -1;
    if (an > bn) return desc ? -1 : 1;
    return 0;
  });
  return arr;
}

// Count chips / active filter keys (excludes sector handled separately).
export function activeMetricKeys(filters: ActiveFilters): string[] {
  return Object.keys(filters || {}).filter((k) => k !== 'sector');
}

// Display a raw stock value for a given metric key.
export function fmtMetric(key: string, raw: any, currency: string = 'USD'): string {
  const m = METRIC_BY_KEY[key];
  if (raw === null || raw === undefined || Number.isNaN(raw)) return '—';
  if (!m) return String(raw);
  switch (m.fmt) {
    case 'big':
      return fmtMarketCap(raw, currency);
    case 'money': {
      const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '';
      const abs = Math.abs(raw);
      return sym + raw.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : 2 });
    }
    case 'pct': {
      const v = raw * (m.scale || 1);
      const s = v >= 0 ? '' : '';
      return `${s}${v.toFixed(m.decimals ?? 1)}%`;
    }
    case 'ratio':
      return `${raw.toFixed(m.decimals ?? 2)}${m.unit === '×' ? '×' : ''}`;
    case 'int':
      return String(Math.round(raw));
    case 'num':
    default:
      return raw.toFixed(m.decimals ?? 2);
  }
}

// Chip label for an active filter.
export function chipLabel(key: string, val: Range | string): string {
  if (key === 'sector') return `Sector: ${val}`;
  const m = METRIC_BY_KEY[key];
  const label = m?.label || key;
  const r = val as Range;
  const u = m?.unit || '';
  const lo = r.min;
  const hi = r.max;
  if (lo !== undefined && hi !== undefined) return `${label}: ${lo}–${hi}${u}`;
  if (lo !== undefined) return `${label} ≥ ${lo}${u}`;
  if (hi !== undefined) return `${label} ≤ ${hi}${u}`;
  return label;
}
