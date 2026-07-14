"""Tests for Mongo-first data access merge layer."""

from __future__ import annotations

from ingestion.data_access import (
    analyzer_section_sources,
    build_events_from_mongo,
    merge_enrichment_into_bundle,
    merge_events,
)


class TestDataAccessMerge:
    def test_merge_enrichment_overrides_yahoo_gaps(self):
        bundle = {
            "symbol": "AAPL",
            "price": 200.0,
            "pe": 30.0,
            "sector": None,
            "target_mean_price": None,
        }
        enrichment = {
            "available": True,
            "sections": {
                "instrument": {"sector": "Technology", "employees": 166000},
                "ratios": {
                    "ratios": {"pe_ratio_ttm": 28.5, "return_on_equity_ttm": 150.0},
                    "roce_roic": {"roce_available": True, "roce": 45.0},
                },
                "analyst_consensus": {
                    "consensus": {
                        "recommendation": "BUY",
                        "target_mean": 220.0,
                        "number_of_estimates": 40,
                    },
                    "rating_counts": {"buy": 25, "hold": 10, "sell": 5},
                },
                "financial_statements": [
                    {
                        "statement_type": "income",
                        "period_type": "annual",
                        "period_end": "2025-09-30",
                        "line_items": {
                            "total_revenues_standard": {"value": 400_000_000_000},
                        },
                    }
                ],
            },
        }
        out = merge_enrichment_into_bundle(bundle, enrichment)
        assert out["sector"] == "Technology"
        assert out["pe"] == 28.5
        assert out["roe"] == 150.0
        assert out["roce"] == 45.0
        assert out["target_mean_price"] == 220.0
        assert out["total_revenue"] == 400_000_000_000
        assert out["statement_history"]
        assert out["_data_sources"]["investing"] is True

    def test_merge_events_prefers_mongo(self):
        yahoo = {
            "symbol": "AAPL",
            "analyst_actions": [{"firm": "Yahoo Firm", "action": "hold"}],
            "earnings_history": [{"eps_actual": 1.0}],
            "calendar": {"next_earnings_epoch": 123},
        }
        mongo = {
            "analyst_actions": [{"firm": "UBS", "action": "upgrade", "source": "investing.com"}],
            "earnings_history": [{"eps_actual": 1.89, "source": "investing.com"}],
            "target_mean_price": 315.0,
        }
        out = merge_events(yahoo, mongo)
        assert out["analyst_actions"][0]["firm"] == "UBS"
        assert out["earnings_history"][0]["eps_actual"] == 1.89
        assert out["calendar"]["next_earnings_epoch"] == 123
        assert out["_data_sources"]["primary"] == "investing.com"

    def test_build_events_from_mongo(self):
        enrichment = {
            "available": True,
            "sections": {
                "analyst_actions": [{"action_date": "2026-07-01", "firm_name": "UBS", "action": "Maintain", "rating": "Hold"}],
                "earnings_history": {"quarters": [{"date": "2026-06-30", "eps_actual": 1.5, "eps_forecast": 1.4}]},
                "analyst_consensus": {"consensus": {"recommendation": "BUY", "target_mean": 300}},
            },
        }
        events = build_events_from_mongo(enrichment)
        assert events is not None
        assert len(events["analyst_actions"]) == 1
        assert events["earnings_history"][0]["eps_actual"] == 1.5

    def test_analyzer_section_sources(self):
        bundle = {
            "_data_sources": {
                "investing_fields": ["financial_statements.history", "ratios.pe", "ownership.pct_institutions"],
            },
            "total_revenue": 100,
            "pct_institutions": 60,
        }
        sources = analyzer_section_sources(bundle)
        assert sources["financials"] == "investing.com"
        assert sources["ownership"] == "investing.com"
        assert sources["valuation"] == "investing.com"
