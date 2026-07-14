"""Bounded batch ingestion runner with US/India market partitions (Phase 3)."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from stock_universe import get_universe

from ingestion.catalog import DATASETS, MARKET_DATASETS, SYMBOL_DATASETS, is_market_dataset
from ingestion.db import ensure_indexes, get_sync_db
from ingestion.market_pipeline import preview_market_scrape, scrape_market_datasets
from ingestion.pipeline import preview_symbol_scrape, scrape_symbol
from ingestion.run_logger import BatchRunLogger

log = logging.getLogger(__name__)

# Market partition windows for nightly ingestion
MARKET_PARTITIONS: Dict[str, Dict[str, str]] = {
    "us_core": {"market": "US", "label": "US S&P-heavy core universe"},
    "india_core": {"market": "IN", "label": "India NIFTY/BSE core universe"},
}

ALL_PARTITIONS: Tuple[str, ...] = tuple(MARKET_PARTITIONS.keys())
DEFAULT_BATCH_SIZE = 25
DEFAULT_INTER_BATCH_DELAY_S = 2.0


def partition_info() -> List[Dict[str, Any]]:
    """Return partition metadata with symbol counts."""
    out: List[Dict[str, Any]] = []
    for key, meta in MARKET_PARTITIONS.items():
        symbols = get_universe(meta["market"])
        out.append({
            "partition": key,
            "market": meta["market"],
            "label": meta["label"],
            "symbol_count": len(symbols),
        })
    return out


def resolve_symbols(
    *,
    partition: Optional[str] = None,
    market: Optional[str] = None,
    symbols: Optional[List[str]] = None,
    offset: int = 0,
    limit: Optional[int] = None,
) -> Tuple[str, List[str]]:
    """Resolve the symbol list and market for a batch run."""
    if symbols:
        mkt = (market or "US").upper()
        resolved = [s.upper() for s in symbols]
    elif partition:
        if partition not in MARKET_PARTITIONS:
            raise ValueError(f"Unknown partition: {partition}. Expected one of {ALL_PARTITIONS}")
        mkt = MARKET_PARTITIONS[partition]["market"]
        resolved = list(get_universe(mkt))
    elif market:
        mkt = market.upper()
        resolved = list(get_universe(mkt))
    else:
        raise ValueError("Provide partition, market, or explicit symbols")

    if offset:
        resolved = resolved[offset:]
    if limit is not None:
        resolved = resolved[:limit]
    return mkt, resolved


def iter_batches(symbols: List[str], batch_size: int) -> Iterable[List[str]]:
    size = max(1, batch_size)
    for i in range(0, len(symbols), size):
        yield symbols[i : i + size]


def _split_datasets(datasets: Optional[List[str]]) -> tuple[List[str], List[str]]:
    selected = datasets or list(DATASETS)
    symbol_ds = [d for d in selected if not is_market_dataset(d)]
    market_ds = [d for d in selected if is_market_dataset(d)]
    return symbol_ds, market_ds


def _validate_datasets(datasets: Optional[List[str]]) -> List[str]:
    selected = datasets or list(DATASETS)
    unknown = [d for d in selected if d not in DATASETS]
    if unknown:
        raise ValueError(f"Unknown datasets: {unknown}. Expected subset of {DATASETS}")
    return selected


def run_batch(
    *,
    partition: Optional[str] = None,
    market: Optional[str] = None,
    symbols: Optional[List[str]] = None,
    datasets: Optional[List[str]] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    inter_batch_delay_s: float = DEFAULT_INTER_BATCH_DELAY_S,
    dry_run: bool = False,
    offset: int = 0,
    limit: Optional[int] = None,
    ensure_db_indexes: bool = True,
    parent_run_id: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Process a symbol universe in bounded batches (idempotent per-symbol upserts)."""
    mkt, symbol_list = resolve_symbols(
        partition=partition,
        market=market,
        symbols=symbols,
        offset=offset,
        limit=limit,
    )
    selected = _validate_datasets(datasets)
    symbol_ds, market_ds = _split_datasets(selected)
    batches = list(iter_batches(symbol_list, batch_size))
    partition_key = partition or f"{mkt.lower()}_custom"

    db = get_sync_db()
    if ensure_db_indexes and not dry_run:
        ensure_indexes(db)

    batch_run = BatchRunLogger(
        db,
        partition=partition_key,
        market=mkt,
        datasets=selected,
        dry_run=dry_run,
        parent_run_id=parent_run_id,
    )
    batch_run.set_plan(symbol_count=len(symbol_list), batch_count=len(batches), batch_size=batch_size)

    if dry_run:
        previews = []
        for symbol in symbol_list:
            try:
                previews.append(
                    preview_symbol_scrape(
                        symbol,
                        market=mkt,
                        datasets=symbol_ds,
                        force=force,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                previews.append({"symbol": symbol, "error": str(exc)})
        market_previews = []
        if market_ds:
            market_previews.append(preview_market_scrape(market=mkt, datasets=market_ds, force=force))
        plan = {
            "partition": partition_key,
            "market": mkt,
            "datasets": selected,
            "symbol_datasets": symbol_ds,
            "market_datasets": market_ds,
            "symbol_count": len(symbol_list),
            "batch_count": len(batches),
            "batch_size": batch_size,
            "force": force,
            "smart_preview": previews,
            "market_preview": market_previews,
            "batches": [
                {"batch_index": i, "symbols": batch, "count": len(batch)}
                for i, batch in enumerate(batches)
            ],
        }
        return batch_run.finish(status="dry_run", extra={"plan": plan})

    market_hub_result = None
    if market_ds:
        try:
            market_hub_result = scrape_market_datasets(
                market=mkt,
                datasets=market_ds,
                ensure_db_indexes=False,
                force=force,
            )
            batch_run.inc("market_hubs_ok", 1)
        except Exception as exc:  # noqa: BLE001
            batch_run.inc("market_hubs_failed", 1)
            batch_run.log_error(dataset="market_hub", message=str(exc), context={"market": mkt})
            log.warning("market hub scrape failed %s: %s", mkt, exc)

    results: List[Dict[str, Any]] = []
    failed = 0

    for batch_index, batch in enumerate(batches):
        log.info("batch %s/%s partition=%s symbols=%s", batch_index + 1, len(batches), partition_key, len(batch))
        for symbol in batch:
            try:
                result = scrape_symbol(
                    symbol,
                    market=mkt,
                    datasets=symbol_ds or None,
                    ensure_db_indexes=False,
                    force=force,
                )
                batch_run.inc("symbols_ok", 1)
                results.append({"symbol": symbol, "status": result.get("status", "completed"), "run_id": result.get("run_id")})
            except Exception as exc:  # noqa: BLE001
                failed += 1
                batch_run.inc("symbols_failed", 1)
                batch_run.log_error(dataset="batch", message=str(exc), context={"symbol": symbol})
                results.append({"symbol": symbol, "status": "failed", "error": str(exc)})
                log.warning("symbol scrape failed %s: %s", symbol, exc)

        if batch_index < len(batches) - 1 and inter_batch_delay_s > 0:
            time.sleep(inter_batch_delay_s)

    status = "completed" if failed == 0 else "completed_with_errors"
    extra: Dict[str, Any] = {"results": results}
    if market_hub_result:
        extra["market_hub"] = market_hub_result
    return batch_run.finish(status=status, extra=extra)


def run_nightly(
    *,
    partitions: Optional[List[str]] = None,
    datasets: Optional[List[str]] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    inter_batch_delay_s: float = DEFAULT_INTER_BATCH_DELAY_S,
    dry_run: bool = False,
    offset: int = 0,
    limit: Optional[int] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Run nightly ingestion across configured market partitions."""
    selected_partitions = partitions or list(ALL_PARTITIONS)
    unknown = [p for p in selected_partitions if p not in MARKET_PARTITIONS]
    if unknown:
        raise ValueError(f"Unknown partitions: {unknown}. Expected subset of {ALL_PARTITIONS}")

    db = get_sync_db()
    nightly_run = BatchRunLogger(
        db,
        partition="nightly",
        market="ALL",
        datasets=_validate_datasets(datasets),
        dry_run=dry_run,
    )

    partition_results: List[Dict[str, Any]] = []
    for part in selected_partitions:
        result = run_batch(
            partition=part,
            datasets=datasets,
            batch_size=batch_size,
            inter_batch_delay_s=inter_batch_delay_s,
            dry_run=dry_run,
            offset=offset,
            limit=limit,
            ensure_db_indexes=not dry_run,
            parent_run_id=nightly_run.run_id,
            force=force,
        )
        partition_results.append(result)
        nightly_run.inc("partitions_completed", 1)
        if result.get("status") in ("failed", "completed_with_errors"):
            nightly_run.inc("partitions_with_errors", 1)

    extra = {"partitions": partition_results}
    has_errors = any(r.get("status") in ("failed", "completed_with_errors") for r in partition_results)
    if dry_run:
        status = "dry_run"
    elif has_errors:
        status = "completed_with_errors"
    else:
        status = "completed"
    return nightly_run.finish(status=status, extra=extra)
