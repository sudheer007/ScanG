// Ready-made "Quick Screens" — tap to auto-populate filters with sensible values.
// Filter values are in display/input units (same as what a user types in the sheet).
import { ActiveFilters } from './types';

export interface Preset {
  id: string;
  name: string;
  icon: string;       // Ionicons name
  color: string;
  blurb: string;
  filters: ActiveFilters;
}

export const PRESETS: Preset[] = [
  {
    id: 'quality',
    name: 'Quality Compounders',
    icon: 'ribbon',
    color: '#10B981',
    blurb: 'High ROE, low debt, fat margins.',
    filters: { roe: { min: 18 }, debt_to_equity: { max: 80 }, profit_margin: { min: 10 }, pe: { max: 40 } },
  },
  {
    id: 'value',
    name: 'Deep Value',
    icon: 'diamond',
    color: '#3B82F6',
    blurb: 'Cheap on earnings & book value.',
    filters: { pe: { max: 15 }, pb: { max: 2.5 }, dividend_yield: { min: 0.5 } },
  },
  {
    id: 'growth',
    name: 'High-Growth Momentum',
    icon: 'rocket',
    color: '#8B5CF6',
    blurb: 'Fast growers trading near highs.',
    filters: { revenue_growth: { min: 15 }, eps_growth: { min: 15 }, from_52w_high_pct: { min: -15 }, rsi: { min: 50, max: 80 } },
  },
  {
    id: 'dividend',
    name: 'Dividend Cash Cows',
    icon: 'cash',
    color: '#14B8A6',
    blurb: 'Sustainable, high dividend yield.',
    filters: { dividend_yield: { min: 3 }, payout_ratio: { max: 75 }, free_cashflow: { min: 0 } },
  },
  {
    id: 'oversold',
    name: 'Oversold Bounce',
    icon: 'trending-down',
    color: '#F59E0B',
    blurb: 'Beaten-down but profitable names.',
    filters: { rsi: { max: 35 }, from_52w_low_pct: { max: 25 }, roe: { min: 8 } },
  },
  {
    id: 'megacap',
    name: 'Mega-Cap Stability',
    icon: 'shield-checkmark',
    color: '#6366F1',
    blurb: 'Large, steady, low-beta leaders.',
    filters: { market_cap: { min: 100 }, beta: { max: 1.1 }, roe: { min: 12 } },
  },
  {
    id: 'profit',
    name: 'Profit Machines',
    icon: 'flame',
    color: '#EAB308',
    blurb: 'Elite operating & net margins.',
    filters: { profit_margin: { min: 20 }, operating_margin: { min: 20 }, roe: { min: 15 } },
  },
  {
    id: 'breakout',
    name: '52-Week Breakouts',
    icon: 'flash',
    color: '#06B6D4',
    blurb: 'Surging into fresh new highs.',
    filters: { from_52w_high_pct: { min: -3 }, one_year_change_pct: { min: 20 }, rvol: { min: 1.2 } },
  },
  {
    id: 'garp',
    name: 'GARP — Reasonable Growth',
    icon: 'pulse',
    color: '#D946EF',
    blurb: 'Growth at a reasonable price.',
    filters: { peg_ratio: { max: 1.5 }, eps_growth: { min: 12 }, pe: { max: 30 } },
  },
  {
    id: 'cashrich',
    name: 'Cash Generators',
    icon: 'leaf',
    color: '#34D399',
    blurb: 'Strong, cheap free cash flow.',
    filters: { p_fcf: { min: 0, max: 20 }, free_cashflow: { min: 0 }, operating_cashflow: { min: 0 } },
  },
];
