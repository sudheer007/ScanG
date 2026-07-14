"""Tier 2 market-wide hub dataset extractors."""

from __future__ import annotations

from ingestion.catalog import (
    DATASET_DIVIDEND_CALENDAR,
    DATASET_EARNINGS_CALENDAR,
    DATASET_INDEX_SECTOR_PERFORMANCE,
    DATASET_MACRO_EVENTS,
    HUB_PAGES,
)
from ingestion.client import InvestingClient
from ingestion.parsers import (
    page_state,
    parse_dividend_calendar_html,
    parse_earnings_calendar,
    parse_index_sector_performance,
    parse_macro_events,
)


def extract_earnings_calendar(client: InvestingClient, *, market: str = "US") -> tuple[list, dict]:
    html = client.hub_page(HUB_PAGES[DATASET_EARNINGS_CALENDAR])
    state = page_state(html)
    store = state.get("earningsStore") or {}
    parsed = parse_earnings_calendar(store)
    return parsed, {"dataset": DATASET_EARNINGS_CALENDAR, "market": market, "count": len(parsed)}


def extract_dividend_calendar(client: InvestingClient, *, market: str = "US") -> tuple[list, dict]:
    html = client.hub_page(HUB_PAGES[DATASET_DIVIDEND_CALENDAR])
    parsed = parse_dividend_calendar_html(html)
    return parsed, {"dataset": DATASET_DIVIDEND_CALENDAR, "market": market, "count": len(parsed)}


def extract_macro_events(client: InvestingClient, *, market: str = "ALL") -> tuple[list, dict]:
    html = client.hub_page(HUB_PAGES[DATASET_MACRO_EVENTS])
    state = page_state(html)
    store = state.get("economicCalendarStore") or {}
    parsed = parse_macro_events(store)
    return parsed, {"dataset": DATASET_MACRO_EVENTS, "market": market, "count": len(parsed)}


def extract_index_sector_performance(client: InvestingClient, *, market: str = "US") -> tuple[list, dict]:
    html = client.hub_page(HUB_PAGES[DATASET_INDEX_SECTOR_PERFORMANCE])
    state = page_state(html)
    store = state.get("assetsCollectionStore") or {}
    parsed = parse_index_sector_performance(store)
    return parsed, {"dataset": DATASET_INDEX_SECTOR_PERFORMANCE, "market": market, "count": len(parsed)}
