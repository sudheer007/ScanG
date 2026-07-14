"""Tier 1 symbol-scoped dataset extractors."""

from __future__ import annotations

from ingestion.catalog import (
    DATASET_ANALYST_ACTIONS,
    DATASET_ANALYST_CONSENSUS,
    DATASET_EARNINGS_HISTORY,
    DATASET_PRICE_HISTORY,
    DATASET_QUOTE_SNAPSHOT,
    DATASET_STOCK_NEWS,
    DATASET_TECHNICAL_INDICATORS,
)
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import (
    page_state,
    parse_analyst_actions,
    parse_analyst_consensus,
    parse_earnings_history,
    parse_price_history,
    parse_quote_snapshot,
    parse_stock_news,
    parse_technical_indicators,
)


def extract_analyst_consensus(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    html, store, _ = PageExtractor(client, slug, "consensus-estimates").fetch_store()
    state = page_state(html)
    parsed = parse_analyst_consensus(state)
    return parsed, {"dataset": DATASET_ANALYST_CONSENSUS, "store": store}


def extract_earnings_history(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "earnings").fetch_store()
    parsed = parse_earnings_history(store)
    return parsed, {"dataset": DATASET_EARNINGS_HISTORY, "store": store}


def extract_technical_indicators(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "technical").fetch_store()
    parsed = parse_technical_indicators(store)
    return parsed, {"dataset": DATASET_TECHNICAL_INDICATORS, "store": store}


def extract_price_history(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "historical-data").fetch_store()
    parsed = parse_price_history(store)
    return parsed, {"dataset": DATASET_PRICE_HISTORY, "store": store}


def extract_quote_snapshot(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    html = client.equity_overview(slug)
    state = page_state(html)
    parsed = parse_quote_snapshot(state)
    return parsed, {"dataset": DATASET_QUOTE_SNAPSHOT, "state_keys": list(state.keys())}


def extract_stock_news(client: InvestingClient, slug: str) -> tuple[list, dict]:
    _, store, _ = PageExtractor(client, slug, "news").fetch_store()
    parsed = parse_stock_news(store)
    return parsed, {"dataset": DATASET_STOCK_NEWS, "store": store, "count": len(parsed)}


def extract_analyst_actions(client: InvestingClient, slug: str) -> tuple[list, dict]:
    html, _, _ = PageExtractor(client, slug, "consensus-estimates").fetch_store()
    state = page_state(html)
    store = state.get("forecastStore") or {}
    parsed = parse_analyst_actions(store)
    return parsed, {"dataset": DATASET_ANALYST_ACTIONS, "store": store, "count": len(parsed)}
