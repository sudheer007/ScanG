"""Tests for universe coverage reporting."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from ingestion.coverage import FRESHNESS_SLA_HOURS, _pct, compute_universe_coverage


class TestCoverageMetrics:
    def test_pct_calculation(self):
        assert _pct(50, 100) == 50.0
        assert _pct(0, 0) == 0.0

    @patch("ingestion.coverage.get_universe")
    @patch("ingestion.coverage.get_sync_db")
    def test_compute_universe_coverage(self, mock_db_fn, mock_universe):
        mock_universe.return_value = ["AAPL", "MSFT", "GOOG"]
        db = MagicMock()

        def aggregate_side_effect(pipeline):
            coll = pipeline[0]["$match"].get("symbol", {}).get("$in", [])
            if "statement_type" in str(pipeline):
                return [{"_id": "AAPL"}, {"_id": "MSFT"}]
            return [{"_id": s} for s in coll if s in ("AAPL", "MSFT")]

        db.__getitem__ = MagicMock(return_value=MagicMock())
        for name in (
            "instruments", "financial_statements", "ownership_insider",
            "corporate_actions", "ratios_fundamentals", "ingestion_freshness",
        ):
            db.__getitem__.return_value.aggregate = aggregate_side_effect

        mock_db_fn.return_value = db
        result = compute_universe_coverage("US")
        assert result["symbol_count"] == 3
        assert "coverage_pct" in result
        assert result["coverage_pct"]["instruments"] <= 100.0
        assert FRESHNESS_SLA_HOURS == 48
