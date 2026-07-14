"""Universe-level ingestion coverage and freshness SLA reporting."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from stock_universe import get_universe

from ingestion import collections as c
from ingestion.catalog import (
    DATASET_CORPORATE_ACTIONS,
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_OWNERSHIP,
)
from ingestion.db import get_sync_db

FRESHNESS_SLA_HOURS = 48


def _pct(covered: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(100.0 * covered / total, 1)


def _symbols_with_data(db, collection: str, symbols: List[str]) -> set[str]:
    if not symbols:
        return set()
    pipeline = [
        {"$match": {"symbol": {"$in": symbols}}},
        {"$group": {"_id": "$symbol"}},
    ]
    return {row["_id"] for row in db[collection].aggregate(pipeline)}


def _symbols_with_statements(db, symbols: List[str]) -> set[str]:
    """Symbols with income + balance + cashflow annual rows."""
    if not symbols:
        return set()
    pipeline = [
        {"$match": {"symbol": {"$in": symbols}, "period_type": "annual"}},
        {"$group": {"_id": "$symbol", "types": {"$addToSet": "$statement_type"}}},
        {"$match": {"types": {"$all": ["income", "balance", "cashflow"]}}},
    ]
    return {row["_id"] for row in db[c.FINANCIAL_STATEMENTS].aggregate(pipeline)}


def _freshness_sla(db, dataset: str, *, market: Optional[str] = None) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    query: Dict[str, Any] = {"dataset": dataset}
    if market:
        query["$or"] = [{"market": market}, {"symbol": {"$exists": True}}]
    stale = 0
    fresh = 0
    missing = 0
    for doc in db[c.INGESTION_FRESHNESS].find(query):
        anchor = doc.get("last_success_at") or doc.get("last_attempt_at")
        if not anchor:
            missing += 1
            continue
        if not isinstance(anchor, datetime):
            missing += 1
            continue
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=timezone.utc)
        hours = (now - anchor).total_seconds() / 3600
        if hours <= FRESHNESS_SLA_HOURS:
            fresh += 1
        else:
            stale += 1
    return {"dataset": dataset, "fresh": fresh, "stale": stale, "missing_anchor": missing, "sla_hours": FRESHNESS_SLA_HOURS}


def compute_universe_coverage(market: str) -> Dict[str, Any]:
    """% symbol coverage for core datasets vs app universe."""
    mkt = market.upper()
    symbols = [s.upper() for s in get_universe(mkt)]
    total = len(symbols)
    if total == 0:
        return {"market": mkt, "symbol_count": 0, "coverage_pct": {}}

    try:
        db = get_sync_db()
    except Exception as exc:  # noqa: BLE001
        return {"market": mkt, "symbol_count": total, "error": str(exc), "coverage_pct": {}}

    with_instrument = _symbols_with_data(db, c.INSTRUMENTS, symbols)
    with_statements = _symbols_with_statements(db, symbols)
    with_ownership = _symbols_with_data(db, c.OWNERSHIP_INSIDER, symbols)
    with_corp = _symbols_with_data(db, c.CORPORATE_ACTIONS, symbols)
    with_ratios = _symbols_with_data(db, c.RATIOS_FUNDAMENTALS, symbols)

    return {
        "market": mkt,
        "symbol_count": total,
        "covered": {
            "instruments": len(with_instrument),
            "financial_statements_complete": len(with_statements),
            "ownership_insider": len(with_ownership),
            "corporate_actions": len(with_corp),
            "ratios_fundamentals": len(with_ratios),
        },
        "coverage_pct": {
            "instruments": _pct(len(with_instrument), total),
            "financial_statements_complete": _pct(len(with_statements), total),
            "ownership_insider": _pct(len(with_ownership), total),
            "corporate_actions": _pct(len(with_corp), total),
            "ratios_fundamentals": _pct(len(with_ratios), total),
        },
        "freshness_sla": [
            _freshness_sla(db, DATASET_FINANCIAL_STATEMENTS),
            _freshness_sla(db, DATASET_OWNERSHIP),
            _freshness_sla(db, DATASET_CORPORATE_ACTIONS),
        ],
    }


def compute_all_coverage() -> Dict[str, Any]:
    us = compute_universe_coverage("US")
    india = compute_universe_coverage("IN")
    return {
        "us": us,
        "india": india,
        "freshness_sla_hours": FRESHNESS_SLA_HOURS,
        "summary": {
            "us_instruments_pct": us.get("coverage_pct", {}).get("instruments", 0),
            "in_instruments_pct": india.get("coverage_pct", {}).get("instruments", 0),
            "us_statements_pct": us.get("coverage_pct", {}).get("financial_statements_complete", 0),
            "in_statements_pct": india.get("coverage_pct", {}).get("financial_statements_complete", 0),
        },
    }
