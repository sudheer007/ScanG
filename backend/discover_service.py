"""Discover service — high-signal widgets aggregating data from the existing universe.

All functions reuse the cached universe from stock_service so they are fast.
No external paid APIs needed.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from stock_service import get_market_universe, RADAR_STRATEGIES, _apply_strategy, get_movers
from stock_universe import currency


# -------------------------------------------------------------------
# Scoring helpers
# -------------------------------------------------------------------
def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _safe(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _ai_score(st: Dict[str, Any]) -> Tuple[float, Dict[str, float]]:
    """Multi-factor composite score 0-100 with breakdown.

    Factors (each 0-100):
        - momentum  (RSI sweet spot, %from52w high, change_pct)
        - value     (PE, PB) — lower PE/PB ⇒ higher score
        - quality   (ROE, profit margin, low debt)
        - growth    (EPS growth, revenue growth)
        - technical (above MA50/MA200, golden-cross, volume surge)
    """
    # --- momentum ---
    rsi = _safe(st.get("rsi"))
    chg = _safe(st.get("change_pct"))
    from52 = _safe(st.get("from_52w_high_pct"))
    m = 50.0
    if rsi is not None:
        # sweet spot 55-70 → max 30 pts, scale around
        m += _clip(30 - abs(62 - rsi) * 1.2, -20, 30)
    if from52 is not None:
        # closer to 52w-high (less negative) is better
        m += _clip(20 + from52 * 0.8, -20, 20)
    if chg is not None:
        m += _clip(chg * 1.5, -10, 10)
    momentum = _clip(m, 0, 100)

    # --- value ---
    pe = _safe(st.get("pe"))
    pb = _safe(st.get("pb"))
    v = 50.0
    if pe is not None and pe > 0:
        if pe < 12: v += 25
        elif pe < 18: v += 15
        elif pe < 25: v += 5
        elif pe < 40: v -= 5
        else: v -= 20
    if pb is not None and pb > 0:
        if pb < 1.5: v += 15
        elif pb < 3: v += 5
        elif pb > 6: v -= 15
    value = _clip(v, 0, 100)

    # --- quality ---
    roe = _safe(st.get("roe"))
    pm = _safe(st.get("profit_margin"))
    de = _safe(st.get("debt_to_equity"))
    q = 40.0
    if roe is not None:
        if roe >= 25: q += 30
        elif roe >= 15: q += 20
        elif roe >= 10: q += 10
        elif roe < 5: q -= 10
    if pm is not None:
        q += _clip(pm * 0.4, -10, 15)
    if de is not None:
        if de < 50: q += 10
        elif de > 150: q -= 15
    quality = _clip(q, 0, 100)

    # --- growth ---
    eg = _safe(st.get("eps_growth"))
    rg = _safe(st.get("revenue_growth"))
    g = 45.0
    if eg is not None: g += _clip(eg * 0.5, -15, 30)
    if rg is not None: g += _clip(rg * 0.5, -10, 20)
    growth = _clip(g, 0, 100)

    # --- technical ---
    price = _safe(st.get("price"))
    ma50 = _safe(st.get("ma50"))
    ma200 = _safe(st.get("ma200"))
    vs = _safe(st.get("volume_surge"))
    t = 50.0
    if price and ma50 and ma200:
        if price > ma50 > ma200: t += 20
        elif price > ma50: t += 10
        elif price < ma50 < ma200: t -= 15
    if vs is not None:
        t += _clip((vs - 1) * 12, -8, 15)
    technical = _clip(t, 0, 100)

    composite = momentum * 0.22 + value * 0.18 + quality * 0.22 + growth * 0.18 + technical * 0.20
    return round(composite, 1), {
        "momentum": round(momentum, 1),
        "value": round(value, 1),
        "quality": round(quality, 1),
        "growth": round(growth, 1),
        "technical": round(technical, 1),
    }


def _rating_from_score(score: float) -> str:
    if score >= 75: return "STRONG_BUY"
    if score >= 62: return "BUY"
    if score >= 48: return "HOLD"
    if score >= 35: return "REDUCE"
    return "SELL"


def _rating_distribution(st: Dict[str, Any]) -> Dict[str, int]:
    """Use REAL distribution from Yahoo when available, fall back to synthesized."""
    real = st.get("rating_distribution")
    if real and isinstance(real, dict) and "strong_buy" in real:
        return {
            "strong_buy": real.get("strong_buy", 0),
            "buy": real.get("buy", 0),
            "hold": real.get("hold", 0),
            "sell": real.get("sell", 0),
            "counts": real.get("counts"),
            "source": "yahoo",
        }
    score, _ = _ai_score(st)
    if score >= 75:
        d = {"strong_buy": 55, "buy": 30, "hold": 12, "sell": 3}
    elif score >= 62:
        d = {"strong_buy": 35, "buy": 40, "hold": 18, "sell": 7}
    elif score >= 48:
        d = {"strong_buy": 15, "buy": 30, "hold": 40, "sell": 15}
    elif score >= 35:
        d = {"strong_buy": 5, "buy": 18, "hold": 42, "sell": 35}
    else:
        d = {"strong_buy": 2, "buy": 10, "hold": 28, "sell": 60}
    d["source"] = "model"
    return d


# -------------------------------------------------------------------
# 1. AI Picks
# -------------------------------------------------------------------
async def ai_picks(market: str, limit: int = 20) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    enriched = []
    for st in universe:
        score, breakdown = _ai_score(st)
        rating = _rating_from_score(score)
        # rationale
        reasons = []
        if breakdown["momentum"] >= 70: reasons.append("Strong momentum")
        if breakdown["value"] >= 70: reasons.append("Attractive valuation")
        if breakdown["quality"] >= 70: reasons.append("High quality fundamentals")
        if breakdown["growth"] >= 70: reasons.append("Robust growth")
        if breakdown["technical"] >= 70: reasons.append("Bullish technicals")
        if not reasons: reasons.append("Mixed signals")
        item = dict(st)
        item["ai_score"] = score
        item["ai_breakdown"] = breakdown
        item["ai_rating"] = rating
        item["ai_reasons"] = reasons
        enriched.append(item)
    enriched.sort(key=lambda x: x["ai_score"], reverse=True)
    buys = [x for x in enriched if x["ai_rating"] in ("STRONG_BUY", "BUY")][:limit]
    holds = [x for x in enriched if x["ai_rating"] == "HOLD"][:limit]
    sells = [x for x in enriched if x["ai_rating"] in ("REDUCE", "SELL")]
    sells.sort(key=lambda x: x["ai_score"])
    sells = sells[:limit]
    return {
        "market": market.upper(),
        "currency": currency(market),
        "universe_size": len(universe),
        "buy": buys,
        "hold": holds,
        "sell": sells,
    }


# -------------------------------------------------------------------
# 2. Market-Moving Events
# -------------------------------------------------------------------
def _detect_events(stocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    import time as _t
    events: List[Dict[str, Any]] = []
    now_ts = int(_t.time())
    for st in stocks:
        chg = _safe(st.get("change_pct")) or 0
        vs = _safe(st.get("volume_surge")) or 0
        from52 = _safe(st.get("from_52w_high_pct"))
        rsi = _safe(st.get("rsi"))
        price, ma50, ma200 = _safe(st.get("price")), _safe(st.get("ma50")), _safe(st.get("ma200"))

        base = {
            "symbol": st["symbol"], "name": st.get("name"),
            "change_pct": chg, "currency": st.get("currency"),
            "price": st.get("price"), "sector": st.get("sector"),
        }

        # ---- Earnings calendar event ----
        ne = st.get("next_earnings_epoch")
        if ne and 0 < (ne - now_ts) <= 14 * 86400:
            days = int((ne - now_ts) / 86400)
            events.append({**base,
                "type": "earnings", "category": "Earnings",
                "title": f"Earnings in {days}d" if days >= 1 else "Earnings Today",
                "icon": "podium", "tone": "neutral",
                "detail": f"Reports {datetime.fromtimestamp(ne, tz=timezone.utc).strftime('%b %d')}" + (f" · {st.get('analyst_count')} analysts" if st.get('analyst_count') else ""),
                "ts": ne,
            })

        # ---- Ex-dividend event ----
        ex = st.get("ex_dividend_epoch")
        if ex and 0 < (ex - now_ts) <= 14 * 86400 and (st.get("dividend_yield") or 0) > 0:
            days = int((ex - now_ts) / 86400)
            events.append({**base,
                "type": "dividend", "category": "Dividend",
                "title": f"Ex-Dividend in {days}d" if days >= 1 else "Ex-Div Today",
                "icon": "cash", "tone": "pos",
                "detail": f"Yield {st.get('dividend_yield', 0):.2f}% · Ex {datetime.fromtimestamp(ex, tz=timezone.utc).strftime('%b %d')}",
                "ts": ex,
            })

        # ---- Analyst upgrade/downgrade event ----
        ud = st.get("latest_upgrade_downgrade")
        if ud and ud.get("date_epoch"):
            age = now_ts - ud["date_epoch"]
            if 0 <= age <= 14 * 86400:  # within last 2 weeks
                action = (ud.get("action") or "").lower()
                tone = "pos" if action in ("up", "init") else ("neg" if action == "down" else "neutral")
                events.append({**base,
                    "type": "analyst", "category": "Analyst",
                    "title": f"{ud.get('firm', 'Analyst')}: {ud.get('to_grade') or 'Rating'}",
                    "icon": "ribbon" if tone == "pos" else "alert-circle" if tone == "neg" else "people",
                    "tone": tone,
                    "detail": f"{ud.get('from_grade') or 'New'} → {ud.get('to_grade') or '—'}",
                    "ts": ud["date_epoch"],
                })

        # ---- Price events (existing logic) ----
        if from52 is not None and from52 >= -2 and chg > 0:
            events.append({**base,
                "type": "breakout", "category": "Technical",
                "title": "52-Week High Breakout", "icon": "ribbon", "tone": "pos",
                "detail": f"Within {abs(from52):.1f}% of 52-week high",
                "ts": now_ts,
            })
        elif chg <= -5:
            events.append({**base,
                "type": "selloff", "category": "Price",
                "title": "Heavy Sell-off", "icon": "trending-down", "tone": "neg",
                "detail": f"Down {chg:.1f}%" + (" on high volume" if vs > 1.5 else ""),
                "ts": now_ts,
            })
        elif chg >= 5:
            events.append({**base,
                "type": "surge", "category": "Price",
                "title": "Price Surge", "icon": "flash", "tone": "pos",
                "detail": f"Up {chg:.1f}%" + (" on volume" if vs > 1.8 else ""),
                "ts": now_ts,
            })

        if vs >= 2.5:
            events.append({**base,
                "type": "volume", "category": "Volume",
                "title": "Unusual Volume", "icon": "pulse",
                "tone": "pos" if chg >= 0 else "neg",
                "detail": f"Volume {vs:.1f}× 20-day average",
                "ts": now_ts,
            })

        # ---- EPS surprise event ----
        eps_surp = st.get("latest_eps_surprise_pct")
        if eps_surp is not None and abs(eps_surp) >= 5:
            events.append({**base,
                "type": "eps_surprise", "category": "Earnings",
                "title": f"EPS {'Beat' if eps_surp > 0 else 'Miss'} {abs(eps_surp):.0f}%",
                "icon": "trophy" if eps_surp > 0 else "warning",
                "tone": "pos" if eps_surp > 0 else "neg",
                "detail": f"Latest report {'beat' if eps_surp > 0 else 'missed'} estimates by {abs(eps_surp):.1f}%",
                "ts": now_ts,
            })

        if rsi is not None:
            if rsi >= 75:
                events.append({**base,
                    "type": "overbought", "category": "Technical",
                    "title": "Overbought (RSI)", "icon": "warning", "tone": "neg",
                    "detail": f"RSI at {rsi:.0f} — overheated", "ts": now_ts,
                })
            elif rsi <= 25:
                events.append({**base,
                    "type": "oversold", "category": "Technical",
                    "title": "Oversold (RSI)", "icon": "snow", "tone": "pos",
                    "detail": f"RSI at {rsi:.0f} — possible bounce", "ts": now_ts,
                })

        if price and ma50 and ma200 and ma50 > ma200 and (ma50 / ma200 - 1) < 0.01:
            events.append({**base,
                "type": "golden_cross", "category": "Technical",
                "title": "Golden Cross", "icon": "git-merge", "tone": "pos",
                "detail": "50-DMA just crossed above 200-DMA", "ts": now_ts,
            })

    priority = {"earnings": 1, "analyst": 2, "dividend": 3, "eps_surprise": 4,
                "breakout": 5, "surge": 6, "selloff": 7, "volume": 8,
                "golden_cross": 9, "overbought": 10, "oversold": 11}
    events.sort(key=lambda e: (priority.get(e["type"], 99), -abs(e.get("change_pct") or 0)))
    return events


async def market_events(market: str, limit: int = 40) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    events = _detect_events(universe)[:limit]
    # group by type for category tabs
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for ev in events:
        by_type.setdefault(ev["type"], []).append(ev)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "events": events,
        "by_type": by_type,
        "total": len(events),
    }


# -------------------------------------------------------------------
# 3. Hot Analyst Ratings
# -------------------------------------------------------------------
async def analyst_ratings(market: str, limit: int = 30) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    enriched = []
    for st in universe:
        score, breakdown = _ai_score(st)
        dist = _rating_distribution(st)
        # Use REAL consensus if available, else map from score
        real_key = (st.get("recommendation_key") or "").lower()
        if real_key:
            consensus_map = {
                "strong_buy": "STRONG_BUY", "buy": "BUY", "hold": "HOLD",
                "underperform": "REDUCE", "sell": "SELL", "strong_sell": "SELL",
            }
            consensus = consensus_map.get(real_key, _rating_from_score(score))
        else:
            consensus = _rating_from_score(score)
        # Use REAL target if available
        real_target = _safe(st.get("target_mean_price"))
        if real_target and st.get("price") and st["price"] > 0:
            price_target = real_target
            target_upside = round((real_target / st["price"] - 1) * 100, 2)
            target_source = "yahoo"
        elif st.get("price"):
            price_target = round(st["price"] * (1 + (score - 50) / 100 * 0.5), 2)
            target_upside = round((price_target / st["price"] - 1) * 100, 2)
            target_source = "model"
        else:
            price_target = None; target_upside = None; target_source = None
        analyst_count_real = st.get("analyst_count")
        analyst_count = int(analyst_count_real) if analyst_count_real else 8 + int(score / 8)
        # "hotness" = strong_buy weight + recent change + analyst count
        hot = dist["strong_buy"] + (_safe(st.get("change_pct")) or 0) * 0.5 + (analyst_count * 0.3 if analyst_count_real else 0)
        item = dict(st)
        item["consensus"] = consensus
        item["ratings"] = dist
        item["ai_score"] = score
        item["analyst_count"] = analyst_count
        item["hotness"] = hot
        item["price_target"] = price_target
        item["target_upside_pct"] = target_upside
        item["target_source"] = target_source
        item["target_high"] = st.get("target_high_price")
        item["target_low"] = st.get("target_low_price")
        item["latest_change"] = st.get("latest_upgrade_downgrade")
        enriched.append(item)
    enriched.sort(key=lambda x: x["hotness"], reverse=True)
    upgrades = [x for x in enriched if x["consensus"] in ("STRONG_BUY", "BUY")][:limit]
    downgrades = [x for x in enriched if x["consensus"] in ("SELL", "REDUCE")]
    downgrades.sort(key=lambda x: x["hotness"])
    return {
        "market": market.upper(),
        "currency": currency(market),
        "upgrades": upgrades,
        "downgrades": downgrades[:limit],
        "all": enriched[:limit],
    }


# -------------------------------------------------------------------
# 4. Popular Screeners (built on existing strategies)
# -------------------------------------------------------------------
async def popular_screeners(market: str) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    out = []
    for key, meta in RADAR_STRATEGIES.items():
        matches = _apply_strategy(universe, key)
        top = sorted(matches, key=lambda x: x.get("change_pct") or 0, reverse=True)[:3]
        out.append({
            "key": key,
            "title": meta["title"],
            "subtitle": meta["subtitle"],
            "icon": meta.get("icon"),
            "count": len(matches),
            "universe_size": len(universe),
            "top": top,
        })
    out.sort(key=lambda x: x["count"], reverse=True)
    return {"market": market.upper(), "currency": currency(market), "screeners": out}


# -------------------------------------------------------------------
# 5. Undervalued / Overvalued
# -------------------------------------------------------------------
async def valuation(market: str, limit: int = 25) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    # compute sector averages
    sector_pe: Dict[str, List[float]] = {}
    for st in universe:
        sec = st.get("sector")
        pe = _safe(st.get("pe"))
        if sec and pe and pe > 0:
            sector_pe.setdefault(sec, []).append(pe)
    sector_avg = {s: (sum(v) / len(v)) for s, v in sector_pe.items() if len(v) >= 3}

    under, over = [], []
    for st in universe:
        pe = _safe(st.get("pe"))
        pb = _safe(st.get("pb"))
        roe = _safe(st.get("roe")) or 0
        eg = _safe(st.get("eps_growth")) or 0
        if pe is None or pe <= 0:
            continue
        sec_pe = sector_avg.get(st.get("sector"))
        rel_pe = pe / sec_pe if sec_pe else None
        item = dict(st)
        item["sector_avg_pe"] = round(sec_pe, 1) if sec_pe else None
        item["relative_pe"] = round(rel_pe, 2) if rel_pe else None
        # undervalued: PE significantly below sector avg AND decent quality
        if rel_pe is not None and rel_pe <= 0.75 and roe >= 8:
            item["valuation_score"] = round((1 - rel_pe) * 100 + roe * 0.5, 1)
            item["valuation_tag"] = "Undervalued"
            under.append(item)
        elif pe < 15 and pb and pb < 2 and roe >= 12:
            item["valuation_score"] = round((20 - pe) * 2 + roe, 1)
            item["valuation_tag"] = "Undervalued"
            under.append(item)
        # overvalued: PE >> sector avg OR very high PE without high growth
        if rel_pe is not None and rel_pe >= 1.5 and eg < 25:
            item2 = dict(item)
            item2["valuation_score"] = round((rel_pe - 1) * 50, 1)
            item2["valuation_tag"] = "Overvalued"
            over.append(item2)
        elif pe > 60 and eg < 30:
            item2 = dict(item)
            item2["valuation_score"] = round(pe - 50, 1)
            item2["valuation_tag"] = "Overvalued"
            over.append(item2)

    under.sort(key=lambda x: x["valuation_score"], reverse=True)
    over.sort(key=lambda x: x["valuation_score"], reverse=True)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "undervalued": under[:limit],
        "overvalued": over[:limit],
        "sector_avg_pe": sector_avg,
    }


# -------------------------------------------------------------------
# 6. Top Investor Picks (style portfolios)
# -------------------------------------------------------------------
INVESTOR_STYLES = {
    "buffett": {
        "name": "Buffett-Style Quality",
        "icon": "shield-checkmark",
        "subtitle": "Wide-moat compounders with low debt",
        "criteria": "ROE>15, D/E<70, PE<25, profit margin>10",
    },
    "lynch": {
        "name": "Peter Lynch Growth-at-Reasonable-Price",
        "icon": "rocket",
        "subtitle": "GARP — high growth at fair valuations",
        "criteria": "EPS growth>15, PEG~<1.5, PE<30",
    },
    "graham": {
        "name": "Graham Deep Value",
        "icon": "trophy",
        "subtitle": "Cheap on book + earnings",
        "criteria": "PE<15, PB<2, debt low",
    },
    "growth": {
        "name": "Aggressive Growth",
        "icon": "flash",
        "subtitle": "Hyper-growth innovators",
        "criteria": "Revenue growth>25, EPS growth>25",
    },
    "dividend": {
        "name": "Dividend Aristocrats",
        "icon": "cash",
        "subtitle": "Steady income with quality",
        "criteria": "Div yield>2.5, ROE>10, D/E<100",
    },
}


def _match_style(st: Dict[str, Any], style: str) -> Optional[float]:
    pe = _safe(st.get("pe")); pb = _safe(st.get("pb"))
    roe = _safe(st.get("roe")); de = _safe(st.get("debt_to_equity"))
    pm = _safe(st.get("profit_margin"))
    eg = _safe(st.get("eps_growth")); rg = _safe(st.get("revenue_growth"))
    dy = _safe(st.get("dividend_yield"))

    if style == "buffett":
        if (roe or 0) >= 15 and (de is not None and de < 70) and (pe or 999) < 25 and (pm or 0) >= 10:
            return (roe or 0) + (30 - (pe or 30)) + (15 - (de or 50) / 5)
    elif style == "lynch":
        if (eg or 0) >= 15 and (pe or 999) < 30 and (pe or 999) > 0:
            peg = (pe or 30) / max(eg, 1)
            if peg < 1.7:
                return (eg or 0) - peg * 10 + 20
    elif style == "graham":
        if (pe or 999) < 15 and (pb or 999) < 2 and (de or 200) < 120:
            return (20 - (pe or 15)) + (3 - (pb or 1.5)) * 8 + ((roe or 0) * 0.5)
    elif style == "growth":
        if (rg or 0) >= 25 and (eg or 0) >= 25:
            return (rg or 0) + (eg or 0)
    elif style == "dividend":
        if (dy or 0) >= 2.5 and (roe or 0) >= 10 and (de or 200) < 100:
            return (dy or 0) * 5 + (roe or 0)
    return None


async def investor_picks(market: str, limit: int = 12) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    portfolios: Dict[str, Dict[str, Any]] = {}
    for key, meta in INVESTOR_STYLES.items():
        matches = []
        for st in universe:
            score = _match_style(st, key)
            if score is not None:
                item = dict(st)
                item["style_score"] = round(score, 1)
                item["style"] = key
                matches.append(item)
        matches.sort(key=lambda x: x["style_score"], reverse=True)
        portfolios[key] = {
            "key": key,
            **meta,
            "count": len(matches),
            "stocks": matches[:limit],
        }
    return {
        "market": market.upper(),
        "currency": currency(market),
        "portfolios": portfolios,
    }


# -------------------------------------------------------------------
# 7. Most Active (by volume surge proxy)
# -------------------------------------------------------------------
async def most_active(market: str, limit: int = 25) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    rows = [x for x in universe if (x.get("volume_surge") is not None)]
    rows.sort(key=lambda x: x.get("volume_surge") or 0, reverse=True)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "stocks": rows[:limit],
    }


# -------------------------------------------------------------------
# 8. Winners / Losers (uses existing get_movers)
# -------------------------------------------------------------------
async def winners_losers(market: str, limit: int = 25) -> Dict[str, Any]:
    gainers = await get_movers(market, "gainers", limit)
    losers = await get_movers(market, "losers", limit)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "gainers": gainers,
        "losers": losers,
    }


# -------------------------------------------------------------------
# Combined feed (preview) — fast single call for the discover tab
# -------------------------------------------------------------------
async def discover_feed(market: str) -> Dict[str, Any]:
    universe = await get_market_universe(market)

    # AI picks preview (top 5 by score)
    ai = []
    for st in universe:
        score, breakdown = _ai_score(st)
        ai.append({"symbol": st["symbol"], "name": st.get("name"), "price": st.get("price"),
                   "change_pct": st.get("change_pct"), "currency": st.get("currency"),
                   "sparkline": st.get("sparkline", [])[-12:], "ai_score": score,
                   "ai_rating": _rating_from_score(score),
                   "top_factor": max(breakdown.items(), key=lambda kv: kv[1])[0]})
    ai.sort(key=lambda x: x["ai_score"], reverse=True)
    ai_preview = ai[:5]

    # events preview
    events = _detect_events(universe)[:6]

    # analyst preview
    analyst_preview = []
    for st in sorted(universe, key=lambda x: (_safe(x.get("change_pct")) or 0), reverse=True)[:5]:
        score, _ = _ai_score(st)
        dist = _rating_distribution(st)
        analyst_preview.append({
            "symbol": st["symbol"], "name": st.get("name"),
            "price": st.get("price"), "change_pct": st.get("change_pct"),
            "currency": st.get("currency"),
            "consensus": _rating_from_score(score),
            "ratings": dist,
        })

    # popular screeners preview (just counts)
    screener_preview = []
    for key, meta in RADAR_STRATEGIES.items():
        n = len(_apply_strategy(universe, key))
        screener_preview.append({"key": key, **meta, "count": n})
    screener_preview.sort(key=lambda x: x["count"], reverse=True)

    # valuation preview
    val = await valuation(market, limit=3)

    # investor picks preview
    inv = await investor_picks(market, limit=2)
    inv_preview = []
    for key, meta in INVESTOR_STYLES.items():
        p = inv["portfolios"].get(key, {})
        inv_preview.append({
            "key": key, "name": meta["name"], "icon": meta["icon"],
            "subtitle": meta["subtitle"],
            "count": p.get("count", 0),
            "top": (p.get("stocks") or [])[:2],
        })

    # most active preview
    ma = await most_active(market, limit=5)
    wl = await winners_losers(market, limit=5)

    return {
        "market": market.upper(),
        "currency": currency(market),
        "universe_size": len(universe),
        "widgets": {
            "ai_picks":         {"preview": ai_preview},
            "events":           {"preview": events},
            "analyst_ratings":  {"preview": analyst_preview},
            "popular_screeners":{"preview": screener_preview[:4]},
            "valuation":        {"undervalued": val["undervalued"][:3], "overvalued": val["overvalued"][:3]},
            "investor_picks":   {"preview": inv_preview},
            "most_active":      {"preview": ma["stocks"]},
            "winners_losers":   {"gainers": wl["gainers"], "losers": wl["losers"]},
        },
    }
