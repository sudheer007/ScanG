"""Mongo-first curated data access with Yahoo fallback merge helpers."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from ingestion import collections as c
from ingestion.db import get_sync_db

log = logging.getLogger(__name__)

# Investing ratio keys -> bundle field names
RATIO_FIELD_MAP: Dict[str, str] = {
    "pe_ratio_ttm": "pe",
    "forward_pe_ratio": "forward_pe",
    "price_to_book_ttm": "pb",
    "price_to_sales_ttm": "ps_ratio",
    "peg_ratio_ttm": "peg_ratio",
    "return_on_equity_ttm": "roe",
    "return_on_assets_ttm": "roa",
    "debt_to_equity_ttm": "debt_to_equity",
    "dividend_yield_ttm": "dividend_yield",
    "beta": "beta",
    "profit_margin_ttm": "profit_margin",
    "operating_margin_ttm": "operating_margin",
    "gross_margin_ttm": "gross_margin",
    "current_ratio_ttm": "current_ratio",
    "quick_ratio_ttm": "quick_ratio",
    "eps_ttm": "eps",
}

INCOME_LINE_MAP: Dict[str, str] = {
    "total_revenues_standard": "total_revenue",
    "ebitda_standard": "ebitda",
    "operating_income_standard": "operating_income",
    "net_income_standard": "net_income",
    "free_cash_flow_standard": "free_cashflow",
}


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


def _line_value(line_items: Dict[str, Any], key: str) -> Optional[float]:
    item = (line_items or {}).get(key) or {}
    if isinstance(item, dict):
        return _safe_float(item.get("value"))
    return _safe_float(item)


def _latest_doc(coll, symbol: str) -> Optional[Dict[str, Any]]:
    return coll.find_one({"symbol": symbol}, sort=[("as_of_date", -1)])


def _serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


def load_symbol_enrichment(symbol: str) -> Dict[str, Any]:
    """Load latest curated Investing.com documents for a symbol."""
    sym = symbol.upper()
    try:
        db = get_sync_db()
    except Exception as exc:  # noqa: BLE001
        log.debug("mongo unavailable for %s: %s", sym, exc)
        return {"symbol": sym, "available": False, "sections": {}}

    sections: Dict[str, Any] = {}
    try:
        if doc := _serialize_doc(db[c.INSTRUMENTS].find_one({"symbol": sym})):
            sections["instrument"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.RATIOS_FUNDAMENTALS], sym)):
            sections["ratios"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.OWNERSHIP_INSIDER], sym)):
            sections["ownership"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.ANALYST_CONSENSUS], sym)):
            sections["analyst_consensus"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.EARNINGS_HISTORY], sym)):
            sections["earnings_history"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.QUOTE_SNAPSHOTS], sym)):
            sections["quote_snapshot"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.OWNERSHIP_PROMOTER], sym)):
            sections["ownership_promoter"] = doc
        if doc := _serialize_doc(_latest_doc(db[c.DELIVERY_TURNOVER], sym)):
            sections["delivery_turnover"] = doc

        statements = list(
            db[c.FINANCIAL_STATEMENTS].find({"symbol": sym}, {"_id": 0})
            .sort([("period_end", -1)])
            .limit(60)
        )
        if statements:
            sections["financial_statements"] = statements

        corp_actions = list(
            db[c.CORPORATE_ACTIONS].find({"symbol": sym}, {"_id": 0})
            .sort([("action_date", -1)])
            .limit(40)
        )
        if corp_actions:
            sections["corporate_actions"] = corp_actions

        analyst_actions = list(
            db[c.ANALYST_ACTIONS].find({"symbol": sym}, {"_id": 0})
            .sort([("action_date", -1)])
            .limit(20)
        )
        if analyst_actions:
            sections["analyst_actions"] = analyst_actions
    except Exception as exc:  # noqa: BLE001
        log.warning("mongo read failed for %s: %s", sym, exc)
        return {"symbol": sym, "available": False, "sections": {}, "error": str(exc)}

    return {
        "symbol": sym,
        "available": bool(sections),
        "sections": sections,
    }


def batch_load_enrichment(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Batch enrichment for universe paths (instruments + ratios only)."""
    if not symbols:
        return {}
    sym_set = [s.upper() for s in symbols]
    try:
        db = get_sync_db()
    except Exception:  # noqa: BLE001
        return {}

    out: Dict[str, Dict[str, Any]] = {}
    try:
        for doc in db[c.INSTRUMENTS].find({"symbol": {"$in": sym_set}}, {"_id": 0}):
            sym = doc.get("symbol")
            if sym:
                out.setdefault(sym, {"symbol": sym, "available": True, "sections": {}})
                out[sym]["sections"]["instrument"] = doc

        pipeline = [
            {"$match": {"symbol": {"$in": sym_set}}},
            {"$sort": {"as_of_date": -1}},
            {"$group": {"_id": "$symbol", "doc": {"$first": "$$ROOT"}}},
        ]
        for coll_name in (c.RATIOS_FUNDAMENTALS, c.ANALYST_CONSENSUS, c.OWNERSHIP_INSIDER):
            for row in db[coll_name].aggregate(pipeline):
                sym = row["_id"]
                doc = {k: v for k, v in row["doc"].items() if k != "_id"}
                out.setdefault(sym, {"symbol": sym, "available": True, "sections": {}})
                key = {
                    c.RATIOS_FUNDAMENTALS: "ratios",
                    c.ANALYST_CONSENSUS: "analyst_consensus",
                    c.OWNERSHIP_INSIDER: "ownership",
                }[coll_name]
                out[sym]["sections"][key] = doc
    except Exception as exc:  # noqa: BLE001
        log.warning("batch mongo read failed: %s", exc)
    return out


def _apply_ratio_overrides(bundle: Dict[str, Any], ratios_doc: Dict[str, Any], sources: Set[str]) -> None:
    ratios = ratios_doc.get("ratios") or {}
    for src_key, bundle_key in RATIO_FIELD_MAP.items():
        val = _safe_float(ratios.get(src_key))
        if val is not None:
            bundle[bundle_key] = val
            sources.add(f"ratios.{bundle_key}")
    roce = (ratios_doc.get("roce_roic") or {})
    if roce.get("roce_available"):
        bundle["roce"] = roce.get("roce")
        sources.add("ratios.roce")
    if roce.get("roic_available"):
        bundle["roic"] = roce.get("roic")
        sources.add("ratios.roic")


def _apply_instrument_overrides(bundle: Dict[str, Any], inst: Dict[str, Any], sources: Set[str]) -> None:
    for key in ("sector", "industry", "description", "website", "employees", "exchange", "isin"):
        val = inst.get(key)
        if val is not None:
            bundle[key] = val
            sources.add(f"instrument.{key}")


def _apply_ownership_overrides(bundle: Dict[str, Any], own: Dict[str, Any], sources: Set[str]) -> None:
    breakdown = own.get("holdings_breakdown") or own.get("pct_shares_outstanding")
    if isinstance(breakdown, dict):
        inst = (breakdown.get("total_institutional_holdings") or {}).get("percent")
        if inst is not None:
            bundle["pct_institutions"] = inst
            sources.add("ownership.pct_institutions")
    institutional = own.get("institutional") or []
    if institutional and isinstance(institutional[0], dict):
        bundle["top_institution"] = institutional[0].get("owner_name")
        sources.add("ownership.top_institution")
    insiders = own.get("insider_transactions") or []
    if insiders:
        bundle["pct_insiders"] = insiders[0].get("pct_outstanding")
        sources.add("ownership.insiders")


def _apply_consensus_overrides(bundle: Dict[str, Any], consensus: Dict[str, Any], sources: Set[str]) -> None:
    c_block = consensus.get("consensus") or {}
    if c_block.get("target_mean") is not None:
        bundle["target_mean_price"] = c_block["target_mean"]
        sources.add("analyst_consensus.target_mean")
    if c_block.get("target_high") is not None:
        bundle["target_high_price"] = c_block["target_high"]
        sources.add("analyst_consensus.target_high")
    if c_block.get("target_low") is not None:
        bundle["target_low_price"] = c_block["target_low"]
        sources.add("analyst_consensus.target_low")
    rec = (c_block.get("recommendation") or "").upper()
    if rec:
        bundle["recommendation_key"] = rec.replace(" ", "_").lower()
        sources.add("analyst_consensus.recommendation")
    counts = consensus.get("rating_counts") or {}
    total = sum(v or 0 for v in counts.values())
    if total:
        bundle["analyst_count"] = total
        sources.add("analyst_consensus.analyst_count")


def _latest_income_snapshot(statements: List[Dict[str, Any]]) -> Dict[str, Any]:
    income = [s for s in statements if s.get("statement_type") == "income" and s.get("period_type") == "annual"]
    if not income:
        income = [s for s in statements if s.get("statement_type") == "income"]
    if not income:
        return {}
    latest = sorted(income, key=lambda x: x.get("period_end") or "", reverse=True)[0]
    line_items = latest.get("line_items") or {}
    snap: Dict[str, Any] = {"period_end": latest.get("period_end"), "period_type": latest.get("period_type")}
    for line_key, bundle_key in INCOME_LINE_MAP.items():
        val = _line_value(line_items, line_key)
        if val is not None:
            snap[bundle_key] = val
    return snap


def merge_enrichment_into_bundle(bundle: Dict[str, Any], enrichment: Dict[str, Any]) -> Dict[str, Any]:
    """Overlay Mongo curated fields onto a Yahoo bundle (Mongo-first for fundamentals)."""
    if not enrichment.get("available"):
        bundle.setdefault("_data_sources", {"primary": "yahoo"})
        return bundle

    sections = enrichment.get("sections") or {}
    sources: Set[str] = set()

    if inst := sections.get("instrument"):
        _apply_instrument_overrides(bundle, inst, sources)
    if ratios := sections.get("ratios"):
        _apply_ratio_overrides(bundle, ratios, sources)
    if own := sections.get("ownership"):
        _apply_ownership_overrides(bundle, own, sources)
    if consensus := sections.get("analyst_consensus"):
        _apply_consensus_overrides(bundle, consensus, sources)

    statements = sections.get("financial_statements") or []
    if statements:
        snap = _latest_income_snapshot(statements)
        for k, v in snap.items():
            if k in ("period_end", "period_type"):
                continue
            if v is not None:
                bundle[k] = v
                sources.add(f"financial_statements.{k}")
        bundle["statement_history"] = _compact_statement_history(statements)
        sources.add("financial_statements.history")

    if promoter := sections.get("ownership_promoter"):
        bundle["india_holdings"] = promoter
        sources.add("ownership_promoter")
    if delivery := sections.get("delivery_turnover"):
        bundle["delivery_turnover"] = delivery
        sources.add("delivery_turnover")

    bundle["_mongo_sections"] = list(sections.keys())
    bundle["_data_sources"] = {
        "primary": "yahoo",
        "investing_fields": sorted(sources),
        "investing": bool(sources),
    }
    return bundle


def _compact_statement_history(statements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for stmt in statements[:24]:
        line_items = stmt.get("line_items") or {}
        rows.append({
            "statement_type": stmt.get("statement_type"),
            "period_type": stmt.get("period_type"),
            "period_end": stmt.get("period_end"),
            "revenue": _line_value(line_items, "total_revenues_standard"),
            "net_income": _line_value(line_items, "net_income_standard"),
            "ebitda": _line_value(line_items, "ebitda_standard"),
        })
    return rows


def build_events_from_mongo(enrichment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Build stock events payload from Mongo when available."""
    sections = enrichment.get("sections") or {}
    if not sections:
        return None

    analyst_actions: List[Dict[str, Any]] = []
    for row in sections.get("analyst_actions") or []:
        action = (row.get("action") or "").lower()
        tone = "pos" if action in ("upgrade", "buy", "outperform") else (
            "neg" if action in ("downgrade", "sell", "underperform") else "neutral"
        )
        analyst_actions.append({
            "date_epoch": row.get("action_date"),
            "firm": row.get("firm_name"),
            "from_grade": row.get("past_rating"),
            "to_grade": row.get("rating"),
            "action": action or None,
            "tone": tone,
            "source": "investing.com",
        })

    earnings_history: List[Dict[str, Any]] = []
    eh = sections.get("earnings_history") or {}
    for q in (eh.get("quarters") or [])[:8]:
        earnings_history.append({
            "quarter_epoch": q.get("date"),
            "eps_actual": q.get("eps_actual"),
            "eps_estimate": q.get("eps_forecast"),
            "surprise_pct": q.get("eps_surprise_pct"),
            "source": "investing.com",
        })

    if not analyst_actions and not earnings_history:
        return None

    consensus = (sections.get("analyst_consensus") or {}).get("consensus") or {}
    return {
        "analyst_actions": analyst_actions,
        "earnings_history": earnings_history,
        "recommendation_key": (consensus.get("recommendation") or "").lower().replace(" ", "_") or None,
        "target_mean_price": consensus.get("target_mean"),
        "_source": "investing.com",
    }


def merge_events(yahoo_events: Dict[str, Any], mongo_events: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Prefer Mongo analyst/earnings history; keep Yahoo calendar fields as fallback."""
    if not mongo_events:
        yahoo_events["_data_sources"] = {"events": "yahoo"}
        return yahoo_events

    out = dict(yahoo_events)
    if mongo_events.get("analyst_actions"):
        out["analyst_actions"] = mongo_events["analyst_actions"]
    if mongo_events.get("earnings_history"):
        out["earnings_history"] = mongo_events["earnings_history"]
    for key in ("recommendation_key", "target_mean_price"):
        if mongo_events.get(key) is not None:
            out[key] = mongo_events[key]

    sources = []
    if mongo_events.get("analyst_actions"):
        sources.append("analyst_actions")
    if mongo_events.get("earnings_history"):
        sources.append("earnings_history")
    out["_data_sources"] = {"events": sources or ["yahoo"], "primary": "investing.com" if sources else "yahoo"}
    return out


def analyzer_section_sources(bundle: Dict[str, Any]) -> Dict[str, str]:
    """Map analyzer sections to data source labels."""
    mongo_fields = set((bundle.get("_data_sources") or {}).get("investing_fields") or [])
    def _src(prefix: str, fallback: str = "yahoo") -> str:
        return "investing.com" if any(f.startswith(prefix) for f in mongo_fields) else fallback

    return {
        "financials": _src("financial_statements", "yahoo" if bundle.get("total_revenue") else "unavailable"),
        "ownership": _src("ownership", "yahoo" if bundle.get("pct_institutions") else "unavailable"),
        "valuation": _src("ratios", "yahoo"),
        "real_analyst": _src("analyst_consensus", "yahoo"),
        "profile": _src("instrument", "yahoo"),
    }
