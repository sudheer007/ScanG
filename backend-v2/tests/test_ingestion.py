"""Unit tests for Investing.com ingestion parsers and resolver."""

from __future__ import annotations

import json
from pathlib import Path

from ingestion.parsers import (
    latest_action_date,
    latest_period_end,
    parse_dividends,
    parse_financial_store,
    parse_profile,
    parse_ratios,
    parse_splits,
    payload_fingerprint,
    slug_from_url,
)
from ingestion.resolver import _search_query, pick_best_quote

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class TestParsers:
    def test_slug_from_url(self):
        assert slug_from_url("/equities/apple-computer-inc") == "apple-computer-inc"
        assert slug_from_url("/equities/reliance-industries?cid=39657") == "reliance-industries"

    def test_parse_financial_store(self):
        store = _load("income_statement_store.json")
        rows = parse_financial_store(
            store,
            annual_key="incomeStatementDataAnnual",
            quarterly_key="incomeStatementDataQuarterly",
            statement_type="income",
        )
        assert len(rows) >= 1
        assert rows[0]["statement_type"] == "income"
        assert "total_revenues_standard" in rows[0]["line_items"]

    def test_parse_dividends_and_splits(self):
        dividends = _load("dividends_store.json")
        splits = _load("splits_store.json")
        d = parse_dividends(dividends)
        s = parse_splits(splits)
        assert d[0]["action_type"] == "dividend"
        assert s[0]["action_type"] == "split"

    def test_parse_ratios_and_profile(self):
        ratios_store = _load("ratios_store.json")
        profile_store = _load("profile_store.json")
        ratios = parse_ratios(ratios_store)
        profile = parse_profile(profile_store)
        assert "pe_ratio_ttm" in ratios["ratios"] or "beta" in ratios["ratios"]
        assert "ratio_details" in ratios
        assert profile["sector"] == "Technology"

    def test_payload_fingerprint_stable(self):
        assert payload_fingerprint({"a": 1, "b": 2}) == payload_fingerprint({"b": 2, "a": 1})

    def test_latest_period_and_action_dates(self):
        store = _load("income_statement_store.json")
        rows = parse_financial_store(
            store,
            annual_key="incomeStatementDataAnnual",
            quarterly_key="incomeStatementDataQuarterly",
            statement_type="income",
        )
        assert latest_period_end(rows) is not None
        dividends = parse_dividends(_load("dividends_store.json"))
        assert latest_action_date(dividends) is not None


class TestResolver:
    def test_search_query(self):
        assert _search_query("BRK-B", "US") == "BRK.B"
        assert _search_query("RELIANCE.NS", "IN") == "RELIANCE"

    def test_pick_best_quote_us(self):
        quotes = _load("search_quotes_aapl.json")
        best = pick_best_quote(quotes, symbol="AAPL", market="US")
        assert best is not None
        assert best["symbol"] == "AAPL"
        assert best["exchange"] == "NASDAQ"

    def test_pick_best_quote_india(self):
        quotes = _load("search_quotes_reliance.json")
        best = pick_best_quote(quotes, symbol="RELIANCE.NS", market="IN")
        assert best is not None
        assert best["exchange"] == "NSE"
