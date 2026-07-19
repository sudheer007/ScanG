"""Market intelligence service — institutional-grade analytics layered on existing data.

Four capabilities, all computed from data the app already fetches (no new
upstream dependencies):

- Market breadth & regime: advance/decline, % above key MAs, new highs/lows,
  up/down volume — collapsed into a 0–100 composite with a regime label.
- Quant risk profile per stock: annualized volatility, max drawdown, Sharpe,
  Sortino, historical VaR/CVaR, beta/correlation vs the market benchmark,
  and relative strength over 1M/3M/6M/1Y windows.
- Short interest / squeeze radar (US — Yahoo has no short data for NSE).
- Portfolio insights: sector concentration, factor tilts, risk flags and
  upcoming catalysts across an arbitrary basket (the user's watchlist).

Pure compute functions take plain dicts/lists so tests can drive them without
network or a live server.
"""
from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from cachetools import TTLCache

from stock_service import get_market_universe, get_bundle, get_history, _safe
from stock_universe import currency

RISK_CACHE = TTLCache(maxsize=1000, ttl=10 * 60)

BENCHMARKS = {"US": "^GSPC", "IN": "^NSEI"}
# Flat annual risk-free proxies for Sharpe/Sortino (T-bill / India 10y-ish).
RISK_FREE = {"US": 0.045, "IN": 0.07}
TRADING_DAYS = 252


def _market_for_symbol(symbol: str) -> str:
    return "IN" if symbol.upper().endswith(".NS") else "US"


# ======================================================================
# 1) Market breadth & regime
# ======================================================================
def compute_breadth(stocks: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Collapse universe bundles into breadth internals + a composite regime.

    Composite (0–100) blends five equal-weight components:
    advancers %, % above MA50, % above MA200, new-high vs new-low balance,
    and up-volume share. >100 inputs make it robust to a few missing fields.
    """
    adv = dec = unch = 0
    above_ma50 = below_ma50 = above_ma200 = below_ma200 = 0
    new_highs = new_lows = 0
    overbought = oversold = 0
    rsis: List[float] = []
    up_vol = down_vol = 0.0

    for st in stocks:
        chg = _safe(st.get("change_pct"))
        if chg is not None:
            if chg > 0.05:
                adv += 1
            elif chg < -0.05:
                dec += 1
            else:
                unch += 1
            vol = _safe(st.get("volume")) or 0
            if chg > 0:
                up_vol += vol
            elif chg < 0:
                down_vol += vol

        price = _safe(st.get("price"))
        ma50 = _safe(st.get("ma50"))
        ma200 = _safe(st.get("ma200"))
        if price and ma50:
            if price >= ma50:
                above_ma50 += 1
            else:
                below_ma50 += 1
        if price and ma200:
            if price >= ma200:
                above_ma200 += 1
            else:
                below_ma200 += 1

        from_high = _safe(st.get("from_52w_high_pct"))
        from_low = _safe(st.get("from_52w_low_pct"))
        if from_high is not None and from_high >= -1.0:
            new_highs += 1
        if from_low is not None and from_low <= 1.0:
            new_lows += 1

        rsi = _safe(st.get("rsi"))
        if rsi is not None:
            rsis.append(rsi)
            if rsi >= 70:
                overbought += 1
            elif rsi <= 30:
                oversold += 1

    def pct(n: int, d: int) -> Optional[float]:
        return round(n * 100 / d, 1) if d > 0 else None

    total_dir = adv + dec
    adv_pct = pct(adv, total_dir)
    ma50_pct = pct(above_ma50, above_ma50 + below_ma50)
    ma200_pct = pct(above_ma200, above_ma200 + below_ma200)
    hl_total = new_highs + new_lows
    hl_pct = pct(new_highs, hl_total) if hl_total > 0 else None
    vol_total = up_vol + down_vol
    up_vol_pct = round(up_vol * 100 / vol_total, 1) if vol_total > 0 else None

    components = {
        "advancers_pct": adv_pct,
        "above_ma50_pct": ma50_pct,
        "above_ma200_pct": ma200_pct,
        "new_high_share_pct": hl_pct,
        "up_volume_pct": up_vol_pct,
    }
    present = [v for v in components.values() if v is not None]
    composite = round(sum(present) / len(present), 1) if present else None

    if composite is None:
        regime, regime_detail = "Unknown", "Insufficient data to judge breadth."
    elif composite >= 65:
        regime, regime_detail = "Risk-On", "Broad participation — most stocks advancing above key trend levels."
    elif composite >= 55:
        regime, regime_detail = "Constructive", "Healthy breadth with moderate participation."
    elif composite >= 45:
        regime, regime_detail = "Neutral", "Mixed internals — no clear direction from breadth."
    elif composite >= 35:
        regime, regime_detail = "Cautious", "Narrowing participation — weakness under the surface."
    else:
        regime, regime_detail = "Risk-Off", "Broad deterioration — most stocks declining below trend."

    return {
        "advancers": adv,
        "decliners": dec,
        "unchanged": unch,
        "adv_decl_ratio": round(adv / dec, 2) if dec > 0 else None,
        "pct_above_ma50": ma50_pct,
        "pct_above_ma200": ma200_pct,
        "new_52w_highs": new_highs,
        "new_52w_lows": new_lows,
        "avg_rsi": round(sum(rsis) / len(rsis), 1) if rsis else None,
        "overbought_count": overbought,
        "oversold_count": oversold,
        "up_volume_pct": up_vol_pct,
        "components": components,
        "composite": composite,
        "regime": regime,
        "regime_detail": regime_detail,
        "sample_size": len(stocks),
    }


async def market_breadth(market: str) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    out = compute_breadth(universe)
    out.update({
        "market": market.upper(),
        "currency": currency(market),
        "as_of": datetime.now(timezone.utc).isoformat(),
    })
    return out


# ======================================================================
# 2) Quant risk profile per stock
# ======================================================================
def _daily_returns(closes: Sequence[float]) -> List[float]:
    rets = []
    for prev, cur in zip(closes, closes[1:]):
        if prev and prev > 0 and cur is not None:
            rets.append(cur / prev - 1)
    return rets


def _std(xs: Sequence[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mean = sum(xs) / n
    return math.sqrt(sum((x - mean) ** 2 for x in xs) / (n - 1))


def compute_risk_metrics(
    closes: Sequence[float],
    bench_closes: Optional[Sequence[float]] = None,
    risk_free: float = 0.045,
) -> Dict[str, Any]:
    """Risk/return stats from ~1y of daily closes (optionally vs a benchmark).

    Stock and benchmark series must already be date-aligned (same trading
    days); callers align them before passing in.
    """
    closes = [c for c in closes if c is not None and c > 0]
    if len(closes) < 30:
        return {"available": False, "reason": "insufficient_history"}

    rets = _daily_returns(closes)
    n = len(rets)
    mean_daily = sum(rets) / n
    vol_daily = _std(rets)
    ann_vol = vol_daily * math.sqrt(TRADING_DAYS)
    ann_ret = (1 + mean_daily) ** TRADING_DAYS - 1

    # Max drawdown
    peak = closes[0]
    max_dd = 0.0
    for c in closes:
        peak = max(peak, c)
        max_dd = min(max_dd, c / peak - 1)

    sharpe = (ann_ret - risk_free) / ann_vol if ann_vol > 0 else None

    downside = [r for r in rets if r < 0]
    downside_dev = math.sqrt(sum(r * r for r in downside) / n) * math.sqrt(TRADING_DAYS) if downside else 0.0
    sortino = (ann_ret - risk_free) / downside_dev if downside_dev > 0 else None

    # Historical 1-day VaR / CVaR at 95%
    sorted_rets = sorted(rets)
    var_idx = max(0, int(0.05 * n) - 1)
    var95 = sorted_rets[var_idx]
    tail = sorted_rets[: var_idx + 1]
    cvar95 = sum(tail) / len(tail) if tail else var95

    out: Dict[str, Any] = {
        "available": True,
        "observations": n,
        "annualized_return_pct": round(ann_ret * 100, 1),
        "annualized_volatility_pct": round(ann_vol * 100, 1),
        "max_drawdown_pct": round(max_dd * 100, 1),
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "sortino": round(sortino, 2) if sortino is not None else None,
        "var_95_daily_pct": round(var95 * 100, 2),
        "cvar_95_daily_pct": round(cvar95 * 100, 2),
        "beta": None,
        "correlation": None,
        "up_capture_pct": None,
        "down_capture_pct": None,
        "relative_strength": {},
    }

    if bench_closes:
        bench = [c for c in bench_closes if c is not None and c > 0]
        m = min(len(closes), len(bench))
        if m >= 30:
            s_rets = _daily_returns(closes[-m:])
            b_rets = _daily_returns(bench[-m:])
            k = min(len(s_rets), len(b_rets))
            s_rets, b_rets = s_rets[-k:], b_rets[-k:]
            b_var = _std(b_rets) ** 2
            if b_var > 0 and k >= 2:
                s_mean = sum(s_rets) / k
                b_mean = sum(b_rets) / k
                cov = sum((a - s_mean) * (b - b_mean) for a, b in zip(s_rets, b_rets)) / (k - 1)
                out["beta"] = round(cov / b_var, 2)
                s_std, b_std = _std(s_rets), _std(b_rets)
                if s_std > 0 and b_std > 0:
                    out["correlation"] = round(cov / (s_std * b_std), 2)

            up_s = [s for s, b in zip(s_rets, b_rets) if b > 0]
            up_b = [b for b in b_rets if b > 0]
            down_s = [s for s, b in zip(s_rets, b_rets) if b < 0]
            down_b = [b for b in b_rets if b < 0]
            if up_b and sum(up_b) != 0:
                out["up_capture_pct"] = round(sum(up_s) * 100 / sum(up_b), 0)
            if down_b and sum(down_b) != 0:
                out["down_capture_pct"] = round(sum(down_s) * 100 / sum(down_b), 0)

            # Relative strength: stock total return minus benchmark total return
            # over trailing windows (in trading days).
            for label, days in (("1M", 21), ("3M", 63), ("6M", 126), ("1Y", TRADING_DAYS)):
                if len(closes) > days and len(bench) > days:
                    s_r = closes[-1] / closes[-days - 1] - 1
                    b_r = bench[-1] / bench[-days - 1] - 1
                    out["relative_strength"][label] = {
                        "stock_pct": round(s_r * 100, 1),
                        "benchmark_pct": round(b_r * 100, 1),
                        "excess_pct": round((s_r - b_r) * 100, 1),
                    }

    # Qualitative grade from vol / drawdown / beta
    grade_score = 0
    if ann_vol * 100 > 45: grade_score += 2
    elif ann_vol * 100 > 28: grade_score += 1
    if max_dd * 100 < -40: grade_score += 2
    elif max_dd * 100 < -22: grade_score += 1
    beta = out.get("beta")
    if beta is not None and beta > 1.4: grade_score += 1
    out["risk_grade"] = "High" if grade_score >= 3 else ("Elevated" if grade_score == 2 else ("Moderate" if grade_score == 1 else "Low"))
    return out


async def risk_profile(symbol: str) -> Dict[str, Any]:
    key = symbol.upper()
    if key in RISK_CACHE:
        return RISK_CACHE[key]

    market = _market_for_symbol(symbol)
    bench_symbol = BENCHMARKS[market]
    stock_hist, bench_hist = await asyncio.gather(
        get_history(symbol, "1y", "1d"),
        get_history(bench_symbol, "1y", "1d"),
    )
    closes_by_day = {p["t"][:10]: p["c"] for p in stock_hist if p.get("c")}
    bench_by_day = {p["t"][:10]: p["c"] for p in bench_hist if p.get("c")}
    common = sorted(set(closes_by_day) & set(bench_by_day))
    if len(common) >= 30:
        closes = [closes_by_day[d] for d in common]
        bench = [bench_by_day[d] for d in common]
    else:
        closes = [p["c"] for p in stock_hist if p.get("c")]
        bench = None

    metrics = compute_risk_metrics(closes, bench, risk_free=RISK_FREE[market])
    out = {
        "symbol": symbol,
        "market": market,
        "benchmark": bench_symbol,
        "risk_free_pct": round(RISK_FREE[market] * 100, 2),
        **metrics,
    }
    if metrics.get("available"):
        RISK_CACHE[key] = out
    return out


# ======================================================================
# 3) Short interest / squeeze radar (US)
# ======================================================================
def compute_squeeze_rank(stocks: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rank stocks by squeeze potential: heavy short interest meeting upward
    price pressure. Score 0–100: short % of float (up to 50 pts), days to
    cover (up to 20), positive momentum + volume confirmation (up to 30)."""
    out = []
    for st in stocks:
        spf = _safe(st.get("short_pct_float"))
        if spf is None or spf <= 0:
            continue
        days_to_cover = _safe(st.get("short_ratio"))
        chg = _safe(st.get("change_pct")) or 0
        rsi = _safe(st.get("rsi")) or 50
        vs = _safe(st.get("volume_surge")) or 1.0
        si_chg = _safe(st.get("short_interest_change_pct"))

        score = min(50.0, spf * 2.5)                      # 20%+ of float = max
        if days_to_cover:
            score += min(20.0, days_to_cover * 2.5)       # 8+ days = max
        if chg > 0:
            score += min(10.0, chg * 2)
        if rsi > 55:
            score += 5
        if vs > 1.5:
            score += min(10.0, (vs - 1) * 5)
        if si_chg is not None and si_chg < 0:              # shorts already covering
            score += 5

        out.append({
            "symbol": st["symbol"],
            "name": st.get("name"),
            "price": st.get("price"),
            "currency": st.get("currency"),
            "change_pct": st.get("change_pct"),
            "sector": st.get("sector"),
            "market_cap": st.get("market_cap"),
            "sparkline": st.get("sparkline"),
            "short_pct_float": round(spf, 2),
            "days_to_cover": days_to_cover,
            "short_interest_change_pct": si_chg,
            "volume_surge": vs,
            "rsi": st.get("rsi"),
            "squeeze_score": round(min(100.0, score), 1),
        })
    out.sort(key=lambda x: x["squeeze_score"], reverse=True)
    return out


async def short_interest_radar(market: str, limit: int = 25) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    ranked = compute_squeeze_rank(universe)
    most_shorted = sorted(ranked, key=lambda x: x["short_pct_float"], reverse=True)[:limit]
    return {
        "market": market.upper(),
        "currency": currency(market),
        "available": len(ranked) > 0,
        "coverage": len(ranked),
        "squeeze_candidates": ranked[:limit],
        "most_shorted": most_shorted,
    }


# ======================================================================
# 4) Portfolio insights (watchlist intelligence)
# ======================================================================
def _pairwise_correlation(sparklines: Dict[str, List[float]]) -> Optional[float]:
    """Average pairwise return correlation from 30-day sparklines — a rough
    but useful diversification read for a small basket."""
    rets = {}
    for sym, spark in sparklines.items():
        r = _daily_returns([x for x in (spark or []) if x])
        if len(r) >= 15:
            rets[sym] = r
    syms = list(rets)
    if len(syms) < 2:
        return None
    corrs = []
    for i in range(len(syms)):
        for j in range(i + 1, len(syms)):
            a, b = rets[syms[i]], rets[syms[j]]
            k = min(len(a), len(b))
            a, b = a[-k:], b[-k:]
            sa, sb = _std(a), _std(b)
            if sa > 0 and sb > 0 and k >= 2:
                ma_, mb = sum(a) / k, sum(b) / k
                cov = sum((x - ma_) * (y - mb) for x, y in zip(a, b)) / (k - 1)
                corrs.append(cov / (sa * sb))
    return round(sum(corrs) / len(corrs), 2) if corrs else None


def compute_portfolio_insights(bundles: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    bundles = [b for b in bundles if b and not b.get("error")]
    n = len(bundles)
    if n == 0:
        return {"available": False, "reason": "no_holdings"}

    # Sector exposure (equal-weighted — no position sizes without auth/accounts)
    sectors: Dict[str, int] = {}
    for b in bundles:
        sec = b.get("sector") or "Unknown"
        sectors[sec] = sectors.get(sec, 0) + 1
    exposure = [
        {"sector": s, "count": c, "weight_pct": round(c * 100 / n, 1)}
        for s, c in sorted(sectors.items(), key=lambda kv: kv[1], reverse=True)
    ]
    hhi = sum((c / n) ** 2 for c in sectors.values())
    diversification = "Concentrated" if hhi > 0.5 else ("Moderate" if hhi > 0.3 else "Diversified")

    def avg(field: str) -> Optional[float]:
        vals = [_safe(b.get(field)) for b in bundles]
        vals = [v for v in vals if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    avg_beta = avg("beta")
    avg_pe = avg("pe")
    avg_dy = avg("dividend_yield")
    avg_day = avg("change_pct")
    avg_ytd = avg("ytd_pct")

    avg_corr = _pairwise_correlation({b["symbol"]: b.get("sparkline") or [] for b in bundles})

    # Risk flags
    flags: List[Dict[str, str]] = []
    top = exposure[0]
    if n >= 3 and top["weight_pct"] >= 50 and top["sector"] != "Unknown":
        flags.append({"severity": "high", "title": f"{top['weight_pct']:.0f}% in {top['sector']}",
                      "detail": "Over half the basket sits in one sector — a sector-specific shock hits most positions at once."})
    if avg_beta is not None and avg_beta > 1.3:
        flags.append({"severity": "medium", "title": f"High average beta ({avg_beta:.2f})",
                      "detail": "The basket should move materially more than the market in both directions."})
    if avg_corr is not None and avg_corr > 0.7:
        flags.append({"severity": "medium", "title": f"Highly correlated holdings (avg {avg_corr:.2f})",
                      "detail": "Positions tend to move together — diversification benefit is limited."})
    leveraged = [b["symbol"] for b in bundles if (_safe(b.get("debt_to_equity")) or 0) > 150]
    if leveraged:
        flags.append({"severity": "medium", "title": f"High leverage: {', '.join(s.replace('.NS', '') for s in leveraged[:4])}",
                      "detail": "Debt/equity above 150% — sensitive to rates and refinancing conditions."})
    overbought = [b["symbol"] for b in bundles if (_safe(b.get("rsi")) or 50) >= 75]
    if overbought:
        flags.append({"severity": "low", "title": f"Overbought: {', '.join(s.replace('.NS', '') for s in overbought[:4])}",
                      "detail": "RSI at 75+ — short-term pullback risk."})

    # Upcoming catalysts (earnings within 21 days)
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    catalysts = []
    for b in bundles:
        ep = b.get("next_earnings_epoch")
        if ep and now_ts - 86400 <= ep <= now_ts + 21 * 86400:
            catalysts.append({
                "symbol": b["symbol"], "name": b.get("name"),
                "earnings_date_epoch": ep,
                "days_until": max(0, int((ep - now_ts) / 86400)),
            })
    catalysts.sort(key=lambda x: x["earnings_date_epoch"])

    ranked_day = sorted([b for b in bundles if _safe(b.get("change_pct")) is not None],
                        key=lambda b: b["change_pct"], reverse=True)

    def brief(b):
        return {"symbol": b["symbol"], "name": b.get("name"), "change_pct": b.get("change_pct"),
                "ytd_pct": b.get("ytd_pct"), "price": b.get("price"), "currency": b.get("currency")}

    return {
        "available": True,
        "count": n,
        "sector_exposure": exposure,
        "diversification": diversification,
        "avg_pairwise_correlation": avg_corr,
        "averages": {
            "beta": avg_beta, "pe": avg_pe, "dividend_yield": avg_dy,
            "day_change_pct": avg_day, "ytd_pct": avg_ytd,
        },
        "risk_flags": flags,
        "upcoming_earnings": catalysts[:8],
        "best_today": brief(ranked_day[0]) if ranked_day else None,
        "worst_today": brief(ranked_day[-1]) if len(ranked_day) > 1 else None,
    }


async def portfolio_insights(symbols: List[str]) -> Dict[str, Any]:
    symbols = [s.strip().upper() for s in symbols if s.strip()][:40]
    bundles = await asyncio.gather(*[get_bundle(s) for s in symbols])
    out = compute_portfolio_insights(list(bundles))
    out["symbols"] = symbols
    return out
