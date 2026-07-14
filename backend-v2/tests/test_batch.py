"""Tests for batch ingestion runner (Phase 3)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from ingestion.batch import (
    ALL_PARTITIONS,
    MARKET_PARTITIONS,
    iter_batches,
    partition_info,
    resolve_symbols,
    run_batch,
    run_nightly,
)


class TestBatchHelpers:
    def test_partition_info(self):
        info = partition_info()
        assert len(info) == len(ALL_PARTITIONS)
        keys = {row["partition"] for row in info}
        assert keys == set(ALL_PARTITIONS)
        for row in info:
            assert row["symbol_count"] > 0

    def test_resolve_symbols_by_partition(self):
        market, symbols = resolve_symbols(partition="us_core", limit=5)
        assert market == "US"
        assert len(symbols) == 5

    def test_resolve_symbols_by_market(self):
        market, symbols = resolve_symbols(market="IN", offset=2, limit=3)
        assert market == "IN"
        assert len(symbols) == 3

    def test_iter_batches(self):
        batches = list(iter_batches(["A", "B", "C", "D", "E"], 2))
        assert batches == [["A", "B"], ["C", "D"], ["E"]]

    def test_unknown_partition_raises(self):
        with pytest.raises(ValueError, match="Unknown partition"):
            resolve_symbols(partition="eu_core")


class TestRunBatch:
    @patch("ingestion.batch.scrape_symbol")
    @patch("ingestion.batch.ensure_indexes")
    @patch("ingestion.batch.get_sync_db")
    def test_dry_run_plans_without_scraping(self, mock_db, mock_indexes, mock_scrape):
        mock_db.return_value.ingestion_runs = mock_db.return_value.ingestion_errors = type("C", (), {"insert_one": lambda *a, **k: None})()
        result = run_batch(partition="us_core", limit=3, batch_size=2, dry_run=True, ensure_db_indexes=False)
        assert result["status"] == "dry_run"
        assert result["plan"]["symbol_count"] == 3
        assert result["plan"]["batch_count"] == 2
        mock_scrape.assert_not_called()
        mock_indexes.assert_not_called()

    @patch("ingestion.batch.scrape_symbol")
    @patch("ingestion.batch.ensure_indexes")
    @patch("ingestion.batch.get_sync_db")
    def test_run_batch_scrapes_symbols(self, mock_db, mock_indexes, mock_scrape):
        coll = type("C", (), {"insert_one": lambda *a, **k: None})()
        mock_db.return_value.ingestion_runs = coll
        mock_db.return_value.ingestion_errors = coll
        mock_scrape.return_value = {"status": "completed", "run_id": "sym-run"}

        result = run_batch(
            symbols=["AAPL", "MSFT"],
            market="US",
            datasets=["financial_statements"],
            batch_size=2,
            dry_run=False,
            ensure_db_indexes=False,
        )
        assert mock_scrape.call_count == 2
        assert result["status"] == "completed"
        assert result["counts"]["symbols_ok"] == 2

    @patch("ingestion.batch.scrape_symbol")
    @patch("ingestion.batch.ensure_indexes")
    @patch("ingestion.batch.get_sync_db")
    def test_run_batch_continues_on_symbol_failure(self, mock_db, mock_indexes, mock_scrape):
        coll = type("C", (), {"insert_one": lambda *a, **k: None})()
        mock_db.return_value.ingestion_runs = coll
        mock_db.return_value.ingestion_errors = coll

        def _side_effect(symbol, **kwargs):
            if symbol == "BAD":
                raise RuntimeError("resolve failed")
            return {"status": "completed", "run_id": "ok"}

        mock_scrape.side_effect = _side_effect
        result = run_batch(
            symbols=["AAPL", "BAD"],
            market="US",
            datasets=["ratios_fundamentals"],
            batch_size=2,
            dry_run=False,
            ensure_db_indexes=False,
        )
        assert result["status"] == "completed_with_errors"
        assert result["counts"]["symbols_ok"] == 1
        assert result["counts"]["symbols_failed"] == 1


class TestRunNightly:
    @patch("ingestion.batch.run_batch")
    @patch("ingestion.batch.get_sync_db")
    def test_nightly_dry_run_all_partitions(self, mock_db, mock_run_batch):
        coll = type("C", (), {"insert_one": lambda *a, **k: None})()
        mock_db.return_value.ingestion_runs = coll
        mock_db.return_value.ingestion_errors = coll
        mock_run_batch.return_value = {"status": "dry_run", "plan": {"symbol_count": 10}}

        result = run_nightly(dry_run=True, limit=2)
        assert result["status"] == "dry_run"
        assert mock_run_batch.call_count == len(ALL_PARTITIONS)
        for call in mock_run_batch.call_args_list:
            assert call.kwargs["dry_run"] is True
            assert call.kwargs["partition"] in MARKET_PARTITIONS
