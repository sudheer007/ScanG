"""Repository upsert idempotency tests (mocked Mongo)."""

from __future__ import annotations

from unittest.mock import MagicMock

from ingestion.repository import IngestionRepository


class TestRepositoryIdempotency:
    def test_financial_statements_upsert_key_stable(self):
        db = MagicMock()
        coll = MagicMock()
        db.__getitem__ = MagicMock(return_value=coll)
        repo = IngestionRepository(db)

        rows = [{
            "statement_type": "income",
            "period_type": "annual",
            "period_end": "2025-12-31",
            "line_items": {},
        }]
        repo.upsert_financial_statements("AAPL", rows, run_id="r1", as_of_date="2026-07-06")
        repo.upsert_financial_statements("AAPL", rows, run_id="r2", as_of_date="2026-07-07")

        assert coll.update_one.call_count == 2
        key1 = coll.update_one.call_args_list[0][0][0]
        key2 = coll.update_one.call_args_list[1][0][0]
        assert key1 == key2
        assert key1["symbol"] == "AAPL"
        assert key1["period_end"] == "2025-12-31"

    def test_corporate_actions_upsert_key_stable(self):
        db = MagicMock()
        coll = MagicMock()
        db.__getitem__ = MagicMock(return_value=coll)
        repo = IngestionRepository(db)

        row = {"action_type": "dividend", "action_date": "2026-06-01", "amount": 0.25}
        repo.upsert_corporate_actions("AAPL", [row], run_id="r1", as_of_date="2026-07-06")
        repo.upsert_corporate_actions("AAPL", [row], run_id="r2", as_of_date="2026-07-07")

        key = coll.update_one.call_args[0][0]
        assert key == {"symbol": "AAPL", "action_type": "dividend", "action_date": "2026-06-01"}
