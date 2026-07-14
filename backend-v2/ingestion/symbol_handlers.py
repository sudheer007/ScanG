"""Symbol-scoped dataset scrape handlers for pipeline."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from ingestion.catalog import (
    DATASET_ANALYST_ACTIONS,
    DATASET_ANALYST_CONSENSUS,
    DATASET_CORPORATE_ACTIONS,
    DATASET_DELIVERY_TURNOVER,
    DATASET_EARNINGS_HISTORY,
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_OWNERSHIP,
    DATASET_OWNERSHIP_PROMOTER,
    DATASET_PRICE_HISTORY,
    DATASET_QUOTE_SNAPSHOT,
    DATASET_RATIOS,
    DATASET_SECTOR_AGGREGATES,
    DATASET_STOCK_NEWS,
    DATASET_TECHNICAL_INDICATORS,
)
from ingestion.client import InvestingClient
from ingestion.extractors.corporate_actions import extract_corporate_actions
from ingestion.extractors.financial_statements import extract_financial_statements
from ingestion.extractors.ownership import extract_ownership
from ingestion.extractors.ratios import extract_ratios
from ingestion.extractors.sector_aggregates import extract_sector_aggregates
from ingestion.extractors.tier1 import (
    extract_analyst_actions,
    extract_analyst_consensus,
    extract_earnings_history,
    extract_price_history,
    extract_quote_snapshot,
    extract_stock_news,
    extract_technical_indicators,
)
from ingestion.extractors.tier3 import extract_delivery_turnover, extract_ownership_promoter
from ingestion.freshness_policy import STATUS_UPDATED
from ingestion.parsers import (
    latest_action_date,
    latest_earnings_date,
    latest_news_fingerprint,
    latest_period_end,
    payload_fingerprint,
)
from ingestion.repository import IngestionRepository
from ingestion.run_logger import RunLogger


def _counter_key(dataset: str, suffix: str) -> str:
    return f"{dataset}_{suffix}"


def _save_raw(
    repo: IngestionRepository,
    *,
    symbol: str,
    dataset: str,
    fingerprint: str,
    payload: Dict[str, Any],
    run_id: str,
    save_raw: bool,
) -> None:
    if save_raw:
        repo.save_raw_payload(
            symbol=symbol,
            dataset=dataset,
            fingerprint=fingerprint,
            payload=payload,
            run_id=run_id,
        )


def _mark_updated(
    repo: IngestionRepository,
    run: RunLogger,
    *,
    symbol: str,
    dataset: str,
    run_id: str,
    fingerprint: Optional[str] = None,
    latest_period_end_val: Optional[str] = None,
    latest_action_date_val: Optional[str] = None,
) -> None:
    run.inc(_counter_key(dataset, STATUS_UPDATED), 1)
    repo.update_freshness(
        symbol,
        dataset,
        status=STATUS_UPDATED,
        run_id=run_id,
        fingerprint=fingerprint,
        latest_period_end=latest_period_end_val,
        latest_action_date=latest_action_date_val,
    )


Handler = Callable[..., None]


def handle_financial_statements(
    *,
    client: InvestingClient,
    repo: IngestionRepository,
    run: RunLogger,
    symbol: str,
    slug: str,
    market: str,
    as_of_date: str,
    canary: Optional[Dict[str, Any]],
    save_raw: bool,
) -> None:
    rows, raw = extract_financial_statements(client, slug)
    n = repo.upsert_financial_statements(symbol, rows, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_FINANCIAL_STATEMENTS, n)
    period_end = latest_period_end(rows) or (canary or {}).get("latest_period_end")
    _mark_updated(
        repo, run, symbol=symbol, dataset=DATASET_FINANCIAL_STATEMENTS, run_id=run.run_id,
        fingerprint=(canary or {}).get("fingerprint"), latest_period_end_val=period_end,
    )
    _save_raw(repo, symbol=symbol, dataset=DATASET_FINANCIAL_STATEMENTS, fingerprint=str(len(rows)), payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_corporate_actions(
    *, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw,
) -> None:
    rows, raw = extract_corporate_actions(client, slug)
    n = repo.upsert_corporate_actions(symbol, rows, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_CORPORATE_ACTIONS, n)
    action_date = latest_action_date(rows) or (canary or {}).get("latest_action_date")
    _mark_updated(
        repo, run, symbol=symbol, dataset=DATASET_CORPORATE_ACTIONS, run_id=run.run_id,
        fingerprint=(canary or {}).get("fingerprint"), latest_action_date_val=action_date,
    )
    _save_raw(repo, symbol=symbol, dataset=DATASET_CORPORATE_ACTIONS, fingerprint=str(len(rows)), payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_ratios(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_ratios(client, slug)
    repo.upsert_ratios(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_RATIOS, 1)
    fp = payload_fingerprint(parsed.get("ratios") or {})
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_RATIOS, run_id=run.run_id, fingerprint=fp)
    _save_raw(repo, symbol=symbol, dataset=DATASET_RATIOS, fingerprint="ratios", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_ownership(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_ownership(client, slug)
    repo.upsert_ownership(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_OWNERSHIP, 1)
    fp = payload_fingerprint(parsed)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_OWNERSHIP, run_id=run.run_id, fingerprint=fp)
    _save_raw(repo, symbol=symbol, dataset=DATASET_OWNERSHIP, fingerprint="ownership", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_sector_aggregates(
    *, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw, instrument: Dict[str, Any],
) -> None:
    parsed, raw = extract_sector_aggregates(client, slug, market=market, symbol=symbol)
    enriched = {
        **instrument,
        "sector": parsed.get("sector"),
        "industry": parsed.get("industry"),
        "description": parsed.get("description"),
        "employees": parsed.get("employees"),
        "website": parsed.get("website"),
        "as_of_date": as_of_date,
        "run_id": run.run_id,
    }
    repo.upsert_instrument(enriched)
    repo.upsert_sector_aggregate(parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_SECTOR_AGGREGATES, 1)
    _save_raw(repo, symbol=symbol, dataset=DATASET_SECTOR_AGGREGATES, fingerprint="sector", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_analyst_consensus(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_analyst_consensus(client, slug)
    repo.upsert_analyst_consensus(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_ANALYST_CONSENSUS, 1)
    fp = payload_fingerprint(parsed.get("consensus") or {})
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_ANALYST_CONSENSUS, run_id=run.run_id, fingerprint=fp)
    _save_raw(repo, symbol=symbol, dataset=DATASET_ANALYST_CONSENSUS, fingerprint="consensus", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_earnings_history(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_earnings_history(client, slug)
    repo.upsert_earnings_history(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_EARNINGS_HISTORY, 1)
    _mark_updated(
        repo, run, symbol=symbol, dataset=DATASET_EARNINGS_HISTORY, run_id=run.run_id,
        latest_action_date_val=latest_earnings_date(parsed),
        fingerprint=payload_fingerprint(parsed.get("quarters") or []),
    )
    _save_raw(repo, symbol=symbol, dataset=DATASET_EARNINGS_HISTORY, fingerprint="earnings", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_technical_indicators(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_technical_indicators(client, slug)
    repo.upsert_technical_indicators(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_TECHNICAL_INDICATORS, 1)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_TECHNICAL_INDICATORS, run_id=run.run_id, fingerprint=payload_fingerprint(parsed))
    _save_raw(repo, symbol=symbol, dataset=DATASET_TECHNICAL_INDICATORS, fingerprint="technical", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_price_history(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_price_history(client, slug)
    repo.upsert_price_history(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_PRICE_HISTORY, 1)
    bars = parsed.get("bars") or []
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_PRICE_HISTORY, run_id=run.run_id, fingerprint=str(len(bars)))
    _save_raw(repo, symbol=symbol, dataset=DATASET_PRICE_HISTORY, fingerprint="ohlcv", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_quote_snapshot(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    parsed, raw = extract_quote_snapshot(client, slug)
    repo.upsert_quote_snapshot(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_QUOTE_SNAPSHOT, 1)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_QUOTE_SNAPSHOT, run_id=run.run_id, fingerprint=payload_fingerprint(parsed.get("price") or {}))
    _save_raw(repo, symbol=symbol, dataset=DATASET_QUOTE_SNAPSHOT, fingerprint="quote", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_stock_news(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    articles, raw = extract_stock_news(client, slug)
    n = repo.upsert_stock_news(symbol, articles, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_STOCK_NEWS, n)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_STOCK_NEWS, run_id=run.run_id, fingerprint=latest_news_fingerprint(articles))
    _save_raw(repo, symbol=symbol, dataset=DATASET_STOCK_NEWS, fingerprint=str(n), payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_analyst_actions(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    rows, raw = extract_analyst_actions(client, slug)
    n = repo.upsert_analyst_actions(symbol, rows, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_ANALYST_ACTIONS, n)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_ANALYST_ACTIONS, run_id=run.run_id, fingerprint=str(n))
    _save_raw(repo, symbol=symbol, dataset=DATASET_ANALYST_ACTIONS, fingerprint="actions", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_ownership_promoter(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    if market != "IN":
        return
    parsed, raw = extract_ownership_promoter(client, slug, market=market)
    repo.upsert_ownership_promoter(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_OWNERSHIP_PROMOTER, 1)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_OWNERSHIP_PROMOTER, run_id=run.run_id, fingerprint=payload_fingerprint(parsed.get("breakdown") or {}))
    _save_raw(repo, symbol=symbol, dataset=DATASET_OWNERSHIP_PROMOTER, fingerprint="promoter", payload=raw, run_id=run.run_id, save_raw=save_raw)


def handle_delivery_turnover(*, client, repo, run, symbol, slug, market, as_of_date, canary, save_raw) -> None:
    if market != "IN":
        return
    parsed, raw = extract_delivery_turnover(client, slug, market=market)
    repo.upsert_delivery_turnover(symbol, parsed, run_id=run.run_id, as_of_date=as_of_date)
    run.inc(DATASET_DELIVERY_TURNOVER, 1)
    _mark_updated(repo, run, symbol=symbol, dataset=DATASET_DELIVERY_TURNOVER, run_id=run.run_id, fingerprint=str(parsed.get("turnover")))
    _save_raw(repo, symbol=symbol, dataset=DATASET_DELIVERY_TURNOVER, fingerprint="delivery", payload=raw, run_id=run.run_id, save_raw=save_raw)


SYMBOL_HANDLERS: Dict[str, Handler] = {
    DATASET_FINANCIAL_STATEMENTS: handle_financial_statements,
    DATASET_CORPORATE_ACTIONS: handle_corporate_actions,
    DATASET_RATIOS: handle_ratios,
    DATASET_OWNERSHIP: handle_ownership,
    DATASET_SECTOR_AGGREGATES: handle_sector_aggregates,
    DATASET_ANALYST_CONSENSUS: handle_analyst_consensus,
    DATASET_EARNINGS_HISTORY: handle_earnings_history,
    DATASET_TECHNICAL_INDICATORS: handle_technical_indicators,
    DATASET_PRICE_HISTORY: handle_price_history,
    DATASET_QUOTE_SNAPSHOT: handle_quote_snapshot,
    DATASET_STOCK_NEWS: handle_stock_news,
    DATASET_ANALYST_ACTIONS: handle_analyst_actions,
    DATASET_OWNERSHIP_PROMOTER: handle_ownership_promoter,
    DATASET_DELIVERY_TURNOVER: handle_delivery_turnover,
}

# Datasets that skip smart gating (always attempt when selected)
UNGUARDED_DATASETS = {DATASET_SECTOR_AGGREGATES}
