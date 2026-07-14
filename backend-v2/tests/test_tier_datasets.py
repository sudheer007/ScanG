"""Tests for tier dataset parsers and prerequisites."""

from __future__ import annotations

import json
from pathlib import Path

from ingestion.catalog import DATASETS, TIER1_DATASETS, TIER3_DATASETS
from ingestion.parsers import (
    parse_analyst_actions,
    parse_analyst_consensus,
    parse_delivery_turnover,
    parse_earnings_history,
    parse_price_history,
    parse_profile,
    parse_ratios,
    parse_technical_indicators,
    parse_india_ownership_breakdown,
)
from ingestion.prerequisites import validate_prerequisites
from ingestion.symbol_handlers import SYMBOL_HANDLERS

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class TestTierParsers:
    def test_parse_analyst_consensus(self):
        state = _load("consensus_store.json")
        out = parse_analyst_consensus(state)
        assert out["consensus"]["recommendation"] == "BUY"
        assert out["rating_counts"]["buy"] == 28

    def test_parse_analyst_actions(self):
        state = _load("consensus_store.json")
        actions = parse_analyst_actions(state["forecastStore"])
        assert len(actions) == 1
        assert actions[0]["firm_name"] == "UBS"

    def test_parse_earnings_history(self):
        store = _load("earnings_store.json")
        out = parse_earnings_history(store)
        assert len(out["quarters"]) == 1
        assert out["quarters"][0]["eps_forecast"] == 1.89

    def test_parse_technical_indicators(self):
        state = _load("technical_store.json")
        out = parse_technical_indicators(state["technicalStore"])
        assert "1d" in out["timeframes"]
        assert out["summary"] == "strong_buy"

    def test_parse_price_history(self):
        state = _load("historical_data_store.json")
        out = parse_price_history(state["historicalDataStore"])
        assert len(out["bars"]) == 1
        assert out["bars"][0]["close"] == 294

    def test_parse_ratios_roce_flags(self):
        store = _load("ratios_store.json")
        out = parse_ratios(store)
        assert "ratio_details" in out
        assert out["roce_roic"]["roce_available"] is False

    def test_parse_profile_enrichment(self):
        store = _load("profile_store.json")
        out = parse_profile(store)
        assert out["sector"] == "Technology"
        assert out["employees"] == 166000

    def test_parse_india_ownership(self):
        breakdown = {
            "number_of_institutional_holdings": 10,
            "other_institutional_holdings": {"percent": 58.1},
            "public_companies_and_individuals_holdings": {"percent": 19.8},
            "total_institutional_holdings": {"percent": 80.2},
            "total_mutual_funds_and_etf_holdings": {"percent": 22.0},
        }
        out = parse_india_ownership_breakdown({"percentOfSharesOutstanding": breakdown}, market="IN")
        assert out["available"] is True
        assert out["promoter_pct"] == 19.8

    def test_parse_delivery_turnover(self):
        state = {
            "equityStore": {
                "instrument": {
                    "volume": {"_turnover": 4910595, "volume": 1000},
                    "price": {"last": 100},
                    "fundamental": {},
                }
            }
        }
        out = parse_delivery_turnover(state, market="IN")
        assert out["turnover"] == 4910595


class TestPrerequisitesTiers:
    def test_all_tier_datasets_have_handlers(self):
        result = validate_prerequisites()
        assert result["ok"] is True
        assert result["tier_coverage"]["tier1_pct"] == 100
        assert result["tier_coverage"]["tier3_pct"] == 100
        for ds in TIER1_DATASETS:
            assert ds in SYMBOL_HANDLERS
        for ds in TIER3_DATASETS:
            assert ds in SYMBOL_HANDLERS

    def test_catalog_covers_all_datasets(self):
        result = validate_prerequisites()
        assert result["issues"]["missing_catalog_entries"] == []
        assert len(DATASETS) >= len(TIER1_DATASETS) + len(TIER3_DATASETS) + 4
