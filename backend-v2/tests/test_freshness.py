"""Tests for smart freshness policy and repository helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from ingestion.catalog import (
    DATASET_CORPORATE_ACTIONS,
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_OWNERSHIP,
    DATASET_RATIOS,
)
from ingestion.freshness_policy import (
    STATUS_SKIPPED_FRESH,
    STATUS_SKIPPED_UNCHANGED,
    has_changed,
    is_ttl_expired,
    preview_decision,
    should_scrape,
)
from ingestion.prerequisites import validate_prerequisites
from ingestion.repository import IngestionRepository


class TestPrerequisites:
    def test_validate_prerequisites_ok(self):
        result = validate_prerequisites()
        assert result["ok"] is True
        assert result["issues"]["missing_catalog_entries"] == []
        assert result["issues"]["missing_symbol_handlers"] == []
        assert result["tier_coverage"]["tier1_pct"] == 100


class TestFreshnessPolicy:
    def _meta(self, *, hours_ago: int = 1, **extra):
        now = datetime.now(timezone.utc)
        return {
            "last_success_at": now - timedelta(hours=hours_ago),
            "last_attempt_at": now - timedelta(hours=hours_ago),
            **extra,
        }

    def test_should_scrape_force_bypasses_ttl(self):
        meta = self._meta(hours_ago=1)
        scrape, reason = should_scrape(DATASET_RATIOS, meta, force=True)
        assert scrape is True
        assert reason == "force"

    def test_should_scrape_skips_when_fresh(self):
        meta = self._meta(hours_ago=1, latest_period_end="2024-12-31")
        scrape, reason = should_scrape(DATASET_FINANCIAL_STATEMENTS, meta)
        assert scrape is False
        assert reason == STATUS_SKIPPED_FRESH

    def test_should_scrape_when_ttl_expired(self):
        meta = self._meta(hours_ago=24 * 10)
        scrape, reason = should_scrape(DATASET_FINANCIAL_STATEMENTS, meta)
        assert scrape is True
        assert reason == "ttl_expired"

    def test_is_ttl_expired_without_meta(self):
        assert is_ttl_expired(None, DATASET_RATIOS) is True

    def test_has_changed_financial_statements_unchanged(self):
        meta = {"latest_period_end": "2024-12-31"}
        changed, reason = has_changed(
            DATASET_FINANCIAL_STATEMENTS,
            {"latest_period_end": "2024-12-31"},
            meta,
        )
        assert changed is False
        assert reason == STATUS_SKIPPED_UNCHANGED

    def test_has_changed_corporate_actions_changed(self):
        meta = {"latest_action_date": "2024-01-01"}
        changed, reason = has_changed(
            DATASET_CORPORATE_ACTIONS,
            {"latest_action_date": "2024-06-01"},
            meta,
        )
        assert changed is True
        assert reason == "action_date_changed"

    def test_has_changed_ratios_fingerprint(self):
        meta = {"last_fingerprint": "abc"}
        changed, _ = has_changed(DATASET_RATIOS, {"fingerprint": "abc"}, meta)
        assert changed is False
        changed2, _ = has_changed(DATASET_RATIOS, {"fingerprint": "def"}, meta)
        assert changed2 is True

    def test_preview_decision_with_canary(self):
        meta = {
            "latest_period_end": "2024-12-31",
            "last_status": "updated",
            "last_success_at": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        out = preview_decision(
            DATASET_FINANCIAL_STATEMENTS,
            meta,
            canary={"latest_period_end": "2024-12-31"},
            force=False,
        )
        assert out["would_scrape"] is False
        assert out["reason"] == STATUS_SKIPPED_FRESH


class TestFreshnessRepository:
    def test_get_and_update_freshness(self):
        db = MagicMock()
        coll = MagicMock()
        db.__getitem__ = MagicMock(return_value=coll)
        coll.find_one.return_value = {"symbol": "AAPL", "dataset": DATASET_RATIOS, "last_status": "updated"}
        coll.update_one.return_value = MagicMock()

        repo = IngestionRepository(db)
        doc = repo.get_freshness("AAPL", DATASET_RATIOS)
        assert doc["symbol"] == "AAPL"

        repo.update_freshness(
            "AAPL",
            DATASET_OWNERSHIP,
            status="skipped_unchanged",
            run_id="run-1",
            fingerprint="fp1",
        )
        coll.update_one.assert_called_once()
        args, kwargs = coll.update_one.call_args
        assert args[0] == {"symbol": "AAPL", "dataset": DATASET_OWNERSHIP}
        update_doc = args[1] if len(args) > 1 else kwargs
        assert update_doc["$set"]["last_status"] == "skipped_unchanged"
        assert kwargs.get("upsert") is True
