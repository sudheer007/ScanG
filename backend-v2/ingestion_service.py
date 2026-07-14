"""FastAPI helpers for ingestion refresh endpoints (Phase 3)."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Header

from ingestion.batch import partition_info, run_batch, run_nightly
from ingestion.catalog import (
    DATASETS,
    MARKET_DATASETS,
    SMART_SCRAPE_DATASETS,
    SMART_SCRAPE_TTL_HOURS,
    TIER1_DATASETS,
    TIER2_DATASETS,
    TIER3_DATASETS,
    is_market_dataset,
)
from ingestion.db import get_async_db
from ingestion.market_pipeline import preview_market_scrape, scrape_market_datasets
from ingestion.pipeline import preview_symbol_scrape, scrape_symbol
from ingestion.coverage import compute_all_coverage
from ingestion.prerequisites import validate_prerequisites
from stock_universe import get_universe

log = logging.getLogger(__name__)

_queued_jobs: Dict[str, Dict[str, Any]] = {}


def check_ingestion_auth(x_ingestion_key: Optional[str] = Header(None, alias="X-Ingestion-Key")) -> None:
    expected = os.environ.get("INGESTION_ADMIN_KEY")
    if expected and x_ingestion_key != expected:
        raise HTTPException(status_code=403, detail="Invalid ingestion admin key")


def _validate_datasets(datasets: Optional[List[str]]) -> List[str]:
    selected = datasets or list(DATASETS)
    unknown = [d for d in selected if d not in DATASETS]
    if unknown:
        raise HTTPException(400, f"Unknown datasets: {unknown}")
    return selected


def _serialize_run(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = dict(doc)
    out.pop("_id", None)
    for key in ("started_at", "finished_at"):
        val = out.get(key)
        if isinstance(val, datetime):
            out[key] = val.isoformat()
    return out


async def _tier_coverage(db) -> Dict[str, Any]:
    """Per-tier ingestion coverage summaries for run health reporting."""
    tier1_counts = {
        "analyst_consensus": await db.analyst_consensus.estimated_document_count(),
        "earnings_history": await db.earnings_history.estimated_document_count(),
        "technical_indicators": await db.technical_indicators.estimated_document_count(),
        "price_history": await db.price_history.estimated_document_count(),
        "quote_snapshot": await db.quote_snapshots.estimated_document_count(),
        "stock_news": await db.stock_news.estimated_document_count(),
        "analyst_actions": await db.analyst_actions.estimated_document_count(),
    }

    tier2_counts = {
        "earnings_calendar": await db.earnings_calendar.estimated_document_count(),
        "dividend_calendar": await db.dividend_calendar.estimated_document_count(),
        "macro_events": await db.macro_events.estimated_document_count(),
        "index_sector_performance": await db.index_sector_performance.estimated_document_count(),
    }

    tier3_counts = {
        "ownership_promoter_fii_dii_mf": await db.ownership_promoter_fii_dii_mf.estimated_document_count(),
        "delivery_turnover_metrics": await db.delivery_turnover_metrics.estimated_document_count(),
    }

    us_size = len(get_universe("US"))
    in_size = len(get_universe("IN"))

    return {
        "tier1_coverage": {"documents": tier1_counts, "universe_us": us_size, "universe_in": in_size},
        "tier2_coverage": {"documents": tier2_counts},
        "tier3_coverage": {"documents": tier3_counts, "universe_in": in_size},
    }


async def ingestion_status() -> Dict[str, Any]:
    db = get_async_db()
    recent = await db.ingestion_runs.find({}, {"_id": 0}).sort("started_at", -1).limit(10).to_list(10)
    errors = await db.ingestion_errors.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    freshness_rows = await db.ingestion_freshness.aggregate([
        {"$group": {"_id": {"status": "$last_status", "dataset": "$dataset"}, "count": {"$sum": 1}}},
    ]).to_list(500)
    freshness_by_dataset: Dict[str, Dict[str, int]] = {}
    for row in freshness_rows:
        key = row["_id"]
        ds = key.get("dataset") or "unknown"
        status = key.get("status") or "unknown"
        freshness_by_dataset.setdefault(ds, {})[status] = row["count"]
    freshness_summary = {
        row["_id"]: row["count"]
        for row in await db.ingestion_freshness.aggregate([
            {"$group": {"_id": "$last_status", "count": {"$sum": 1}}},
        ]).to_list(100)
        if row.get("_id")
    }
    prerequisites = validate_prerequisites()
    tier_coverage = await _tier_coverage(db)
    universe_coverage = await asyncio.to_thread(compute_all_coverage)
    return {
        "partitions": partition_info(),
        "datasets": DATASETS,
        "symbol_datasets": [d for d in DATASETS if not is_market_dataset(d)],
        "market_datasets": MARKET_DATASETS,
        "tiers": {
            "tier1": TIER1_DATASETS,
            "tier2": TIER2_DATASETS,
            "tier3": TIER3_DATASETS,
        },
        "smart_scrape": {
            "datasets": SMART_SCRAPE_DATASETS,
            "ttl_hours": SMART_SCRAPE_TTL_HOURS,
        },
        "freshness_summary": freshness_summary,
        "freshness_by_dataset": freshness_by_dataset,
        "tier_coverage": tier_coverage,
        "universe_coverage": universe_coverage,
        "prerequisites": prerequisites,
        "recent_runs": [_serialize_run(r) for r in recent],
        "recent_errors": [_serialize_run(e) for e in errors],
        "queued_jobs": list(_queued_jobs.values())[-10:],
        "ts": datetime.now(timezone.utc).isoformat(),
    }


async def list_runs(*, limit: int = 25, run_type: Optional[str] = None) -> Dict[str, Any]:
    db = get_async_db()
    query: Dict[str, Any] = {}
    if run_type:
        query["run_type"] = run_type
    runs = await db.ingestion_runs.find(query, {"_id": 0}).sort("started_at", -1).limit(limit).to_list(limit)
    return {"count": len(runs), "runs": [_serialize_run(r) for r in runs]}


async def get_run(run_id: str) -> Dict[str, Any]:
    db = get_async_db()
    doc = await db.ingestion_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Run {run_id} not found")
    return _serialize_run(doc) or {}


def _queue_job(job_type: str, payload: Dict[str, Any]) -> str:
    job_id = str(uuid.uuid4())
    _queued_jobs[job_id] = {
        "job_id": job_id,
        "type": job_type,
        "status": "queued",
        "payload": payload,
        "queued_at": datetime.now(timezone.utc).isoformat(),
    }
    return job_id


def _finish_job(job_id: str, *, status: str, result: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    job = _queued_jobs.get(job_id)
    if not job:
        return
    job["status"] = status
    job["finished_at"] = datetime.now(timezone.utc).isoformat()
    if result is not None:
        job["result"] = result
    if error:
        job["error"] = error


async def refresh_symbol(
    symbol: str,
    *,
    market: Optional[str] = None,
    datasets: Optional[List[str]] = None,
    sync: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    selected = _validate_datasets(datasets)
    if sync:
        try:
            result = await asyncio.to_thread(
                scrape_symbol,
                symbol,
                market=market,
                datasets=selected,
                force=force,
            )
            return {"status": "completed", "force": force, "result": result}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, str(exc)) from exc

    job_id = _queue_job("symbol", {"symbol": symbol, "market": market, "datasets": selected, "force": force})

    async def _task() -> None:
        _queued_jobs[job_id]["status"] = "running"
        try:
            result = await asyncio.to_thread(
                scrape_symbol,
                symbol,
                market=market,
                datasets=selected,
                force=force,
            )
            _finish_job(job_id, status="completed", result=result)
        except Exception as exc:  # noqa: BLE001
            log.exception("symbol refresh failed %s", symbol)
            _finish_job(job_id, status="failed", error=str(exc))

    asyncio.create_task(_task())
    return {"job_id": job_id, "status": "queued", "symbol": symbol.upper(), "datasets": selected, "force": force}


async def refresh_market(
    market: str,
    *,
    datasets: Optional[List[str]] = None,
    batch_size: int = 25,
    dry_run: bool = False,
    sync: bool = False,
    offset: int = 0,
    limit: Optional[int] = None,
    force: bool = False,
) -> Dict[str, Any]:
    mkt = market.upper()
    if mkt not in ("US", "IN"):
        raise HTTPException(400, "market must be US or IN")
    selected = _validate_datasets(datasets)
    partition = "us_core" if mkt == "US" else "india_core"

    if sync or dry_run:
        try:
            result = await asyncio.to_thread(
                run_batch,
                partition=partition,
                datasets=selected,
                batch_size=batch_size,
                dry_run=dry_run,
                offset=offset,
                limit=limit,
                force=force,
            )
            return {"status": result.get("status", "completed"), "force": force, "result": result}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, str(exc)) from exc

    job_id = _queue_job(
        "market",
        {"market": mkt, "partition": partition, "datasets": selected, "batch_size": batch_size, "force": force},
    )

    async def _task() -> None:
        _queued_jobs[job_id]["status"] = "running"
        try:
            result = await asyncio.to_thread(
                run_batch,
                partition=partition,
                datasets=selected,
                batch_size=batch_size,
                dry_run=False,
                offset=offset,
                limit=limit,
                force=force,
            )
            _finish_job(job_id, status="completed", result=result)
        except Exception as exc:  # noqa: BLE001
            log.exception("market refresh failed %s", mkt)
            _finish_job(job_id, status="failed", error=str(exc))

    asyncio.create_task(_task())
    return {"job_id": job_id, "status": "queued", "market": mkt, "partition": partition, "force": force}


async def preview_symbol(
    symbol: str,
    *,
    market: Optional[str] = None,
    datasets: Optional[List[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    selected = _validate_datasets(datasets)
    try:
        return await asyncio.to_thread(
            preview_symbol_scrape,
            symbol,
            market=market,
            datasets=selected,
            force=force,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


async def refresh_dataset(
    dataset: str,
    *,
    symbol: Optional[str] = None,
    market: Optional[str] = None,
    batch_size: int = 25,
    dry_run: bool = False,
    sync: bool = False,
    offset: int = 0,
    limit: Optional[int] = None,
    force: bool = False,
) -> Dict[str, Any]:
    if dataset not in DATASETS:
        raise HTTPException(400, f"Unknown dataset. Expected one of {DATASETS}")

    if is_market_dataset(dataset):
        mkt = (market or "US").upper()
        if dry_run:
            preview = await asyncio.to_thread(preview_market_scrape, market=mkt, datasets=[dataset], force=force)
            return {"status": "dry_run", "force": force, "preview": preview}
        if sync:
            try:
                result = await asyncio.to_thread(
                    scrape_market_datasets, market=mkt, datasets=[dataset], force=force,
                )
                return {"status": "completed", "force": force, "result": result}
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(500, str(exc)) from exc
        raise HTTPException(400, "Market datasets require sync=true for refresh")

    if symbol:
        if dry_run and not sync:
            preview = await preview_symbol(symbol, market=market, datasets=[dataset], force=force)
            return {"status": "dry_run", "force": force, "preview": preview}
        return await refresh_symbol(symbol, market=market, datasets=[dataset], sync=sync, force=force)

    if not market:
        raise HTTPException(400, "Provide symbol or market for dataset refresh")
    return await refresh_market(
        market,
        datasets=[dataset],
        batch_size=batch_size,
        dry_run=dry_run,
        sync=sync,
        offset=offset,
        limit=limit,
        force=force,
    )


async def refresh_nightly(
    *,
    partitions: Optional[List[str]] = None,
    datasets: Optional[List[str]] = None,
    batch_size: int = 25,
    dry_run: bool = False,
    sync: bool = False,
    offset: int = 0,
    limit: Optional[int] = None,
    force: bool = False,
) -> Dict[str, Any]:
    selected = _validate_datasets(datasets)

    if sync or dry_run:
        try:
            result = await asyncio.to_thread(
                run_nightly,
                partitions=partitions,
                datasets=selected,
                batch_size=batch_size,
                dry_run=dry_run,
                offset=offset,
                limit=limit,
                force=force,
            )
            return {"status": result.get("status", "completed"), "force": force, "result": result}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, str(exc)) from exc

    job_id = _queue_job(
        "nightly",
        {"partitions": partitions, "datasets": selected, "batch_size": batch_size, "force": force},
    )

    async def _task() -> None:
        _queued_jobs[job_id]["status"] = "running"
        try:
            result = await asyncio.to_thread(
                run_nightly,
                partitions=partitions,
                datasets=selected,
                batch_size=batch_size,
                dry_run=False,
                offset=offset,
                limit=limit,
                force=force,
            )
            _finish_job(job_id, status="completed", result=result)
        except Exception as exc:  # noqa: BLE001
            log.exception("nightly refresh failed")
            _finish_job(job_id, status="failed", error=str(exc))

    asyncio.create_task(_task())
    return {"job_id": job_id, "status": "queued", "dry_run": False, "force": force}
