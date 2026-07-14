/** Shared calculator math + INR formatting. */

export type CalcResult = {
  invested: number;
  maturity: number;
  gains: number;
  returnsPct: number;
};

function toResult(invested: number, maturity: number): CalcResult {
  const safeInvested = Math.max(0, invested);
  const safeMaturity = Math.max(0, maturity);
  const gains = safeMaturity - safeInvested;
  const returnsPct = safeMaturity > 0 ? (gains / safeMaturity) * 100 : 0;
  return { invested: safeInvested, maturity: safeMaturity, gains, returnsPct };
}

/** Future value of a monthly SIP (annuity due style with (1+r) factor). */
export function calcSip(monthly: number, annualRatePct: number, years: number): CalcResult {
  const months = Math.max(0, Math.round(years * 12));
  const invested = Math.max(0, monthly) * months;
  const r = annualRatePct / 100 / 12;

  let maturity = 0;
  if (months === 0 || monthly <= 0) {
    maturity = 0;
  } else if (r === 0) {
    maturity = invested;
  } else {
    maturity = monthly * ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
  }

  return toResult(invested, maturity);
}

/**
 * ETF buy-and-hold with optional monthly top-ups.
 * Lumpsum grows monthly; each contribution compounds for remaining months.
 */
export function calcEtf(
  lumpsum: number,
  monthly: number,
  annualRatePct: number,
  years: number,
): CalcResult {
  const months = Math.max(0, Math.round(years * 12));
  const p = Math.max(0, lumpsum);
  const m = Math.max(0, monthly);
  const invested = p + m * months;
  const r = annualRatePct / 100 / 12;

  let maturity = 0;
  if (months === 0) {
    maturity = p;
  } else if (r === 0) {
    maturity = invested;
  } else {
    const lumpsumFv = p * Math.pow(1 + r, months);
    const sipFv = m > 0 ? m * ((Math.pow(1 + r, months) - 1) / r) * (1 + r) : 0;
    maturity = lumpsumFv + sipFv;
  }

  return toResult(invested, maturity);
}

/**
 * Bond held to maturity with annual coupons (simple interest on face value).
 * Maturity value = face + total coupons received over the tenure.
 */
export function calcBond(faceValue: number, couponRatePct: number, years: number): CalcResult {
  const p = Math.max(0, faceValue);
  const y = Math.max(0, years);
  const coupons = p * (couponRatePct / 100) * y;
  return toResult(p, p + coupons);
}

/**
 * Fixed deposit with quarterly compounding (common Indian bank FD convention).
 * A = P × (1 + r/4)^(4t)
 */
export function calcFd(principal: number, annualRatePct: number, years: number): CalcResult {
  const p = Math.max(0, principal);
  const t = Math.max(0, years);
  const r = annualRatePct / 100;
  const n = 4;
  const maturity = t === 0 || p === 0 ? p : p * Math.pow(1 + r / n, n * t);
  return toResult(p, maturity);
}

/** Indian-style compact currency for calculator results. */
export function fmtInrCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 999 * 1e7) return `${sign}> ₹999Cr`;
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function fmtInrFull(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹ ${Math.round(n).toLocaleString('en-IN')}`;
}

export function fmtRate(v: number): string {
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} % p.a.`;
}

export function fmtYears(v: number): string {
  return `${v} ${v === 1 ? 'year' : 'years'}`;
}
