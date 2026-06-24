"""Analyzer service — deep stock analysis + new widgets (forecast, earnings/dividend calendars, sector rotation).

All data sourced from the enriched universe (Yahoo Finance live).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from stock_service import get_market_universe, get_bundle
from discover_service import _ai_score, _rating_from_score, _safe
from stock_universe import currency


# ----------------------------------------------------------------------
# Forecast horizons (1M / 3M / 6M / 1Y)
# ----------------------------------------------------------------------
def _projected_return(st: Dict[str, Any], horizon_months: int) -> Optional[Dict[str, Any]]:
    """Blend real analyst target (1Y) + technical momentum for shorter horizons.

    For 1Y: use real analyst mean target if available → real upside %
    For 1M/3M/6M: derive from momentum signals (RSI, MA position, volume surge,
                  recent change), scaled by horizon length. Clearly tagged 'model'.
    """
    price = _safe(st.get("price"))
    if price is None or price <= 0:
        return None

    if horizon_months == 12:
        target = _safe(st.get("target_mean_price"))
        if target and target > 0:
            upside = (target / price - 1) * 100
            high = _safe(st.get("target_high_price")) or target
            low = _safe(st.get("target_low_price")) or target
            return {
                "horizon": "1Y",
                "source": "analyst_consensus",
                "target_price": round(target, 2),
                "expected_return_pct": round(upside, 1),
                "high_target": round(high, 2),
                "low_target": round(low, 2),
                "analyst_count": st.get("analyst_count"),
                "confidence": _confidence_from_count(st.get("analyst_count")),
            }
        # fallback: pure model
        score, _ = _ai_score(st)
        proj = (score - 50) * 0.4  # scaled
        return {
            "horizon": "1Y",
            "source": "model",
            "target_price": round(price * (1 + proj / 100), 2),
            "expected_return_pct": round(proj, 1),
            "high_target": None, "low_target": None, "analyst_count": None,
            "confidence": "low",
        }

    # Model-based shorter horizons — multi-signal momentum projection
    rsi = _safe(st.get("rsi")) or 50
    chg = _safe(st.get("change_pct")) or 0
    vs = _safe(st.get("volume_surge")) or 1.0
    from52 = _safe(st.get("from_52w_high_pct")) or -50
    p, m50, m200 = price, _safe(st.get("ma50")), _safe(st.get("ma200"))
    eg = _safe(st.get("eps_growth")) or 0
    rg = _safe(st.get("revenue_growth")) or 0

    # Base monthly drift from sector-like priors
    drift = 0.8  # 0.8% baseline / month
    # momentum kick
    drift += (chg * 0.15)
    # trend
    if p and m50 and m200 and p > m50 > m200: drift += 1.5
    elif p and m50 and p > m50: drift += 0.6
    elif p and m50 and p < m50: drift -= 0.8
    # RSI extremes mean-revert
    if rsi > 75: drift -= 1.5
    elif rsi < 30: drift += 1.5
    # volume conviction
    if vs > 1.8: drift += 0.8
    # 52w-high proximity
    if from52 > -3: drift += 0.6
    elif from52 < -30: drift -= 0.6
    # growth tilt
    drift += (eg * 0.02 + rg * 0.02)

    monthly_drift = max(-8.0, min(8.0, drift))

    # compound for horizon
    expected = ((1 + monthly_drift / 100) ** horizon_months - 1) * 100
    # widen high/low bands by sqrt(horizon)
    band = max(2.0, abs(expected) * 0.4 + 2 * math.sqrt(horizon_months))

    horizon_label = {1: "1M", 3: "3M", 6: "6M"}[horizon_months]
    target = price * (1 + expected / 100)
    return {
        "horizon": horizon_label,
        "source": "model",
        "target_price": round(target, 2),
        "expected_return_pct": round(expected, 1),
        "high_target": round(price * (1 + (expected + band) / 100), 2),
        "low_target": round(price * (1 + (expected - band) / 100), 2),
        "analyst_count": None,
        "confidence": _confidence_from_model(monthly_drift, st),
    }


def _confidence_from_count(n) -> str:
    n = int(n or 0)
    if n >= 25: return "high"
    if n >= 12: return "medium"
    if n >= 5:  return "low"
    return "very low"


def _confidence_from_model(monthly_drift: float, st: Dict[str, Any]) -> str:
    rsi = _safe(st.get("rsi")) or 50
    vs = _safe(st.get("volume_surge")) or 1.0
    score = 0
    if vs > 1.5: score += 1
    if 40 < rsi < 70: score += 1
    if abs(monthly_drift) >= 2: score += 1
    if (_safe(st.get("eps_growth")) or 0) > 10: score += 1
    if score >= 3: return "medium"
    if score >= 2: return "low"
    return "very low"


async def forecast_horizons(market: str, limit: int = 25) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    enriched = []
    for st in universe:
        item = {
            "symbol": st["symbol"],
            "name": st.get("name"),
            "price": st.get("price"),
            "change_pct": st.get("change_pct"),
            "currency": st.get("currency"),
            "sector": st.get("sector"),
            "market_cap": st.get("market_cap"),
            "sparkline": st.get("sparkline"),
            "rsi": st.get("rsi"),
            "ai_score": _ai_score(st)[0],
            "forecasts": {
                "1M": _projected_return(st, 1),
                "3M": _projected_return(st, 3),
                "6M": _projected_return(st, 6),
                "1Y": _projected_return(st, 12),
            },
        }
        # Composite forecast score = avg of horizon expected returns weighted to favor longer
        f = item["forecasts"]
        weighted = 0.0; wsum = 0.0
        for h, w in [("1M", 1), ("3M", 2), ("6M", 3), ("1Y", 4)]:
            if f.get(h) and f[h].get("expected_return_pct") is not None:
                weighted += f[h]["expected_return_pct"] * w
                wsum += w
        item["forecast_score"] = round(weighted / wsum, 2) if wsum else 0
        enriched.append(item)

    enriched.sort(key=lambda x: x["forecast_score"], reverse=True)
    top = enriched[:limit]
    bottom = sorted(enriched, key=lambda x: x["forecast_score"])[:limit]
    return {
        "market": market.upper(),
        "currency": currency(market),
        "top": top,
        "bottom": bottom,
    }


# ----------------------------------------------------------------------
# Earnings calendar (next 4 weeks)
# ----------------------------------------------------------------------
async def earnings_calendar(market: str, limit: int = 50, days_ahead: int = 45) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    cutoff = now_ts + (days_ahead * 86400)
    items = []
    for st in universe:
        ep = st.get("next_earnings_epoch")
        if ep is None or ep < now_ts - 86400 or ep > cutoff:
            continue
        days_until = int((ep - now_ts) / 86400)
        items.append({
            "symbol": st["symbol"], "name": st.get("name"),
            "sector": st.get("sector"),
            "market_cap": st.get("market_cap"),
            "price": st.get("price"), "currency": st.get("currency"),
            "change_pct": st.get("change_pct"),
            "earnings_date_epoch": ep,
            "days_until": days_until,
            "eps_estimate_next_yr_pct": st.get("eps_growth_next_year_pct"),
            "last_surprise_pct": st.get("latest_eps_surprise_pct"),
            "ai_score": _ai_score(st)[0],
        })
    items.sort(key=lambda x: x["earnings_date_epoch"])
    # group by week
    by_week: Dict[str, List[Dict[str, Any]]] = {}
    for it in items:
        wk = "this_week" if it["days_until"] <= 7 else ("next_week" if it["days_until"] <= 14 else ("this_month" if it["days_until"] <= 30 else "later"))
        by_week.setdefault(wk, []).append(it)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "items": items[:limit],
        "by_week": by_week,
        "total": len(items),
    }


# ----------------------------------------------------------------------
# Dividend calendar
# ----------------------------------------------------------------------
async def dividend_calendar(market: str, limit: int = 50, days_ahead: int = 60) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    cutoff = now_ts + (days_ahead * 86400)
    items = []
    for st in universe:
        ex = st.get("ex_dividend_epoch")
        if ex is None or ex < now_ts - 86400 or ex > cutoff:
            continue
        days_until = int((ex - now_ts) / 86400)
        items.append({
            "symbol": st["symbol"], "name": st.get("name"),
            "sector": st.get("sector"),
            "price": st.get("price"), "currency": st.get("currency"),
            "dividend_yield": st.get("dividend_yield"),
            "ex_dividend_epoch": ex,
            "payment_epoch": st.get("dividend_date_epoch"),
            "days_until": days_until,
        })
    items.sort(key=lambda x: x["ex_dividend_epoch"])
    return {
        "market": market.upper(),
        "currency": currency(market),
        "items": items[:limit],
        "total": len(items),
    }


# ----------------------------------------------------------------------
# Sector rotation (heatmap)
# ----------------------------------------------------------------------
async def sector_rotation(market: str) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    by_sector: Dict[str, Dict[str, Any]] = {}
    for st in universe:
        sec = st.get("sector")
        if not sec: continue
        s = by_sector.setdefault(sec, {"sector": sec, "stocks": [], "chg": [], "mcap": 0})
        s["stocks"].append(st["symbol"])
        if st.get("change_pct") is not None: s["chg"].append(st["change_pct"])
        if st.get("market_cap"): s["mcap"] += st["market_cap"]
    out = []
    for sec, d in by_sector.items():
        chgs = d["chg"]
        avg = sum(chgs) / len(chgs) if chgs else 0
        winners = sum(1 for x in chgs if x > 0)
        losers = sum(1 for x in chgs if x < 0)
        out.append({
            "sector": sec,
            "stock_count": len(d["stocks"]),
            "avg_change_pct": round(avg, 2),
            "winners": winners, "losers": losers,
            "breadth_pct": round(winners * 100 / max(1, winners + losers), 1),
            "market_cap_total": d["mcap"],
        })
    out.sort(key=lambda x: x["avg_change_pct"], reverse=True)
    return {"market": market.upper(), "currency": currency(market), "sectors": out}


# ----------------------------------------------------------------------
# Insider / institutional activity (top holdings concentration)
# ----------------------------------------------------------------------
async def institutional_activity(market: str, limit: int = 25) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    items = []
    for st in universe:
        if st.get("pct_institutions") is None and st.get("pct_insiders") is None:
            continue
        items.append({
            "symbol": st["symbol"], "name": st.get("name"),
            "price": st.get("price"), "currency": st.get("currency"),
            "change_pct": st.get("change_pct"),
            "pct_institutions": st.get("pct_institutions"),
            "pct_insiders": st.get("pct_insiders"),
            "top_institution": st.get("top_institution"),
            "market_cap": st.get("market_cap"),
        })
    insider_heavy = sorted(items, key=lambda x: x.get("pct_insiders") or 0, reverse=True)[:limit]
    institution_heavy = sorted(items, key=lambda x: x.get("pct_institutions") or 0, reverse=True)[:limit]
    return {
        "market": market.upper(),
        "currency": currency(market),
        "insider_heavy": insider_heavy,
        "institution_heavy": institution_heavy,
    }


# ----------------------------------------------------------------------
# Deep AI Analyzer (per stock)
# ----------------------------------------------------------------------
async def analyzer(symbol: str) -> Dict[str, Any]:
    """Comprehensive deep analysis for a single stock.

    Sections:
      - verdict: overall AI verdict + summary
      - scores: factor scores breakdown
      - real_analyst: Wall Street consensus, target, upside, distribution
      - forecasts: 1M/3M/6M/1Y projections (real for 1Y where available)
      - valuation: PE/PB/PS/PEG vs sector implied
      - financials: revenue, margins, cashflow, debt
      - technicals: trend signals, RSI, MA, momentum
      - risk: beta, debt, volatility, drawdown
      - catalysts: upcoming earnings, dividends, recent upgrade/downgrade
      - pros_cons: bullish vs bearish points
      - trade_idea: suggested entry/target/stop with rationale
    """
    st = await get_bundle(symbol)
    if not st or st.get("error"):
        return {"error": "no_data", "symbol": symbol}

    score, breakdown = _ai_score(st)
    rating = _rating_from_score(score)

    price = _safe(st.get("price")) or 0
    target = _safe(st.get("target_mean_price"))
    upside = ((target / price - 1) * 100) if (target and price > 0) else None

    # Pros / Cons
    pros, cons = [], []
    if breakdown["momentum"] >= 70: pros.append("Strong price momentum signal")
    if breakdown["value"] >= 65: pros.append(f"Attractive valuation (P/E {st.get('pe'):.1f})" if st.get("pe") else "Attractive valuation")
    if breakdown["quality"] >= 70: pros.append(f"High quality (ROE {st.get('roe'):.0f}%)" if st.get("roe") else "High quality fundamentals")
    if breakdown["growth"] >= 70: pros.append("Robust earnings & revenue growth")
    if breakdown["technical"] >= 70: pros.append("Bullish technical setup (above key MAs)")
    if (_safe(st.get("dividend_yield")) or 0) >= 3: pros.append(f"Solid dividend yield {st.get('dividend_yield'):.1f}%")
    if (_safe(st.get("from_52w_high_pct")) or -100) >= -5: pros.append("Near 52-week high")
    if (_safe(st.get("eps_growth_next_year_pct")) or 0) >= 15: pros.append(f"Strong forecast EPS growth ({st.get('eps_growth_next_year_pct'):.0f}%)")
    if (_safe(st.get("latest_eps_surprise_pct")) or 0) > 5: pros.append(f"Beat EPS estimate by {st.get('latest_eps_surprise_pct'):.1f}%")
    if upside is not None and upside > 12: pros.append(f"{upside:.0f}% upside to analyst target")

    if breakdown["value"] < 35: cons.append("Stretched valuation vs peers")
    if breakdown["quality"] < 40: cons.append("Weak quality metrics (low ROE / high debt)")
    if breakdown["technical"] < 40: cons.append("Bearish technicals (below moving averages)")
    if (_safe(st.get("rsi")) or 50) > 75: cons.append(f"Overbought RSI {st.get('rsi'):.0f}")
    if (_safe(st.get("rsi")) or 50) < 25: cons.append(f"Oversold RSI {st.get('rsi'):.0f}")
    if (_safe(st.get("debt_to_equity")) or 0) > 150: cons.append(f"High leverage (D/E {st.get('debt_to_equity'):.0f})")
    if (_safe(st.get("from_52w_high_pct")) or 0) < -25: cons.append(f"{abs(st.get('from_52w_high_pct')):.0f}% below 52-week high")
    if (_safe(st.get("change_pct")) or 0) < -5: cons.append("Recent sharp decline")

    if not pros: pros.append("Limited bullish signals")
    if not cons: cons.append("No major red flags detected")

    # Trade idea (rough)
    trade_idea = None
    if rating in ("STRONG_BUY", "BUY") and price > 0:
        ma50 = _safe(st.get("ma50")) or price * 0.95
        entry = round(min(price, ma50 * 1.01), 2)
        stop = round(min(price, ma50) * 0.93, 2)
        t1 = round(price * 1.08, 2)
        t2 = round(target if target and target > price else price * 1.18, 2)
        trade_idea = {
            "stance": "Long bias",
            "entry_zone": [round(entry * 0.985, 2), round(entry * 1.015, 2)],
            "stop_loss": stop,
            "targets": [t1, t2],
            "horizon": "3–12 months",
            "risk_reward": round((t1 - entry) / max(0.01, entry - stop), 2),
            "size_hint": "Standard position (1–3% portfolio)",
        }
    elif rating in ("SELL", "REDUCE") and price > 0:
        trade_idea = {
            "stance": "Avoid / Trim",
            "entry_zone": None, "stop_loss": None,
            "targets": [round(price * 0.92, 2), round(price * 0.85, 2)],
            "horizon": "Wait for reversal",
            "risk_reward": None,
            "size_hint": "Reduce exposure if held",
        }

    # Forecasts
    forecasts = {
        "1M": _projected_return(st, 1),
        "3M": _projected_return(st, 3),
        "6M": _projected_return(st, 6),
        "1Y": _projected_return(st, 12),
    }

    # Risk profile
    beta = _safe(st.get("beta"))
    risk_level = (
        "Low" if (beta or 1) < 0.8 else
        "Moderate" if (beta or 1) < 1.3 else
        "High"
    )

    # Verdict summary text
    verdict_summary = _build_verdict_text(st, rating, score, upside, pros, cons)

    return {
        "symbol": symbol,
        "name": st.get("name"),
        "price": price,
        "change_pct": st.get("change_pct"),
        "currency": st.get("currency"),
        "sector": st.get("sector"),
        "industry": st.get("industry"),

        "verdict": {
            "rating": rating,
            "score": score,
            "summary": verdict_summary,
            "confidence": _confidence_from_count(st.get("analyst_count")),
        },
        "scores": breakdown,
        "real_analyst": {
            "consensus_key": st.get("recommendation_key"),
            "recommendation_mean": st.get("recommendation_mean"),
            "analyst_count": st.get("analyst_count"),
            "target_mean": st.get("target_mean_price"),
            "target_high": st.get("target_high_price"),
            "target_low": st.get("target_low_price"),
            "target_median": st.get("target_median_price"),
            "upside_pct": round(upside, 1) if upside is not None else None,
            "distribution": st.get("rating_distribution"),
            "latest_change": st.get("latest_upgrade_downgrade"),
        },
        "forecasts": forecasts,
        "valuation": {
            "pe": st.get("pe"), "forward_pe": st.get("forward_pe"),
            "pb": st.get("pb"), "ps": st.get("ps_ratio"), "peg": st.get("peg_ratio"),
            "market_cap": st.get("market_cap"),
        },
        "financials": {
            "revenue": st.get("total_revenue"),
            "ebitda": st.get("ebitda"),
            "free_cashflow": st.get("free_cashflow"),
            "operating_cashflow": st.get("operating_cashflow"),
            "total_cash": st.get("total_cash"),
            "total_debt": st.get("total_debt"),
            "gross_margin": st.get("gross_margin"),
            "operating_margin": st.get("operating_margin"),
            "profit_margin": st.get("profit_margin"),
            "roe": st.get("roe"), "roa": st.get("roa"),
            "debt_to_equity": st.get("debt_to_equity"),
            "current_ratio": st.get("current_ratio"),
            "quick_ratio": st.get("quick_ratio"),
            "eps": st.get("eps"),
            "eps_growth": st.get("eps_growth"),
            "revenue_growth": st.get("revenue_growth"),
            "eps_growth_next_year": st.get("eps_growth_next_year_pct"),
            "revenue_growth_next_year": st.get("revenue_growth_next_year_pct"),
            "latest_eps_surprise_pct": st.get("latest_eps_surprise_pct"),
        },
        "technicals": {
            "rsi": st.get("rsi"),
            "macd": st.get("macd"), "macd_signal": st.get("macd_signal"),
            "ma50": st.get("ma50"), "ma200": st.get("ma200"),
            "volume_surge": st.get("volume_surge"),
            "high_52w": st.get("high_52w"), "low_52w": st.get("low_52w"),
            "from_52w_high_pct": st.get("from_52w_high_pct"),
            "trend": _trend_label(st),
        },
        "risk": {
            "beta": beta,
            "level": risk_level,
            "debt_to_equity": st.get("debt_to_equity"),
            "drawdown_from_52w_high_pct": st.get("from_52w_high_pct"),
        },
        "catalysts": {
            "next_earnings_epoch": st.get("next_earnings_epoch"),
            "ex_dividend_epoch": st.get("ex_dividend_epoch"),
            "dividend_date_epoch": st.get("dividend_date_epoch"),
            "latest_upgrade_downgrade": st.get("latest_upgrade_downgrade"),
        },
        "ownership": {
            "pct_institutions": st.get("pct_institutions"),
            "pct_insiders": st.get("pct_insiders"),
            "top_institution": st.get("top_institution"),
        },
        "pros": pros[:6],
        "cons": cons[:6],
        "trade_idea": trade_idea,
        "profile": {
            "description": st.get("description"),
            "website": st.get("website"),
            "country": st.get("country"),
            "employees": st.get("employees"),
        },
    }


def _trend_label(st: Dict[str, Any]) -> str:
    p, m50, m200 = _safe(st.get("price")), _safe(st.get("ma50")), _safe(st.get("ma200"))
    if p and m50 and m200:
        if p > m50 > m200: return "Strong Uptrend"
        if p > m50 and m50 < m200: return "Recovery / Pullback"
        if p < m50 < m200: return "Downtrend"
        if p < m50 and m50 > m200: return "Weakening"
    return "Neutral"


def _build_verdict_text(st: Dict[str, Any], rating: str, score: float, upside: Optional[float], pros: List[str], cons: List[str]) -> str:
    name = st.get("name") or st.get("symbol")
    parts = []
    parts.append(f"{name} earns an AI rating of {rating.replace('_', ' ')} (score {score:.0f}/100).")
    if upside is not None:
        if upside > 0:
            parts.append(f"Wall Street consensus implies {upside:.1f}% upside to ${st.get('target_mean_price'):.2f}.")
        else:
            parts.append(f"Trading {abs(upside):.1f}% above analyst mean target.")
    elif st.get("analyst_count"):
        parts.append(f"Tracked by {st['analyst_count']} analysts.")
    parts.append(f"Trend: {_trend_label(st)}.")
    if pros:
        parts.append("Key positives: " + "; ".join(p.split('(')[0].strip() for p in pros[:2]) + ".")
    if cons and cons[0] != "No major red flags detected":
        parts.append("Watch: " + cons[0] + ".")
    return " ".join(parts)
