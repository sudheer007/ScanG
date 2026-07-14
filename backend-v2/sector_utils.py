"""Sector benchmarks, peer selection, and market inference for analyzer."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache

from discover_service import _ai_score, _rating_from_score, _safe
from stock_service import get_market_universe

SECTOR_BENCH_CACHE = TTLCache(maxsize=4, ttl=10 * 60)  # 10 min per market


def infer_market(symbol: str) -> str:
    return "IN" if symbol.upper().endswith(".NS") else "US"


def _avg(vals: List[float]) -> Optional[float]:
    return sum(vals) / len(vals) if vals else None


def sector_benchmarks(universe: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per-sector averages for P/E, P/B, ROE, revenue growth, AI score."""
    buckets: Dict[str, Dict[str, List[float]]] = {}
    for st in universe:
        sec = st.get("sector")
        if not sec:
            continue
        b = buckets.setdefault(sec, {"pe": [], "pb": [], "roe": [], "revenue_growth": [], "ai_score": []})
        pe = _safe(st.get("pe"))
        if pe and pe > 0:
            b["pe"].append(pe)
        pb = _safe(st.get("pb"))
        if pb and pb > 0:
            b["pb"].append(pb)
        roe = _safe(st.get("roe"))
        if roe is not None:
            b["roe"].append(roe)
        rg = _safe(st.get("revenue_growth"))
        if rg is not None:
            b["revenue_growth"].append(rg)
        b["ai_score"].append(_ai_score(st)[0])

    out: Dict[str, Dict[str, Any]] = {}
    for sec, b in buckets.items():
        if len(b["pe"]) < 3:
            continue
        out[sec] = {
            "sector": sec,
            "stock_count": len(b["ai_score"]),
            "avg_pe": round(_avg(b["pe"]) or 0, 1),
            "avg_pb": round(_avg(b["pb"]) or 0, 2) if b["pb"] else None,
            "avg_roe": round(_avg(b["roe"]) or 0, 1) if b["roe"] else None,
            "avg_revenue_growth": round(_avg(b["revenue_growth"]) or 0, 1) if b["revenue_growth"] else None,
            "avg_ai_score": round(_avg(b["ai_score"]) or 0, 1),
        }
    return out


def get_sector_benchmarks_cached(market: str, universe: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    key = market.upper()
    if key in SECTOR_BENCH_CACHE:
        return SECTOR_BENCH_CACHE[key]
    bench = sector_benchmarks(universe)
    SECTOR_BENCH_CACHE[key] = bench
    return bench


async def load_universe_benchmarks(symbol: str) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    market = infer_market(symbol)
    universe = await get_market_universe(market)
    benchmarks = get_sector_benchmarks_cached(market, universe)
    return universe, benchmarks


def _valuation_tag(relative_pe: Optional[float]) -> Optional[str]:
    if relative_pe is None:
        return None
    if relative_pe <= 0.85:
        return "Discount"
    if relative_pe >= 1.15:
        return "Premium"
    return "In-line"


def _score_percentile(score: float, sector_scores: List[float]) -> Optional[int]:
    if not sector_scores:
        return None
    below = sum(1 for s in sector_scores if s < score)
    return round(below * 100 / len(sector_scores))


def pick_peers(st: Dict[str, Any], universe: List[Dict[str, Any]], limit: int = 6) -> List[Dict[str, Any]]:
    sector = st.get("sector")
    sym = st.get("symbol")
    mcap = _safe(st.get("market_cap"))
    if not sector or not sym:
        return []

    candidates = [s for s in universe if s.get("sector") == sector and s.get("symbol") != sym]
    if not candidates:
        return []

    def mcap_dist(other: Dict[str, Any]) -> float:
        om = _safe(other.get("market_cap"))
        if mcap and om and mcap > 0 and om > 0:
            return abs(math.log(mcap) - math.log(om))
        return float("inf")

    def volume_growth_pct(p: Dict[str, Any]) -> Optional[float]:
        rvol = p.get("rvol")
        if rvol is not None:
            return round((rvol - 1) * 100, 1)
        surge = p.get("volume_surge")
        if surge is not None:
            return round((surge - 1) * 100, 1)
        return None

    candidates.sort(key=mcap_dist)
    peers = []
    for p in candidates[:limit]:
        ps, _ = _ai_score(p)
        peers.append({
            "symbol": p["symbol"],
            "name": p.get("name"),
            "ai_score": ps,
            "ai_rating": _rating_from_score(ps),
            "pe": p.get("pe"),
            "change_pct": p.get("change_pct"),
            "market_cap": p.get("market_cap"),
            "price": p.get("price"),
            "currency": p.get("currency"),
            "roe": p.get("roe"),
            "revenue_growth": p.get("revenue_growth"),
            "rvol": p.get("rvol"),
            "volume_growth_pct": volume_growth_pct(p),
        })
    return peers


def rank_in_sector(st: Dict[str, Any], universe: List[Dict[str, Any]]) -> Dict[str, Optional[int]]:
    sector = st.get("sector")
    sym = st.get("symbol")
    if not sector or not sym:
        return {"ai_score_rank": None, "pe_rank": None, "sector_total": None}

    sector_stocks = [s for s in universe if s.get("sector") == sector]
    total = len(sector_stocks)
    if total == 0:
        return {"ai_score_rank": None, "pe_rank": None, "sector_total": None}

    score, _ = _ai_score(st)
    scores = sorted([(_ai_score(s)[0], s.get("symbol")) for s in sector_stocks], reverse=True)
    ai_rank = next((i + 1 for i, (sc, s) in enumerate(scores) if s == sym), None)

    pe = _safe(st.get("pe"))
    pe_rank = None
    if pe and pe > 0:
        pe_list = sorted(
            [(_safe(s.get("pe")), s.get("symbol")) for s in sector_stocks if _safe(s.get("pe")) and _safe(s.get("pe")) > 0],
        )
        pe_rank = next((i + 1 for i, (_, s) in enumerate(pe_list) if s == sym), None)

    return {"ai_score_rank": ai_rank, "pe_rank": pe_rank, "sector_total": total}


def build_sector_context(
    st: Dict[str, Any],
    universe: List[Dict[str, Any]],
    benchmarks: Dict[str, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    sector = st.get("sector")
    if not sector or sector not in benchmarks:
        return None

    bench = benchmarks[sector]
    pe = _safe(st.get("pe"))
    avg_pe = bench.get("avg_pe")
    relative_pe = (pe / avg_pe) if (pe and pe > 0 and avg_pe and avg_pe > 0) else None
    vs_sector_pe_pct = round((relative_pe - 1) * 100, 1) if relative_pe is not None else None

    score, _ = _ai_score(st)
    sector_scores = [_ai_score(s)[0] for s in universe if s.get("sector") == sector]
    percentile = _score_percentile(score, sector_scores)
    ranks = rank_in_sector(st, universe)

    return {
        "sector": sector,
        "stock_count": bench.get("stock_count"),
        "avg_pe": avg_pe,
        "avg_pb": bench.get("avg_pb"),
        "avg_roe": bench.get("avg_roe"),
        "avg_revenue_growth": bench.get("avg_revenue_growth"),
        "avg_ai_score": bench.get("avg_ai_score"),
        "relative_pe": round(relative_pe, 2) if relative_pe is not None else None,
        "vs_sector_pe_pct": vs_sector_pe_pct,
        "valuation_tag": _valuation_tag(relative_pe),
        "ai_score_percentile": percentile,
        "ai_score_rank": ranks.get("ai_score_rank"),
        "pe_rank": ranks.get("pe_rank"),
        "sector_total": ranks.get("sector_total"),
    }
