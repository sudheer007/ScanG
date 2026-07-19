"""Fundamentals engine — institutional-grade analysis from Yahoo financial statements.

Data source: Yahoo fundamentals-timeseries API (via curl_cffi, same session/crumb
infrastructure as stock_service). Pulls up to 5y annual + 5q quarterly statements.

Computed on top of raw statements (all pure functions, unit-testable offline):
- Piotroski F-Score (9 binary checks with evidence)
- Altman Z-Score (with component breakdown + zone)
- Earnings quality (accruals ratio, cash conversion)
- Trajectories (margins, ROIC, leverage, revenue growth, FCF, share count)
- DCF intrinsic value (two-stage, adjustable assumptions)
- Red-flag detector (receivables divergence, dilution, interest coverage, ...)
- Peer comparison (sector peers ranked on valuation / growth / quality)
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache

import stock_service as ss
from stock_service import _get_session, _safe
from stock_universe import currency

log = logging.getLogger(__name__)

STATEMENTS_CACHE = TTLCache(maxsize=600, ttl=6 * 60 * 60)   # raw statements, 6h
FUNDAMENTALS_CACHE = TTLCache(maxsize=600, ttl=60 * 60)     # assembled payload, 1h
PEERS_CACHE = TTLCache(maxsize=600, ttl=30 * 60)            # peer tables, 30 min

# ---------------------------------------------------------------------------
# Yahoo fundamentals-timeseries fetch
# ---------------------------------------------------------------------------

_ANNUAL_METRICS = [
    # Income statement
    "TotalRevenue", "CostOfRevenue", "GrossProfit", "OperatingIncome",
    "NetIncome", "EBIT", "EBITDA", "InterestExpense", "PretaxIncome",
    "TaxProvision", "DilutedAverageShares",
    # Balance sheet
    "TotalAssets", "CurrentAssets", "CurrentLiabilities",
    "TotalLiabilitiesNetMinorityInterest", "StockholdersEquity",
    "LongTermDebt", "TotalDebt", "CashAndCashEquivalents",
    "AccountsReceivable", "Inventory", "RetainedEarnings",
    "InvestedCapital", "WorkingCapital", "OrdinarySharesNumber",
    # Cash flow
    "OperatingCashFlow", "CapitalExpenditure", "FreeCashFlow",
    "CashDividendsPaid", "RepurchaseOfCapitalStock",
]

_QUARTERLY_METRICS = [
    "TotalRevenue", "GrossProfit", "OperatingIncome", "NetIncome",
    "OperatingCashFlow", "FreeCashFlow", "AccountsReceivable",
    "TotalAssets", "TotalDebt", "StockholdersEquity", "OrdinarySharesNumber",
]

# Series type: metric -> list of {"date": "YYYY-MM-DD", "value": float}, ascending by date
Series = Dict[str, List[Dict[str, Any]]]


def _fetch_timeseries(symbol: str) -> Dict[str, Series]:
    """Fetch annual + quarterly statement series from Yahoo. Cached 6h."""
    if symbol in STATEMENTS_CACHE:
        return STATEMENTS_CACHE[symbol]

    types = [f"annual{m}" for m in _ANNUAL_METRICS] + [f"quarterly{m}" for m in _QUARTERLY_METRICS]
    now = int(time.time())
    s = _get_session()
    url = f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}"
    params = {
        "type": ",".join(types),
        "period1": str(now - 6 * 365 * 24 * 3600),  # 6y back to be safe
        "period2": str(now),
        "merge": "false",
        "padTimeSeries": "false",
    }
    annual: Series = {}
    quarterly: Series = {}
    try:
        r = s.get(url, params=params)
        if r.status_code != 200:
            log.warning(f"timeseries {symbol} status {r.status_code}")
            out = {"annual": annual, "quarterly": quarterly}
            return out
        results = r.json().get("timeseries", {}).get("result", []) or []
        for item in results:
            meta_types = (item.get("meta", {}) or {}).get("type") or []
            if not meta_types:
                continue
            tname = meta_types[0]
            rows = item.get(tname) or []
            points = []
            for row in rows:
                if not row:
                    continue
                val = _safe((row.get("reportedValue") or {}).get("raw"))
                as_of = row.get("asOfDate")
                if val is None or not as_of:
                    continue
                points.append({"date": as_of, "value": val})
            if not points:
                continue
            points.sort(key=lambda p: p["date"])
            if tname.startswith("annual"):
                annual[tname[len("annual"):]] = points
            elif tname.startswith("quarterly"):
                quarterly[tname[len("quarterly"):]] = points
    except Exception as e:
        log.warning(f"timeseries {symbol} err: {e}")

    out = {"annual": annual, "quarterly": quarterly}
    if annual:  # only cache non-empty results
        STATEMENTS_CACHE[symbol] = out
    return out


# ---------------------------------------------------------------------------
# Series helpers (pure)
# ---------------------------------------------------------------------------

def _v(series: Series, metric: str, i: int = -1) -> Optional[float]:
    """Value of `metric` at index i (-1 = latest, -2 = prior, ...)."""
    pts = series.get(metric) or []
    if len(pts) < abs(i):
        return None
    try:
        return pts[i]["value"]
    except IndexError:
        return None


def _pair(series: Series, metric: str) -> Tuple[Optional[float], Optional[float]]:
    """(latest, prior) values for a metric."""
    return _v(series, metric, -1), _v(series, metric, -2)


def _ratio(num: Optional[float], den: Optional[float]) -> Optional[float]:
    if num is None or den is None or den == 0:
        return None
    return num / den


def _growth_pct(curr: Optional[float], prev: Optional[float]) -> Optional[float]:
    if curr is None or prev is None or prev == 0:
        return None
    return (curr - prev) / abs(prev) * 100


# ---------------------------------------------------------------------------
# Piotroski F-Score
# ---------------------------------------------------------------------------

def compute_piotroski(annual: Series) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []

    def add(name: str, passed: Optional[bool], detail: str):
        checks.append({"name": name, "passed": bool(passed) if passed is not None else None, "detail": detail})

    ni, ni_prev = _pair(annual, "NetIncome")
    ta, ta_prev = _pair(annual, "TotalAssets")
    ta_prev2 = _v(annual, "TotalAssets", -3)
    ocf = _v(annual, "OperatingCashFlow")
    ltd, ltd_prev = _pair(annual, "LongTermDebt")
    ca, ca_prev = _pair(annual, "CurrentAssets")
    cl, cl_prev = _pair(annual, "CurrentLiabilities")
    shares, shares_prev = _pair(annual, "OrdinarySharesNumber")
    if shares is None:
        shares, shares_prev = _pair(annual, "DilutedAverageShares")
    gp, gp_prev = _pair(annual, "GrossProfit")
    rev, rev_prev = _pair(annual, "TotalRevenue")

    # 1. Positive ROA
    roa = _ratio(ni, ta)
    add("Positive ROA", roa is not None and roa > 0,
        f"ROA {roa * 100:.1f}%" if roa is not None else "insufficient data")

    # 2. Positive operating cash flow
    add("Positive operating cash flow", ocf is not None and ocf > 0,
        f"OCF {ocf / 1e9:.2f}B" if ocf is not None else "insufficient data")

    # 3. ROA improving
    roa_prev = _ratio(ni_prev, ta_prev)
    ok = roa is not None and roa_prev is not None and roa > roa_prev
    add("ROA improving", ok if (roa is not None and roa_prev is not None) else None,
        f"{roa_prev * 100:.1f}% → {roa * 100:.1f}%" if (roa is not None and roa_prev is not None) else "insufficient data")

    # 4. OCF > net income (earnings backed by cash)
    ok = ocf is not None and ni is not None and ocf > ni
    add("Cash flow exceeds net income", ok if (ocf is not None and ni is not None) else None,
        f"OCF {ocf / 1e9:.2f}B vs NI {ni / 1e9:.2f}B" if (ocf is not None and ni is not None) else "insufficient data")

    # 5. Leverage decreasing (LTD / assets)
    lev = _ratio(ltd, ta)
    lev_prev = _ratio(ltd_prev, ta_prev)
    if ltd is None and ltd_prev is None:
        # No long-term debt at all counts as a pass
        add("Leverage decreasing", True, "no long-term debt reported")
    else:
        ok = lev is not None and lev_prev is not None and lev <= lev_prev
        add("Leverage decreasing", ok if (lev is not None and lev_prev is not None) else None,
            f"LTD/assets {lev_prev * 100:.1f}% → {lev * 100:.1f}%" if (lev is not None and lev_prev is not None) else "insufficient data")

    # 6. Current ratio improving
    cr = _ratio(ca, cl)
    cr_prev = _ratio(ca_prev, cl_prev)
    ok = cr is not None and cr_prev is not None and cr > cr_prev
    add("Current ratio improving", ok if (cr is not None and cr_prev is not None) else None,
        f"{cr_prev:.2f} → {cr:.2f}" if (cr is not None and cr_prev is not None) else "insufficient data")

    # 7. No significant dilution (shares not up more than 1%)
    ok = shares is not None and shares_prev is not None and shares <= shares_prev * 1.01
    add("No share dilution", ok if (shares is not None and shares_prev is not None) else None,
        f"shares {shares_prev / 1e6:.0f}M → {shares / 1e6:.0f}M" if (shares is not None and shares_prev is not None) else "insufficient data")

    # 8. Gross margin improving
    gm = _ratio(gp, rev)
    gm_prev = _ratio(gp_prev, rev_prev)
    ok = gm is not None and gm_prev is not None and gm > gm_prev
    add("Gross margin improving", ok if (gm is not None and gm_prev is not None) else None,
        f"{gm_prev * 100:.1f}% → {gm * 100:.1f}%" if (gm is not None and gm_prev is not None) else "insufficient data")

    # 9. Asset turnover improving (Piotroski scales by beginning-of-year assets)
    at = _ratio(rev, ta_prev if ta_prev is not None else ta)
    at_prev = _ratio(rev_prev, ta_prev2 if ta_prev2 is not None else ta_prev)
    ok = at is not None and at_prev is not None and at > at_prev
    add("Asset turnover improving", ok if (at is not None and at_prev is not None) else None,
        f"{at_prev:.2f} → {at:.2f}" if (at is not None and at_prev is not None) else "insufficient data")

    score = sum(1 for c in checks if c["passed"])
    evaluated = sum(1 for c in checks if c["passed"] is not None)
    if score >= 7:
        label = "strong"
    elif score >= 5:
        label = "moderate"
    else:
        label = "weak"
    return {"score": score, "max": 9, "evaluated": evaluated, "label": label, "checks": checks}


# ---------------------------------------------------------------------------
# Altman Z-Score
# ---------------------------------------------------------------------------

def compute_altman(annual: Series, market_cap: Optional[float]) -> Dict[str, Any]:
    ta = _v(annual, "TotalAssets")
    tl = _v(annual, "TotalLiabilitiesNetMinorityInterest")
    wc = _v(annual, "WorkingCapital")
    if wc is None:
        ca, cl = _v(annual, "CurrentAssets"), _v(annual, "CurrentLiabilities")
        wc = (ca - cl) if (ca is not None and cl is not None) else None
    re = _v(annual, "RetainedEarnings")
    ebit = _v(annual, "EBIT")
    if ebit is None:
        ebit = _v(annual, "OperatingIncome")
    rev = _v(annual, "TotalRevenue")

    if ta is None or ta == 0 or tl is None or tl == 0:
        return {"score": None, "zone": None, "components": {}, "detail": "insufficient balance sheet data"}

    a = _ratio(wc, ta)
    b = _ratio(re, ta)
    c = _ratio(ebit, ta)
    d = _ratio(market_cap, tl)
    e = _ratio(rev, ta)

    parts = {"working_capital_to_assets": a, "retained_earnings_to_assets": b,
             "ebit_to_assets": c, "market_cap_to_liabilities": d, "revenue_to_assets": e}
    if any(x is None for x in (a, b, c, d, e)):
        return {"score": None, "zone": None, "components": parts, "detail": "missing component data"}

    z = 1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e
    zone = "safe" if z > 2.99 else ("grey" if z >= 1.81 else "distress")
    return {"score": round(z, 2), "zone": zone, "components": {k: round(v, 3) for k, v in parts.items()}, "detail": None}


# ---------------------------------------------------------------------------
# Earnings quality
# ---------------------------------------------------------------------------

def compute_earnings_quality(annual: Series) -> Dict[str, Any]:
    ni = _v(annual, "NetIncome")
    ocf = _v(annual, "OperatingCashFlow")
    ta = _v(annual, "TotalAssets")

    accruals_ratio = None
    if ni is not None and ocf is not None and ta:
        accruals_ratio = (ni - ocf) / abs(ta)

    cash_conversion = _ratio(ocf, ni) if (ni is not None and ni > 0) else None

    if accruals_ratio is None:
        label = None
    elif accruals_ratio < 0:
        label = "high"       # cash flow exceeds reported earnings
    elif accruals_ratio < 0.05:
        label = "adequate"
    else:
        label = "low"        # earnings running well ahead of cash
    return {
        "accruals_ratio": round(accruals_ratio, 4) if accruals_ratio is not None else None,
        "cash_conversion": round(cash_conversion, 2) if cash_conversion is not None else None,
        "label": label,
    }


# ---------------------------------------------------------------------------
# Trajectories (per-year series for charts)
# ---------------------------------------------------------------------------

def compute_trajectories(annual: Series) -> Dict[str, Any]:
    revs = annual.get("TotalRevenue") or []
    out: Dict[str, List[Dict[str, Any]]] = {
        "revenue": [], "revenue_growth_pct": [], "gross_margin_pct": [],
        "operating_margin_pct": [], "net_margin_pct": [], "roic_pct": [],
        "debt_to_equity": [], "fcf": [], "shares": [], "interest_coverage": [],
    }
    by_date = {m: {p["date"]: p["value"] for p in (annual.get(m) or [])} for m in (
        "TotalRevenue", "GrossProfit", "OperatingIncome", "NetIncome", "EBIT",
        "TaxProvision", "PretaxIncome", "InvestedCapital", "TotalDebt",
        "StockholdersEquity", "FreeCashFlow", "OrdinarySharesNumber",
        "DilutedAverageShares", "InterestExpense",
    )}

    prev_rev = None
    for p in revs:
        d, rev = p["date"], p["value"]
        out["revenue"].append({"date": d, "value": rev})
        g = _growth_pct(rev, prev_rev)
        if g is not None:
            out["revenue_growth_pct"].append({"date": d, "value": round(g, 1)})
        prev_rev = rev

        gp = by_date["GrossProfit"].get(d)
        if gp is not None and rev:
            out["gross_margin_pct"].append({"date": d, "value": round(gp / rev * 100, 1)})
        oi = by_date["OperatingIncome"].get(d)
        if oi is not None and rev:
            out["operating_margin_pct"].append({"date": d, "value": round(oi / rev * 100, 1)})
        ni = by_date["NetIncome"].get(d)
        if ni is not None and rev:
            out["net_margin_pct"].append({"date": d, "value": round(ni / rev * 100, 1)})

        # ROIC = NOPAT / invested capital; NOPAT = EBIT * (1 - effective tax rate)
        ebit = by_date["EBIT"].get(d) or by_date["OperatingIncome"].get(d)
        ic = by_date["InvestedCapital"].get(d)
        tax, pretax = by_date["TaxProvision"].get(d), by_date["PretaxIncome"].get(d)
        if ebit is not None and ic:
            tax_rate = (tax / pretax) if (tax is not None and pretax) else 0.21
            tax_rate = min(max(tax_rate, 0.0), 0.6)
            out["roic_pct"].append({"date": d, "value": round(ebit * (1 - tax_rate) / ic * 100, 1)})

        td, se = by_date["TotalDebt"].get(d), by_date["StockholdersEquity"].get(d)
        if td is not None and se:
            out["debt_to_equity"].append({"date": d, "value": round(td / se, 2)})

        fcf = by_date["FreeCashFlow"].get(d)
        if fcf is not None:
            out["fcf"].append({"date": d, "value": fcf})

        sh = by_date["OrdinarySharesNumber"].get(d) or by_date["DilutedAverageShares"].get(d)
        if sh is not None:
            out["shares"].append({"date": d, "value": sh})

        ie = by_date["InterestExpense"].get(d)
        if ebit is not None and ie:
            out["interest_coverage"].append({"date": d, "value": round(ebit / ie, 1)})

    return out


# ---------------------------------------------------------------------------
# DCF intrinsic value
# ---------------------------------------------------------------------------

def default_growth_assumption(annual: Series) -> float:
    """Starting growth: historical revenue CAGR clamped to [2, 20] %."""
    revs = annual.get("TotalRevenue") or []
    if len(revs) >= 2 and revs[0]["value"] > 0:
        years = max(len(revs) - 1, 1)
        cagr = ((revs[-1]["value"] / revs[0]["value"]) ** (1 / years) - 1) * 100
        return round(min(max(cagr, 2.0), 20.0), 1)
    return 6.0


def compute_dcf(
    annual: Series,
    price: Optional[float],
    shares_outstanding: Optional[float],
    growth_pct: Optional[float] = None,
    discount_pct: float = 10.0,
    terminal_growth_pct: float = 2.5,
    years: int = 10,
) -> Dict[str, Any]:
    """Two-stage DCF on free cash flow. Stage 1 (5y) at growth_pct,
    stage 2 fades linearly to terminal growth, Gordon terminal value after."""
    fcf = _v(annual, "FreeCashFlow")
    if fcf is None:
        ocf, capex = _v(annual, "OperatingCashFlow"), _v(annual, "CapitalExpenditure")
        if ocf is not None and capex is not None:
            fcf = ocf + capex if capex < 0 else ocf - capex
    # Smooth with prior year when available (one bad year shouldn't dominate)
    fcf_prev = _v(annual, "FreeCashFlow", -2)
    base_fcf = fcf
    if fcf is not None and fcf_prev is not None and fcf_prev > 0 and fcf > 0:
        base_fcf = (fcf + fcf_prev) / 2

    if growth_pct is None:
        growth_pct = default_growth_assumption(annual)

    assumptions = {
        "base_fcf": base_fcf,
        "growth_pct": round(growth_pct, 1),
        "discount_pct": round(discount_pct, 1),
        "terminal_growth_pct": round(terminal_growth_pct, 1),
        "years": years,
    }

    if base_fcf is None or base_fcf <= 0:
        return {"available": False, "reason": "negative or missing free cash flow", "assumptions": assumptions}
    if discount_pct <= terminal_growth_pct:
        return {"available": False, "reason": "discount rate must exceed terminal growth", "assumptions": assumptions}
    if not shares_outstanding:
        shares_outstanding = _v(annual, "OrdinarySharesNumber") or _v(annual, "DilutedAverageShares")
    if not shares_outstanding:
        return {"available": False, "reason": "share count unavailable", "assumptions": assumptions}

    r = discount_pct / 100
    g1 = growth_pct / 100
    gt = terminal_growth_pct / 100
    stage1 = min(5, years)

    pv_total = 0.0
    f = base_fcf
    projections = []
    for yr in range(1, years + 1):
        if yr <= stage1:
            g = g1
        else:
            # fade linearly from g1 to gt over the remaining years
            frac = (yr - stage1) / max(years - stage1, 1)
            g = g1 + (gt - g1) * frac
        f = f * (1 + g)
        pv = f / ((1 + r) ** yr)
        pv_total += pv
        projections.append({"year": yr, "fcf": round(f), "pv": round(pv)})

    terminal_value = f * (1 + gt) / (r - gt)
    pv_terminal = terminal_value / ((1 + r) ** years)
    equity_value = pv_total + pv_terminal
    per_share = equity_value / shares_outstanding

    upside_pct = None
    if price and price > 0:
        upside_pct = round((per_share / price - 1) * 100, 1)

    return {
        "available": True,
        "assumptions": assumptions,
        "intrinsic_value_per_share": round(per_share, 2),
        "price": price,
        "upside_pct": upside_pct,
        "pv_stage_cashflows": round(pv_total),
        "pv_terminal_value": round(pv_terminal),
        "terminal_value_share_pct": round(pv_terminal / equity_value * 100, 1),
        "projections": projections,
        "verdict": (
            "undervalued" if upside_pct is not None and upside_pct > 15 else
            "overvalued" if upside_pct is not None and upside_pct < -15 else
            "fairly valued" if upside_pct is not None else None
        ),
    }


# ---------------------------------------------------------------------------
# Red-flag detector
# ---------------------------------------------------------------------------

def detect_red_flags(annual: Series, quarterly: Series) -> List[Dict[str, Any]]:
    flags: List[Dict[str, Any]] = []

    def add(severity: str, title: str, detail: str):
        flags.append({"severity": severity, "title": title, "detail": detail})

    # 1. Receivables growing much faster than revenue (possible channel stuffing)
    ar, ar_prev = _pair(annual, "AccountsReceivable")
    rev, rev_prev = _pair(annual, "TotalRevenue")
    ar_g, rev_g = _growth_pct(ar, ar_prev), _growth_pct(rev, rev_prev)
    if ar_g is not None and rev_g is not None and ar_g > rev_g + 20 and ar_g > 15:
        add("high", "Receivables outpacing revenue",
            f"Receivables grew {ar_g:.0f}% vs revenue {rev_g:.0f}% — revenue quality may be deteriorating")

    # 2. Share dilution
    sh, sh_prev = _pair(annual, "OrdinarySharesNumber")
    if sh is None:
        sh, sh_prev = _pair(annual, "DilutedAverageShares")
    dil = _growth_pct(sh, sh_prev)
    if dil is not None and dil > 3:
        add("medium", "Shareholder dilution", f"Share count up {dil:.1f}% year over year")

    # 3. Interest coverage weak or deteriorating
    ebit, ebit_prev = _pair(annual, "EBIT")
    if ebit is None:
        ebit, ebit_prev = _pair(annual, "OperatingIncome")
    ie, ie_prev = _pair(annual, "InterestExpense")
    cov = _ratio(ebit, ie)
    cov_prev = _ratio(ebit_prev, ie_prev)
    if cov is not None and cov < 3:
        sev = "high" if cov < 1.5 else "medium"
        trend = f" (was {cov_prev:.1f}x)" if cov_prev is not None and cov_prev > cov else ""
        add(sev, "Weak interest coverage", f"EBIT covers interest only {cov:.1f}x{trend}")
    elif cov is not None and cov_prev is not None and cov < cov_prev * 0.6 and cov < 6:
        add("medium", "Interest coverage deteriorating", f"Coverage fell from {cov_prev:.1f}x to {cov:.1f}x")

    # 4. Profits without cash (paper earnings)
    ni = _v(annual, "NetIncome")
    ocf = _v(annual, "OperatingCashFlow")
    if ni is not None and ocf is not None and ni > 0 and ocf < 0:
        add("high", "Profits without cash", "Positive net income but negative operating cash flow")

    # 5. Accruals ratio elevated
    eq = compute_earnings_quality(annual)
    if eq["accruals_ratio"] is not None and eq["accruals_ratio"] > 0.10:
        add("medium", "High accruals",
            f"Accruals ratio {eq['accruals_ratio']:.2f} — earnings running well ahead of cash generation")

    # 6. Leverage rising fast
    td, td_prev = _pair(annual, "TotalDebt")
    se, se_prev = _pair(annual, "StockholdersEquity")
    de = _ratio(td, se)
    de_prev = _ratio(td_prev, se_prev)
    if de is not None and de_prev is not None and de > de_prev * 1.4 and de > 1:
        add("medium", "Leverage rising", f"Debt/equity rose from {de_prev:.2f} to {de:.2f}")

    # 7. Sustained margin compression (3 consecutive declines)
    gms = []
    revs = {p["date"]: p["value"] for p in (annual.get("TotalRevenue") or [])}
    for p in (annual.get("GrossProfit") or []):
        r = revs.get(p["date"])
        if r:
            gms.append(p["value"] / r)
    if len(gms) >= 4 and gms[-1] < gms[-2] < gms[-3] < gms[-4]:
        add("medium", "Sustained margin compression",
            f"Gross margin declined 3 consecutive years ({gms[-4] * 100:.1f}% → {gms[-1] * 100:.1f}%)")

    # 8. Negative equity
    if se is not None and se < 0:
        add("high", "Negative shareholder equity", "Liabilities exceed assets on the balance sheet")

    return flags


# ---------------------------------------------------------------------------
# Composite pillar scores (0-100, drive the tab headers)
# ---------------------------------------------------------------------------

def compute_pillar_scores(
    piotroski: Dict[str, Any],
    altman: Dict[str, Any],
    earnings_quality: Dict[str, Any],
    trajectories: Dict[str, Any],
    red_flags: List[Dict[str, Any]],
) -> Dict[str, Any]:
    # Quality: F-score (60%) + earnings quality (25%) + ROIC level (15%)
    q = piotroski["score"] / 9 * 60
    eq_label = earnings_quality.get("label")
    q += {"high": 25, "adequate": 15, "low": 0}.get(eq_label, 10)
    roic_series = trajectories.get("roic_pct") or []
    roic = roic_series[-1]["value"] if roic_series else None
    if roic is not None:
        q += 15 if roic >= 15 else (10 if roic >= 8 else (5 if roic >= 3 else 0))
    else:
        q += 7

    # Health: Altman zone (50%) + interest coverage (25%) + red flags penalty (25%)
    h = {"safe": 50.0, "grey": 27.0, "distress": 5.0}.get(altman.get("zone"), 30.0)
    cov_series = trajectories.get("interest_coverage") or []
    cov = cov_series[-1]["value"] if cov_series else None
    if cov is None:
        h += 20  # no interest expense usually means low debt
    else:
        h += 25 if cov >= 8 else (17 if cov >= 4 else (8 if cov >= 2 else 0))
    high_flags = sum(1 for f in red_flags if f["severity"] == "high")
    med_flags = sum(1 for f in red_flags if f["severity"] == "medium")
    h += max(0.0, 25.0 - high_flags * 12 - med_flags * 5)

    # Growth: revenue growth trend + FCF trend
    g = 0.0
    rg = trajectories.get("revenue_growth_pct") or []
    latest_g = rg[-1]["value"] if rg else None
    if latest_g is not None:
        g += 50 if latest_g >= 15 else (38 if latest_g >= 8 else (25 if latest_g >= 3 else (12 if latest_g >= 0 else 0)))
    else:
        g += 20
    avg_g = sum(p["value"] for p in rg[-3:]) / len(rg[-3:]) if rg[-3:] else None
    if avg_g is not None:
        g += 30 if avg_g >= 12 else (22 if avg_g >= 6 else (14 if avg_g >= 2 else (6 if avg_g >= 0 else 0)))
    else:
        g += 12
    fcfs = [p["value"] for p in (trajectories.get("fcf") or [])]
    if len(fcfs) >= 2:
        g += 20 if fcfs[-1] > fcfs[0] and fcfs[-1] > 0 else (10 if fcfs[-1] > 0 else 0)
    else:
        g += 8

    return {
        "quality": round(min(q, 100)),
        "health": round(min(h, 100)),
        "growth": round(min(g, 100)),
    }


# ---------------------------------------------------------------------------
# Peer comparison
# ---------------------------------------------------------------------------

def _percentile_rank(values: List[float], v: float, lower_is_better: bool = False) -> float:
    """0-100 rank of v within values (100 = best)."""
    vals = [x for x in values if x is not None]
    if not vals or v is None:
        return 50.0
    # Inclusive rank: share of the peer set matched or beaten in the
    # favorable direction, so the best value scores 100.
    if lower_is_better:
        favorable = sum(1 for x in vals if x >= v)
    else:
        favorable = sum(1 for x in vals if x <= v)
    return round(favorable / len(vals) * 100, 0)


def build_peer_table(target: Dict[str, Any], candidates: List[Dict[str, Any]], max_peers: int = 7) -> Dict[str, Any]:
    """Pick sector peers closest in market cap; rank all (incl. target) on
    valuation / growth / quality percentiles."""
    sector = target.get("sector")
    mcap = target.get("market_cap") or 0
    peers = [
        c for c in candidates
        if c.get("symbol") != target.get("symbol")
        and sector and c.get("sector") == sector
        and (c.get("market_cap") or 0) > 0
    ]
    if mcap > 0:
        peers.sort(key=lambda c: abs(math.log(c["market_cap"] / mcap)))
    else:
        peers.sort(key=lambda c: -(c.get("market_cap") or 0))
    group = [target] + peers[:max_peers]

    pes = [c.get("pe") for c in group]
    pbs = [c.get("pb") for c in group]
    evs = [c.get("ev_ebitda") for c in group]
    rgs = [c.get("revenue_growth") for c in group]
    egs = [c.get("eps_growth") for c in group]
    roes = [c.get("roe") for c in group]
    pms = [c.get("profit_margin") for c in group]
    des = [c.get("debt_to_equity") for c in group]

    rows = []
    for c in group:
        val_scores = [
            _percentile_rank(pes, c.get("pe"), lower_is_better=True) if c.get("pe") else None,
            _percentile_rank(pbs, c.get("pb"), lower_is_better=True) if c.get("pb") else None,
            _percentile_rank(evs, c.get("ev_ebitda"), lower_is_better=True) if c.get("ev_ebitda") else None,
        ]
        gro_scores = [
            _percentile_rank(rgs, c.get("revenue_growth")) if c.get("revenue_growth") is not None else None,
            _percentile_rank(egs, c.get("eps_growth")) if c.get("eps_growth") is not None else None,
        ]
        qual_scores = [
            _percentile_rank(roes, c.get("roe")) if c.get("roe") is not None else None,
            _percentile_rank(pms, c.get("profit_margin")) if c.get("profit_margin") is not None else None,
            _percentile_rank(des, c.get("debt_to_equity"), lower_is_better=True) if c.get("debt_to_equity") is not None else None,
        ]

        def avg(xs):
            xs = [x for x in xs if x is not None]
            return round(sum(xs) / len(xs)) if xs else None

        v, gr, q = avg(val_scores), avg(gro_scores), avg(qual_scores)
        composite = avg([v, gr, q])
        rows.append({
            "symbol": c.get("symbol"),
            "name": c.get("name"),
            "is_target": c.get("symbol") == target.get("symbol"),
            "market_cap": c.get("market_cap"),
            "pe": c.get("pe"),
            "pb": c.get("pb"),
            "ev_ebitda": c.get("ev_ebitda"),
            "revenue_growth": c.get("revenue_growth"),
            "eps_growth": c.get("eps_growth"),
            "roe": c.get("roe"),
            "profit_margin": c.get("profit_margin"),
            "debt_to_equity": c.get("debt_to_equity"),
            "valuation_score": v,
            "growth_score": gr,
            "quality_score": q,
            "composite_score": composite,
        })
    rows.sort(key=lambda r: (r["composite_score"] is None, -(r["composite_score"] or 0)))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"sector": sector, "count": len(rows), "peers": rows}


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

def _market_for(symbol: str) -> str:
    return "IN" if symbol.upper().endswith(".NS") else "US"


async def get_fundamentals(symbol: str) -> Dict[str, Any]:
    """Full fundamentals payload: scores, trajectories, red flags, DCF (defaults), statements."""
    if symbol in FUNDAMENTALS_CACHE:
        return FUNDAMENTALS_CACHE[symbol]

    ts, bundle = await asyncio.gather(
        asyncio.to_thread(_fetch_timeseries, symbol),
        ss.get_bundle(symbol),
    )
    annual, quarterly = ts["annual"], ts["quarterly"]
    if not annual:
        return {"symbol": symbol, "available": False, "reason": "no financial statements found"}

    market_cap = bundle.get("market_cap") if isinstance(bundle, dict) else None
    price = bundle.get("price") if isinstance(bundle, dict) else None
    shares = bundle.get("shares_outstanding") if isinstance(bundle, dict) else None

    piotroski = compute_piotroski(annual)
    altman = compute_altman(annual, market_cap)
    eq = compute_earnings_quality(annual)
    traj = compute_trajectories(annual)
    flags = detect_red_flags(annual, quarterly)
    dcf = compute_dcf(annual, price, shares)
    pillars = compute_pillar_scores(piotroski, altman, eq, traj, flags)

    out = {
        "symbol": symbol,
        "available": True,
        "name": bundle.get("name") if isinstance(bundle, dict) else symbol,
        "currency": bundle.get("currency") if isinstance(bundle, dict) else currency(_market_for(symbol)),
        "price": price,
        "market_cap": market_cap,
        "as_of": (annual.get("TotalRevenue") or [{}])[-1].get("date"),
        "periods_available": len(annual.get("TotalRevenue") or []),
        "pillar_scores": pillars,
        "piotroski": piotroski,
        "altman": altman,
        "earnings_quality": eq,
        "trajectories": traj,
        "red_flags": flags,
        "dcf": dcf,
        "statements": {"annual": annual, "quarterly": quarterly},
    }
    FUNDAMENTALS_CACHE[symbol] = out
    return out


async def get_dcf(
    symbol: str,
    growth: Optional[float] = None,
    discount: float = 10.0,
    terminal_growth: float = 2.5,
    years: int = 10,
) -> Dict[str, Any]:
    """DCF with caller-adjustable assumptions (uses cached statements)."""
    ts, bundle = await asyncio.gather(
        asyncio.to_thread(_fetch_timeseries, symbol),
        ss.get_bundle(symbol),
    )
    annual = ts["annual"]
    if not annual:
        return {"symbol": symbol, "available": False, "reason": "no financial statements found"}
    price = bundle.get("price") if isinstance(bundle, dict) else None
    shares = bundle.get("shares_outstanding") if isinstance(bundle, dict) else None
    dcf = compute_dcf(annual, price, shares, growth, discount, terminal_growth, years)
    dcf["symbol"] = symbol
    dcf["default_growth_pct"] = default_growth_assumption(annual)
    return dcf


async def get_peers(symbol: str) -> Dict[str, Any]:
    if symbol in PEERS_CACHE:
        return PEERS_CACHE[symbol]
    market = _market_for(symbol)
    universe, bundle = await asyncio.gather(
        ss.get_market_universe(market),
        ss.get_bundle(symbol),
    )
    if not isinstance(bundle, dict) or bundle.get("error"):
        return {"symbol": symbol, "available": False, "reason": "stock not found"}
    target = bundle
    # Prefer the universe copy (identical fields) if present
    for c in universe:
        if c.get("symbol") == symbol:
            target = c
            break
    table = build_peer_table(target, universe)
    out = {"symbol": symbol, "available": True, "market": market, "currency": currency(market), **table}
    PEERS_CACHE[symbol] = out
    return out
