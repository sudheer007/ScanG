"""Prediction ledger — accountability layer for every call the app makes.

Every rating, forecast, and radar match the app surfaces gets snapshotted
(symbol, price, predicted direction/return, horizon) into an append-only
Mongo ledger, then graded against reality once its horizon elapses. The
grade is always relative to the market benchmark (^GSPC / ^NSEI), never a
raw return — "+5% while the index did +8%" is a miss, not a win.

Nothing here is ever rewritten after the fact: capture happens once per
day per (symbol, type, key), resolution happens once per prediction. This
is what makes the resulting track record trustworthy instead of curated.

Pure grading/aggregation functions take plain dicts so they're unit
testable without a database or network. Orchestration functions (capture /
resolve) talk to Mongo + the existing stock/market services.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from stock_service import get_market_universe, get_bundle, get_history, _safe, RADAR_STRATEGIES, _apply_strategy
from discover_service import _ai_score, _rating_from_score
from analyzer_service import _projected_return
from stock_universe import currency

BENCHMARKS = {"US": "^GSPC", "IN": "^NSEI"}

# Horizon (days) + grading rules per prediction family.
RATING_HORIZON_DAYS = 90
RADAR_HORIZON_DAYS = 30
FORECAST_HORIZON_DAYS = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365}

# Cap per-strategy / per-day capture so the ledger doesn't balloon on a
# free-tier database — track the highest-conviction subset, not everything.
RADAR_CAPTURE_LIMIT = 40
RATING_CAPTURE_LIMIT = 120


# ======================================================================
# Pure grading logic (unit tested — no I/O)
# ======================================================================
def normalize_direction(pred_type: str, key: str, predicted_return_pct: Optional[float] = None) -> str:
    """What outcome would count as this prediction being right: up / down / flat."""
    if pred_type == "forecast":
        if predicted_return_pct is None:
            return "flat"
        return "up" if predicted_return_pct > 0.5 else ("down" if predicted_return_pct < -0.5 else "flat")
    if pred_type == "radar":
        return "up"  # every radar strategy in this app is a bullish scan
    if pred_type == "rating":
        k = key.upper()
        if k in ("STRONG_BUY", "BUY"):
            return "up"
        if k in ("SELL", "REDUCE", "STRONG_SELL"):
            return "down"
        return "flat"
    return "flat"


def grade_outcome(
    predicted_direction: str,
    alpha_pct: float,
    predicted_return_pct: Optional[float] = None,
    actual_return_pct: Optional[float] = None,
    flat_tolerance_pct: float = 5.0,
) -> Dict[str, Any]:
    """Grade a resolved prediction against benchmark-relative alpha.

    A "up" call is a hit if it beat the benchmark (positive alpha); a "down"
    call is a hit if it underperformed the benchmark (negative alpha); a
    "flat" call is a hit if alpha stayed within tolerance either way.
    """
    if predicted_direction == "up":
        outcome = "hit" if alpha_pct > 0 else "miss"
    elif predicted_direction == "down":
        outcome = "hit" if alpha_pct < 0 else "miss"
    else:
        outcome = "hit" if abs(alpha_pct) <= flat_tolerance_pct else "miss"

    magnitude_error_pct = None
    if predicted_return_pct is not None and actual_return_pct is not None:
        magnitude_error_pct = round(actual_return_pct - predicted_return_pct, 2)

    return {"outcome": outcome, "magnitude_error_pct": magnitude_error_pct}


def compute_scorecard(resolved: Sequence[Dict[str, Any]], group_by_key: bool = False) -> Dict[str, Any]:
    """Aggregate hit rate / avg alpha / avg predicted vs actual across graded predictions.

    If group_by_key, also returns a per-`key` breakdown (e.g. per radar
    strategy, per rating tier, per forecast horizon) so the UI can stamp
    each card individually from one call.
    """
    def summarize(docs: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        n = len(docs)
        if n == 0:
            return {"n": 0, "hit_rate_pct": None, "avg_alpha_pct": None,
                     "avg_predicted_return_pct": None, "avg_actual_return_pct": None,
                     "maturity": "no_data"}
        hits = sum(1 for d in docs if d.get("outcome") == "hit")
        alphas = [d["alpha_pct"] for d in docs if d.get("alpha_pct") is not None]
        preds = [d["predicted_return_pct"] for d in docs if d.get("predicted_return_pct") is not None]
        actuals = [d["actual_return_pct"] for d in docs if d.get("actual_return_pct") is not None]
        maturity = "building" if n < 20 else ("early" if n < 75 else "established")
        return {
            "n": n,
            "hit_rate_pct": round(hits * 100 / n, 1),
            "avg_alpha_pct": round(sum(alphas) / len(alphas), 2) if alphas else None,
            "avg_predicted_return_pct": round(sum(preds) / len(preds), 2) if preds else None,
            "avg_actual_return_pct": round(sum(actuals) / len(actuals), 2) if actuals else None,
            "maturity": maturity,
        }

    out: Dict[str, Any] = {"overall": summarize(resolved)}
    if group_by_key:
        by_key: Dict[str, List[Dict[str, Any]]] = {}
        for d in resolved:
            by_key.setdefault(d.get("key", "unknown"), []).append(d)
        out["by_key"] = {k: summarize(v) for k, v in by_key.items()}
    return out


# ======================================================================
# Orchestration — capture (snapshot predictions) and resolve (grade them)
# ======================================================================
def _today_str() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


async def _bench_price(market: str) -> Optional[float]:
    b = await get_bundle(BENCHMARKS[market])
    return _safe(b.get("price"))


async def capture_daily_snapshot(db, market: str) -> Dict[str, int]:
    """Snapshot today's ratings, forecasts, and top radar matches for one market.

    Idempotent per (symbol, pred_type, key, predicted_date) — safe to call
    more than once a day (e.g. a retried cron run) without duplicating rows.
    """
    universe = await get_market_universe(market)
    bench_symbol = BENCHMARKS[market]
    bench_price = await _bench_price(market)
    today = _today_str()
    now = datetime.now(tz=timezone.utc)
    inserted = 0

    async def _insert_if_new(symbol: str, pred_type: str, key: str, horizon_days: int,
                              price: float, predicted_return_pct: Optional[float]):
        nonlocal inserted
        existing = await db.predictions.find_one({
            "symbol": symbol, "pred_type": pred_type, "key": key, "predicted_date": today,
        })
        if existing:
            return
        direction = normalize_direction(pred_type, key, predicted_return_pct)
        doc = {
            "id": str(uuid.uuid4()),
            "symbol": symbol,
            "market": market.upper(),
            "pred_type": pred_type,
            "key": key,
            "predicted_direction": direction,
            "predicted_return_pct": predicted_return_pct,
            "predicted_at": now,
            "predicted_date": today,
            "price_at_prediction": price,
            "horizon_days": horizon_days,
            "resolve_at": now + timedelta(days=horizon_days),
            "benchmark_symbol": bench_symbol,
            "benchmark_price_at_prediction": bench_price,
            "resolved": False,
            "resolved_at": None,
            "actual_price": None,
            "actual_return_pct": None,
            "benchmark_return_pct": None,
            "alpha_pct": None,
            "outcome": None,
            "magnitude_error_pct": None,
        }
        await db.predictions.insert_one(doc)
        inserted += 1

    # --- Ratings (non-HOLD only — that's the decisive, falsifiable subset) ---
    rated = []
    for st in universe:
        price = _safe(st.get("price"))
        if not price:
            continue
        score, _ = _ai_score(st)
        rating = _rating_from_score(score)
        if rating != "HOLD":
            rated.append((st["symbol"], price, rating, score))
    rated.sort(key=lambda x: abs(x[3] - 50), reverse=True)  # most decisive first
    for symbol, price, rating, _score in rated[:RATING_CAPTURE_LIMIT]:
        await _insert_if_new(symbol, "rating", rating, RATING_HORIZON_DAYS, price, None)

    # --- Forecasts (1M/3M/6M/1Y model + analyst-consensus targets) ---
    for st in universe:
        price = _safe(st.get("price"))
        if not price:
            continue
        for label, days in FORECAST_HORIZON_DAYS.items():
            months = {"1M": 1, "3M": 3, "6M": 6, "1Y": 12}[label]
            fc = _projected_return(st, months)
            if not fc or fc.get("expected_return_pct") is None:
                continue
            await _insert_if_new(st["symbol"], "forecast", label, days, price, fc["expected_return_pct"])

    # --- Radar strategies (top matches per strategy, capped) ---
    for key in RADAR_STRATEGIES:
        matches = _apply_strategy(universe, key)
        matches = [m for m in matches if _safe(m.get("price"))][:RADAR_CAPTURE_LIMIT]
        for st in matches:
            await _insert_if_new(st["symbol"], "radar", key, RADAR_HORIZON_DAYS, st["price"], None)

    return {"market": market.upper(), "inserted": inserted, "date": today}


async def resolve_due(db, batch_limit: int = 400) -> Dict[str, int]:
    """Grade every prediction whose horizon has elapsed and isn't graded yet."""
    now = datetime.now(tz=timezone.utc)
    cursor = db.predictions.find({"resolved": False, "resolve_at": {"$lte": now}}).limit(batch_limit)
    due = await cursor.to_list(batch_limit)
    resolved = 0
    for doc in due:
        bundle = await get_bundle(doc["symbol"])
        actual_price = _safe(bundle.get("price"))
        if actual_price is None:
            continue
        bench_bundle = await get_bundle(doc["benchmark_symbol"])
        bench_price_now = _safe(bench_bundle.get("price"))

        price0 = doc.get("price_at_prediction")
        bench0 = doc.get("benchmark_price_at_prediction")
        if not price0 or price0 <= 0:
            continue
        actual_return_pct = round((actual_price / price0 - 1) * 100, 2)
        benchmark_return_pct = (
            round((bench_price_now / bench0 - 1) * 100, 2) if (bench0 and bench0 > 0 and bench_price_now) else None
        )
        alpha_pct = round(actual_return_pct - benchmark_return_pct, 2) if benchmark_return_pct is not None else actual_return_pct

        grade = grade_outcome(
            doc["predicted_direction"], alpha_pct,
            predicted_return_pct=doc.get("predicted_return_pct"),
            actual_return_pct=actual_return_pct,
        )
        await db.predictions.update_one(
            {"id": doc["id"]},
            {"$set": {
                "resolved": True,
                "resolved_at": now,
                "actual_price": actual_price,
                "actual_return_pct": actual_return_pct,
                "benchmark_return_pct": benchmark_return_pct,
                "alpha_pct": alpha_pct,
                "outcome": grade["outcome"],
                "magnitude_error_pct": grade["magnitude_error_pct"],
            }},
        )
        resolved += 1
    return {"resolved": resolved, "checked": len(due)}


async def get_track_record(db, market: Optional[str] = None, pred_type: Optional[str] = None,
                            key: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    q: Dict[str, Any] = {"resolved": True}
    if market:
        q["market"] = market.upper()
    if pred_type:
        q["pred_type"] = pred_type
    if key:
        q["key"] = key
    docs = await db.predictions.find(q, {"_id": 0}).sort("resolved_at", -1).to_list(2000)
    scorecard = compute_scorecard(docs, group_by_key=(key is None))
    scorecard["recent"] = docs[:limit]
    scorecard["filters"] = {"market": market, "pred_type": pred_type, "key": key}
    return scorecard


# ======================================================================
# Personal accountability — watchlist "since you added" performance
# ======================================================================
def _closest_close(history: List[Dict[str, Any]], target_epoch_sec: float) -> Optional[float]:
    if not history:
        return None
    best = min(history, key=lambda p: abs(datetime.fromisoformat(p["t"]).timestamp() - target_epoch_sec) if p.get("c") is not None else float("inf"))
    return _safe(best.get("c"))


async def since_added_performance(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """For each watchlist item, return has actually done since the user added it.

    Uses the symbol's own price history to find the close nearest the
    add timestamp — no separate price-at-add storage needed, and it's
    correct for items added before this feature existed.
    """
    results = []
    for it in items:
        symbol = it.get("symbol")
        market = (it.get("market") or "US").upper()
        added_at = it.get("added_at")
        if not symbol or not added_at:
            continue
        try:
            if hasattr(added_at, "timestamp"):
                added_ts = added_at.timestamp()
            elif isinstance(added_at, (int, float)):
                added_ts = float(added_at)
            else:
                added_ts = datetime.fromisoformat(str(added_at)).timestamp()
        except Exception:
            continue
        days_held = max(1, int((datetime.now(tz=timezone.utc).timestamp() - added_ts) / 86400))
        period = "5d" if days_held <= 5 else "1mo" if days_held <= 30 else "3mo" if days_held <= 90 else "1y" if days_held <= 365 else "2y"

        bench_symbol = BENCHMARKS.get(market, "^GSPC")
        stock_hist, bench_hist, bundle = await asyncio.gather(
            get_history(symbol, period, "1d"),
            get_history(bench_symbol, period, "1d"),
            get_bundle(symbol),
        )

        price0 = _closest_close(stock_hist, added_ts)
        bench0 = _closest_close(bench_hist, added_ts)
        price_now = _safe(bundle.get("price"))
        bench_now_hist = bench_hist[-1]["c"] if bench_hist else None

        if not price0 or not price_now:
            continue
        stock_return_pct = round((price_now / price0 - 1) * 100, 2)
        bench_return_pct = round((bench_now_hist / bench0 - 1) * 100, 2) if (bench0 and bench_now_hist) else None
        alpha_pct = round(stock_return_pct - bench_return_pct, 2) if bench_return_pct is not None else None

        results.append({
            "symbol": symbol,
            "name": bundle.get("name"),
            "added_days_ago": days_held,
            "price_at_add": round(price0, 2),
            "price_now": price_now,
            "return_pct": stock_return_pct,
            "benchmark_return_pct": bench_return_pct,
            "alpha_pct": alpha_pct,
        })

    if not results:
        return {"available": False, "reason": "not_enough_history", "items": []}

    avg_return = round(sum(r["return_pct"] for r in results) / len(results), 2)
    alphas = [r["alpha_pct"] for r in results if r["alpha_pct"] is not None]
    avg_alpha = round(sum(alphas) / len(alphas), 2) if alphas else None
    winners = sum(1 for r in results if r["return_pct"] > 0)

    return {
        "available": True,
        "count": len(results),
        "avg_return_pct": avg_return,
        "avg_alpha_pct": avg_alpha,
        "win_count": winners,
        "items": sorted(results, key=lambda r: r["return_pct"], reverse=True),
    }
