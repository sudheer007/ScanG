"""Market-wide hub dataset scrape orchestration."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ingestion.catalog import (
    DATASET_DIVIDEND_CALENDAR,
    DATASET_EARNINGS_CALENDAR,
    DATASET_INDEX_SECTOR_PERFORMANCE,
    DATASET_MACRO_EVENTS,
    MARKET_DATASETS,
)
from ingestion.client import InvestingClient
from ingestion.db import ensure_indexes, get_sync_db
from ingestion.extractors.tier2 import (
    extract_dividend_calendar,
    extract_earnings_calendar,
    extract_index_sector_performance,
    extract_macro_events,
)
from ingestion.freshness_policy import (
    STATUS_SKIPPED_FRESH,
    STATUS_UPDATED,
    is_smart_scrape_dataset,
    should_scrape,
)
from ingestion.normalizer import to_iso_date
from ingestion.parsers import payload_fingerprint
from ingestion.repository import IngestionRepository
from ingestion.run_logger import RunLogger

log = logging.getLogger(__name__)

MARKET_FRESHNESS_KEY = "__market__"


def _counter_key(dataset: str, suffix: str) -> str:
    return f"{dataset}_{suffix}"


def scrape_market_datasets(
    *,
    market: str = "US",
    datasets: Optional[List[str]] = None,
    ensure_db_indexes: bool = True,
    save_raw: bool = True,
    force: bool = False,
) -> Dict[str, Any]:
    """Scrape market-wide hub datasets (Tier 2)."""
    mkt = market.upper()
    selected = [d for d in (datasets or MARKET_DATASETS) if d in MARKET_DATASETS]

    db = get_sync_db()
    if ensure_db_indexes:
        ensure_indexes(db)

    repo = IngestionRepository(db)
    client = InvestingClient()
    run = RunLogger(db, market=mkt, symbol=None, datasets=selected)
    as_of_date = to_iso_date(datetime.now(timezone.utc))
    freshness_map = repo.get_freshness_map(MARKET_FRESHNESS_KEY, selected)

    for dataset in selected:
        meta = freshness_map.get(dataset)
        scrape, reason = should_scrape(dataset, meta, force=force)
        if not scrape and is_smart_scrape_dataset(dataset):
            run.inc(_counter_key(dataset, STATUS_SKIPPED_FRESH), 1)
            repo.update_freshness(
                MARKET_FRESHNESS_KEY,
                dataset,
                status=STATUS_SKIPPED_FRESH,
                run_id=run.run_id,
                market=mkt,
            )
            continue

        try:
            if dataset == DATASET_EARNINGS_CALENDAR:
                rows, raw = extract_earnings_calendar(client, market=mkt)
                n = repo.upsert_earnings_calendar(mkt, rows, run_id=run.run_id, as_of_date=as_of_date)
                run.inc(dataset, n)
            elif dataset == DATASET_DIVIDEND_CALENDAR:
                rows, raw = extract_dividend_calendar(client, market=mkt)
                n = repo.upsert_dividend_calendar(mkt, rows, run_id=run.run_id, as_of_date=as_of_date)
                run.inc(dataset, n)
            elif dataset == DATASET_MACRO_EVENTS:
                rows, raw = extract_macro_events(client, market="ALL")
                n = repo.upsert_macro_events(rows, run_id=run.run_id, as_of_date=as_of_date)
                run.inc(dataset, n)
            elif dataset == DATASET_INDEX_SECTOR_PERFORMANCE:
                rows, raw = extract_index_sector_performance(client, market=mkt)
                n = repo.upsert_index_sector_performance(mkt, rows, run_id=run.run_id, as_of_date=as_of_date)
                run.inc(dataset, n)
            else:
                continue

            run.inc(_counter_key(dataset, STATUS_UPDATED), 1)
            repo.update_freshness(
                MARKET_FRESHNESS_KEY,
                dataset,
                status=STATUS_UPDATED,
                run_id=run.run_id,
                market=mkt,
                fingerprint=payload_fingerprint(raw),
            )
            if save_raw:
                repo.save_raw_payload(
                    symbol=MARKET_FRESHNESS_KEY,
                    dataset=dataset,
                    fingerprint=str(raw.get("count", "")),
                    payload=raw,
                    run_id=run.run_id,
                )
        except Exception as exc:  # noqa: BLE001
            run.log_error(dataset=dataset, message=str(exc), context={"market": mkt, "reason": reason})
            repo.update_freshness(
                MARKET_FRESHNESS_KEY,
                dataset,
                status="failed",
                run_id=run.run_id,
                market=mkt,
                error=str(exc),
            )
            log.warning("market dataset %s failed for %s: %s", dataset, mkt, exc)

    status = "completed" if len(run.errors) == 0 else "completed_with_errors"
    result = run.finish(status=status)
    result["market"] = mkt
    result["force"] = force
    return result


def preview_market_scrape(
    *,
    market: str = "US",
    datasets: Optional[List[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Dry-run for market hub datasets."""
    mkt = market.upper()
    selected = [d for d in (datasets or MARKET_DATASETS) if d in MARKET_DATASETS]
    db = get_sync_db()
    repo = IngestionRepository(db)
    freshness_map = repo.get_freshness_map(MARKET_FRESHNESS_KEY, selected)
    decisions = []
    for dataset in selected:
        meta = freshness_map.get(dataset)
        scrape, reason = should_scrape(dataset, meta, force=force)
        decisions.append({
            "dataset": dataset,
            "would_scrape": scrape,
            "reason": reason,
            "scope": "market",
            "market": mkt,
        })
    return {"market": mkt, "force": force, "decisions": decisions}
