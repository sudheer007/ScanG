"""Single-symbol ingestion orchestration with smart freshness gating."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ingestion.canary import fetch_canary
from ingestion.catalog import DATASET_INSTRUMENT, SYMBOL_DATASETS, is_market_dataset
from ingestion.client import InvestingClient
from ingestion.db import ensure_indexes, get_sync_db
from ingestion.freshness_policy import (
    STATUS_SKIPPED_FRESH,
    STATUS_SKIPPED_UNCHANGED,
    is_smart_scrape_dataset,
    preview_decision,
    should_scrape,
    has_changed,
)
from ingestion.normalizer import infer_market, to_iso_date
from ingestion.parsers import page_state, parse_equity_instrument, parse_profile
from ingestion.extractors.base import PageExtractor
from ingestion.repository import IngestionRepository
from ingestion.resolver import InstrumentResolver
from ingestion.run_logger import RunLogger
from ingestion.symbol_handlers import SYMBOL_HANDLERS, UNGUARDED_DATASETS

log = logging.getLogger(__name__)


def _counter_key(dataset: str, suffix: str) -> str:
    return f"{dataset}_{suffix}"


def _record_skip(
    repo: IngestionRepository,
    run: RunLogger,
    *,
    symbol: str,
    dataset: str,
    status: str,
    run_id: str,
    canary: Optional[Dict[str, Any]] = None,
) -> None:
    run.inc(_counter_key(dataset, status), 1)
    repo.update_freshness(
        symbol,
        dataset,
        status=status,
        run_id=run_id,
        fingerprint=(canary or {}).get("fingerprint"),
        latest_period_end=(canary or {}).get("latest_period_end"),
        latest_action_date=(canary or {}).get("latest_action_date"),
    )


def _gate_dataset(
    *,
    dataset: str,
    symbol: str,
    slug: str,
    client: InvestingClient,
    repo: IngestionRepository,
    run: RunLogger,
    freshness: Optional[Dict[str, Any]],
    force: bool,
) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    if dataset in UNGUARDED_DATASETS:
        return True, None, "unguarded"

    scrape, reason = should_scrape(dataset, freshness, force=force)
    if not scrape:
        _record_skip(repo, run, symbol=symbol, dataset=dataset, status=STATUS_SKIPPED_FRESH, run_id=run.run_id)
        return False, None, reason

    if not is_smart_scrape_dataset(dataset) or force:
        return True, None, reason

    canary = fetch_canary(client, slug, dataset)
    changed, change_reason = has_changed(dataset, canary, freshness)
    if not changed:
        _record_skip(
            repo, run, symbol=symbol, dataset=dataset, status=STATUS_SKIPPED_UNCHANGED,
            run_id=run.run_id, canary=canary,
        )
        return False, canary, change_reason

    return True, canary, change_reason


def _enrich_instrument(client: InvestingClient, instrument: Dict[str, Any], slug: str) -> Dict[str, Any]:
    """Phase 2: merge overview + profile fields into instrument doc."""
    enriched = dict(instrument)
    try:
        overview_html = client.equity_overview(slug)
        overview = parse_equity_instrument(page_state(overview_html))
        enriched.update({k: v for k, v in overview.items() if v is not None and k not in enriched})
    except Exception as exc:  # noqa: BLE001
        log.debug("overview enrichment failed for %s: %s", slug, exc)
    try:
        _, profile_store, _ = PageExtractor(client, slug, "company-profile").fetch_store()
        profile = parse_profile(profile_store)
        for key in ("sector", "industry", "description", "employees", "website", "ipo_date", "shares_outstanding"):
            if profile.get(key) is not None:
                enriched[key] = profile[key]
    except Exception as exc:  # noqa: BLE001
        log.debug("profile enrichment failed for %s: %s", slug, exc)
    return enriched


def preview_symbol_scrape(
    symbol: str,
    *,
    market: Optional[str] = None,
    datasets: Optional[List[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Dry-run diagnostics: report per-dataset scrape/skip decisions without writes."""
    market = (market or infer_market(symbol)).upper()
    selected = [d for d in (datasets or SYMBOL_DATASETS) if not is_market_dataset(d)]
    symbol_u = symbol.upper()

    db = get_sync_db()
    repo = IngestionRepository(db)
    client = InvestingClient()
    resolver = InstrumentResolver(client)

    instrument = resolver.resolve(symbol_u, market=market)
    slug = instrument["slug"]
    freshness_map = repo.get_freshness_map(symbol_u, selected)

    decisions = []
    for dataset in selected:
        if dataset == DATASET_INSTRUMENT:
            decisions.append({"dataset": dataset, "would_scrape": True, "reason": "always"})
            continue
        meta = freshness_map.get(dataset)
        canary = None
        if dataset not in UNGUARDED_DATASETS and is_smart_scrape_dataset(dataset):
            if force or should_scrape(dataset, meta, force=force)[0]:
                try:
                    canary = fetch_canary(client, slug, dataset)
                except Exception as exc:  # noqa: BLE001
                    decisions.append({
                        "dataset": dataset,
                        "would_scrape": True,
                        "reason": "canary_failed",
                        "error": str(exc),
                    })
                    continue
        decisions.append(preview_decision(dataset, meta, force=force, canary=canary))

    return {
        "symbol": symbol_u,
        "market": market,
        "force": force,
        "instrument": instrument,
        "decisions": decisions,
    }


def scrape_symbol(
    symbol: str,
    *,
    market: Optional[str] = None,
    datasets: Optional[List[str]] = None,
    ensure_db_indexes: bool = True,
    save_raw: bool = True,
    force: bool = False,
) -> Dict[str, Any]:
    """Resolve symbol, scrape Investing.com datasets, and upsert into MongoDB."""
    market = (market or infer_market(symbol)).upper()
    selected = [d for d in (datasets or SYMBOL_DATASETS) if not is_market_dataset(d)]

    db = get_sync_db()
    if ensure_db_indexes:
        ensure_indexes(db)

    repo = IngestionRepository(db)
    client = InvestingClient()
    resolver = InstrumentResolver(client)
    run = RunLogger(db, market=market, symbol=symbol.upper(), datasets=selected)

    as_of_date = to_iso_date(datetime.now(timezone.utc))
    symbol_u = symbol.upper()

    try:
        instrument = resolver.resolve(symbol_u, market=market)
        slug = instrument["slug"]
        instrument = _enrich_instrument(client, instrument, slug)
        repo.upsert_instrument({**instrument, "as_of_date": as_of_date, "run_id": run.run_id})
        run.inc("instruments", 1)

        freshness_map = repo.get_freshness_map(symbol_u, selected)

        for dataset in selected:
            if dataset == DATASET_INSTRUMENT:
                continue
            handler = SYMBOL_HANDLERS.get(dataset)
            if not handler:
                continue

            freshness = freshness_map.get(dataset)
            try:
                if dataset in UNGUARDED_DATASETS:
                    handler(
                        client=client, repo=repo, run=run, symbol=symbol_u, slug=slug,
                        market=market, as_of_date=as_of_date, canary=None, save_raw=save_raw,
                        instrument=instrument,
                    )
                    continue

                proceed, canary, _ = _gate_dataset(
                    dataset=dataset, symbol=symbol_u, slug=slug, client=client,
                    repo=repo, run=run, freshness=freshness, force=force,
                )
                if proceed:
                    kwargs: Dict[str, Any] = {
                        "client": client, "repo": repo, "run": run, "symbol": symbol_u,
                        "slug": slug, "market": market, "as_of_date": as_of_date,
                        "canary": canary, "save_raw": save_raw,
                    }
                    if dataset == "sector_industry_aggregates":
                        kwargs["instrument"] = instrument
                    handler(**kwargs)
            except Exception as exc:  # noqa: BLE001
                run.log_error(dataset=dataset, message=str(exc))
                repo.update_freshness(symbol_u, dataset, status="failed", run_id=run.run_id, error=str(exc))
                log.warning("%s failed for %s: %s", dataset, symbol_u, exc)

        status = "completed" if len(run.errors) == 0 else "completed_with_errors"
        result = run.finish(status=status)
        result["symbol"] = symbol_u
        result["instrument"] = instrument
        result["force"] = force
        return result

    except Exception as exc:  # noqa: BLE001
        run.log_error(dataset="pipeline", message=str(exc))
        result = run.finish(status="failed")
        result["symbol"] = symbol_u
        result["error"] = str(exc)
        raise
