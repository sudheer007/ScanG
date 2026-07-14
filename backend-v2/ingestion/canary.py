"""Lightweight canary fetches for smart scrape change detection."""

from __future__ import annotations

from typing import Any, Dict

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
    DATASET_STOCK_NEWS,
    DATASET_TECHNICAL_INDICATORS,
    STATEMENT_INCOME,
)
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import (
    latest_action_date,
    latest_earnings_date,
    latest_news_fingerprint,
    latest_period_end,
    page_state,
    parse_analyst_consensus,
    parse_delivery_turnover,
    parse_dividends,
    parse_earnings_history,
    parse_equity_instrument,
    parse_financial_store,
    parse_india_ownership_breakdown,
    parse_ownership,
    parse_price_history,
    parse_ratios,
    parse_stock_news,
    parse_technical_indicators,
    payload_fingerprint,
)


def canary_financial_statements(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, html_fp = PageExtractor(client, slug, "income-statement").fetch_store()
    rows = parse_financial_store(
        store,
        annual_key="incomeStatementDataAnnual",
        quarterly_key="incomeStatementDataQuarterly",
        statement_type=STATEMENT_INCOME,
    )
    return {"latest_period_end": latest_period_end(rows), "fingerprint": html_fp, "row_count": len(rows)}


def canary_corporate_actions(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, html_fp = PageExtractor(client, slug, "dividends").fetch_store()
    rows = parse_dividends(store)
    return {"latest_action_date": latest_action_date(rows), "fingerprint": html_fp, "row_count": len(rows)}


def canary_ratios(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "ratios").fetch_store()
    parsed = parse_ratios(store)
    return {"fingerprint": payload_fingerprint(parsed.get("ratios") or store), "ratio_count": len(parsed.get("ratios") or {})}


def canary_ownership(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "ownership").fetch_store()
    parsed = parse_ownership(store)
    return {"fingerprint": payload_fingerprint(parsed), "holder_count": len(parsed.get("institutional") or []) + len(parsed.get("mutual_funds") or [])}


def canary_analyst_consensus(client: InvestingClient, slug: str) -> Dict[str, Any]:
    html, _, _ = PageExtractor(client, slug, "consensus-estimates").fetch_store()
    parsed = parse_analyst_consensus(page_state(html))
    return {"fingerprint": payload_fingerprint(parsed.get("consensus") or {})}


def canary_earnings_history(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "earnings").fetch_store()
    parsed = parse_earnings_history(store)
    return {"latest_action_date": latest_earnings_date(parsed), "fingerprint": payload_fingerprint(parsed.get("quarters") or [])}


def canary_technical(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "technical").fetch_store()
    parsed = parse_technical_indicators(store)
    return {"fingerprint": payload_fingerprint(parsed)}


def canary_price_history(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "historical-data").fetch_store()
    parsed = parse_price_history(store)
    bars = parsed.get("bars") or []
    return {"fingerprint": str(len(bars)), "row_count": len(bars)}


def canary_quote_snapshot(client: InvestingClient, slug: str) -> Dict[str, Any]:
    html = client.equity_overview(slug)
    parsed = parse_equity_instrument(page_state(html))
    return {"fingerprint": payload_fingerprint(parsed.get("quote") or parsed)}


def canary_stock_news(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "news").fetch_store()
    articles = parse_stock_news(store)
    return {"fingerprint": latest_news_fingerprint(articles), "row_count": len(articles)}


def canary_analyst_actions(client: InvestingClient, slug: str) -> Dict[str, Any]:
    html, _, _ = PageExtractor(client, slug, "consensus-estimates").fetch_store()
    ratings = (page_state(html).get("forecastStore") or {}).get("ratings") or []
    return {"fingerprint": str(len(ratings)), "row_count": len(ratings)}


def canary_ownership_promoter(client: InvestingClient, slug: str) -> Dict[str, Any]:
    _, store, _ = PageExtractor(client, slug, "ownership").fetch_store()
    parsed = parse_india_ownership_breakdown(store, market="IN")
    return {"fingerprint": payload_fingerprint(parsed.get("breakdown") or {})}


def canary_delivery_turnover(client: InvestingClient, slug: str) -> Dict[str, Any]:
    html = client.equity_overview(slug)
    parsed = parse_delivery_turnover(page_state(html), market="IN")
    return {"fingerprint": str(parsed.get("turnover"))}


CANARY_FETCHERS = {
    DATASET_FINANCIAL_STATEMENTS: canary_financial_statements,
    DATASET_CORPORATE_ACTIONS: canary_corporate_actions,
    DATASET_RATIOS: canary_ratios,
    DATASET_OWNERSHIP: canary_ownership,
    DATASET_ANALYST_CONSENSUS: canary_analyst_consensus,
    DATASET_EARNINGS_HISTORY: canary_earnings_history,
    DATASET_TECHNICAL_INDICATORS: canary_technical,
    DATASET_PRICE_HISTORY: canary_price_history,
    DATASET_QUOTE_SNAPSHOT: canary_quote_snapshot,
    DATASET_STOCK_NEWS: canary_stock_news,
    DATASET_ANALYST_ACTIONS: canary_analyst_actions,
    DATASET_OWNERSHIP_PROMOTER: canary_ownership_promoter,
    DATASET_DELIVERY_TURNOVER: canary_delivery_turnover,
}


def fetch_canary(client: InvestingClient, slug: str, dataset: str) -> Dict[str, Any]:
    fetcher = CANARY_FETCHERS.get(dataset)
    if not fetcher:
        raise ValueError(f"No canary fetcher for dataset: {dataset}")
    return fetcher(client, slug)
