"""Tier 3 India-focused dataset extractors."""

from __future__ import annotations

from ingestion.catalog import DATASET_DELIVERY_TURNOVER, DATASET_OWNERSHIP_PROMOTER
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import page_state, parse_delivery_turnover, parse_india_ownership_breakdown


def extract_ownership_promoter(client: InvestingClient, slug: str, *, market: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "ownership").fetch_store()
    parsed = parse_india_ownership_breakdown(store, market=market)
    return parsed, {"dataset": DATASET_OWNERSHIP_PROMOTER, "store": store}


def extract_delivery_turnover(client: InvestingClient, slug: str, *, market: str) -> tuple[dict, dict]:
    html = client.equity_overview(slug)
    state = page_state(html)
    parsed = parse_delivery_turnover(state, market=market)
    return parsed, {"dataset": DATASET_DELIVERY_TURNOVER, "state_keys": list(state.keys())}
