import type { LiveQuote } from '@/src/api';

/** Merge live price fields into existing list rows (keeps sparklines / fundamentals). */
export function mergeLiveQuotes<T extends { symbol: string }>(
  rows: T[],
  quotes: LiveQuote[],
): T[] {
  if (!rows.length || !quotes.length) return rows;
  const map = new Map(quotes.map((q) => [q.symbol, q]));
  let changed = false;
  const next = rows.map((row) => {
    const q = map.get(row.symbol);
    if (!q) return row;
    changed = true;
    return {
      ...row,
      price: q.price,
      change: q.change,
      change_pct: q.change_pct,
      ...(q.volume != null ? { volume: q.volume } : {}),
      ...(q.currency ? { currency: q.currency } : {}),
    };
  });
  return changed ? next : rows;
}

const DETAIL_LIST_KEYS = [
  'buy', 'hold', 'sell', 'stocks', 'undervalued', 'overvalued',
  'gainers', 'losers', 'top', 'bottom', 'items',
  'upgrades', 'downgrades', 'all', 'events',
] as const;

function pushSymbols(out: string[], rows: any[] | undefined) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (row?.symbol) out.push(row.symbol);
  }
}

/** Collect up to 49 unique symbols from a Discover detail payload. */
export function collectDiscoverDetailSymbols(data: any): string[] {
  if (!data) return [];
  const raw: string[] = [];
  for (const key of DETAIL_LIST_KEYS) pushSymbols(raw, data[key]);
  if (data.portfolios && typeof data.portfolios === 'object') {
    for (const p of Object.values(data.portfolios) as any[]) {
      pushSymbols(raw, p?.stocks);
    }
  }
  if (data.by_type && typeof data.by_type === 'object') {
    for (const rows of Object.values(data.by_type) as any[]) pushSymbols(raw, rows);
  }
  if (data.by_week && typeof data.by_week === 'object') {
    for (const rows of Object.values(data.by_week) as any[]) pushSymbols(raw, rows);
  }
  if (Array.isArray(data.screeners)) {
    for (const s of data.screeners) pushSymbols(raw, s?.top);
  }
  return Array.from(new Set(raw)).slice(0, 49);
}

/** Patch price fields across Discover detail list shapes. */
export function patchDiscoverDetailQuotes(data: any, quotes: LiveQuote[]): any {
  if (!data || !quotes.length) return data;
  const next: any = { ...data };
  for (const key of DETAIL_LIST_KEYS) {
    if (Array.isArray(data[key])) next[key] = mergeLiveQuotes(data[key], quotes);
  }
  if (data.portfolios && typeof data.portfolios === 'object') {
    next.portfolios = { ...data.portfolios };
    for (const [k, p] of Object.entries(data.portfolios as Record<string, any>)) {
      next.portfolios[k] = {
        ...p,
        stocks: mergeLiveQuotes(p?.stocks || [], quotes),
      };
    }
  }
  if (data.by_type && typeof data.by_type === 'object') {
    next.by_type = { ...data.by_type };
    for (const [k, rows] of Object.entries(data.by_type as Record<string, any[]>)) {
      next.by_type[k] = mergeLiveQuotes(rows || [], quotes);
    }
  }
  if (data.by_week && typeof data.by_week === 'object') {
    next.by_week = { ...data.by_week };
    for (const [k, rows] of Object.entries(data.by_week as Record<string, any[]>)) {
      next.by_week[k] = mergeLiveQuotes(rows || [], quotes);
    }
  }
  if (Array.isArray(data.screeners)) {
    next.screeners = data.screeners.map((s: any) => ({
      ...s,
      top: mergeLiveQuotes(s?.top || [], quotes),
    }));
  }
  return next;
}

/** Collect symbols shown on the Discover feed + extras. */
export function collectDiscoverFeedSymbols(feed: any, extra: any): string[] {
  const raw: string[] = [];
  const w = feed?.widgets || {};
  pushSymbols(raw, w.ai_picks?.preview);
  pushSymbols(raw, w.events?.preview);
  pushSymbols(raw, w.analyst_ratings?.preview);
  pushSymbols(raw, w.most_active?.preview);
  pushSymbols(raw, w.winners_losers?.gainers);
  pushSymbols(raw, w.winners_losers?.losers);
  pushSymbols(raw, w.valuation?.undervalued);
  pushSymbols(raw, w.valuation?.overvalued);
  if (Array.isArray(w.investor_picks?.preview)) {
    for (const p of w.investor_picks.preview) pushSymbols(raw, p?.top);
  }
  if (Array.isArray(w.popular_screeners?.preview)) {
    for (const s of w.popular_screeners.preview) pushSymbols(raw, s?.top);
  }
  pushSymbols(raw, extra?.forecast?.top);
  pushSymbols(raw, extra?.forecast?.bottom);
  pushSymbols(raw, extra?.earnings?.items);
  pushSymbols(raw, extra?.dividend?.items);
  return Array.from(new Set(raw)).slice(0, 49);
}

export function patchDiscoverFeedQuotes(feed: any, quotes: LiveQuote[]): any {
  if (!feed?.widgets || !quotes.length) return feed;
  const w = feed.widgets;
  const nextW: any = { ...w };
  if (w.ai_picks?.preview) {
    nextW.ai_picks = { ...w.ai_picks, preview: mergeLiveQuotes(w.ai_picks.preview, quotes) };
  }
  if (w.events?.preview) {
    nextW.events = { ...w.events, preview: mergeLiveQuotes(w.events.preview, quotes) };
  }
  if (w.analyst_ratings?.preview) {
    nextW.analyst_ratings = {
      ...w.analyst_ratings,
      preview: mergeLiveQuotes(w.analyst_ratings.preview, quotes),
    };
  }
  if (w.most_active?.preview) {
    nextW.most_active = { ...w.most_active, preview: mergeLiveQuotes(w.most_active.preview, quotes) };
  }
  if (w.winners_losers) {
    nextW.winners_losers = {
      ...w.winners_losers,
      gainers: mergeLiveQuotes(w.winners_losers.gainers || [], quotes),
      losers: mergeLiveQuotes(w.winners_losers.losers || [], quotes),
    };
  }
  if (w.valuation) {
    nextW.valuation = {
      ...w.valuation,
      undervalued: mergeLiveQuotes(w.valuation.undervalued || [], quotes),
      overvalued: mergeLiveQuotes(w.valuation.overvalued || [], quotes),
    };
  }
  if (Array.isArray(w.investor_picks?.preview)) {
    nextW.investor_picks = {
      ...w.investor_picks,
      preview: w.investor_picks.preview.map((p: any) => ({
        ...p,
        top: mergeLiveQuotes(p?.top || [], quotes),
      })),
    };
  }
  if (Array.isArray(w.popular_screeners?.preview)) {
    nextW.popular_screeners = {
      ...w.popular_screeners,
      preview: w.popular_screeners.preview.map((s: any) => ({
        ...s,
        top: mergeLiveQuotes(s?.top || [], quotes),
      })),
    };
  }
  return { ...feed, widgets: nextW };
}

export function patchDiscoverExtraQuotes(extra: any, quotes: LiveQuote[]): any {
  if (!extra || !quotes.length) return extra;
  const next: any = { ...extra };
  if (extra.forecast) {
    next.forecast = {
      ...extra.forecast,
      top: mergeLiveQuotes(extra.forecast.top || [], quotes),
      bottom: mergeLiveQuotes(extra.forecast.bottom || [], quotes),
    };
  }
  if (extra.earnings?.items) {
    next.earnings = {
      ...extra.earnings,
      items: mergeLiveQuotes(extra.earnings.items, quotes),
    };
  }
  if (extra.dividend?.items) {
    next.dividend = {
      ...extra.dividend,
      items: mergeLiveQuotes(extra.dividend.items, quotes),
    };
  }
  return next;
}
