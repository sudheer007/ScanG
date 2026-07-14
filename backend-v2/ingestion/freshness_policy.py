"""Smart refresh policy: TTL gating and change detection per dataset."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from ingestion.catalog import (
    DATASET_CORPORATE_ACTIONS,
    DATASET_EARNINGS_HISTORY,
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_OWNERSHIP,
    DATASET_RATIOS,
    SMART_SCRAPE_DATASETS,
    SMART_SCRAPE_TTL_HOURS,
)

STATUS_SKIPPED_FRESH = "skipped_fresh"
STATUS_SKIPPED_UNCHANGED = "skipped_unchanged"
STATUS_UPDATED = "updated"
STATUS_FAILED = "failed"


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ttl_hours(dataset: str) -> Optional[int]:
    return SMART_SCRAPE_TTL_HOURS.get(dataset)


def is_smart_scrape_dataset(dataset: str) -> bool:
    return dataset in SMART_SCRAPE_DATASETS


def is_ttl_expired(
    meta: Optional[Dict[str, Any]],
    dataset: str,
    *,
    now: Optional[datetime] = None,
) -> bool:
    """Return True when dataset has no freshness row or TTL window has elapsed."""
    hours = ttl_hours(dataset)
    if hours is None:
        return True
    if not meta:
        return True
    anchor = meta.get("last_success_at") or meta.get("last_attempt_at")
    if not anchor:
        return True
    if not isinstance(anchor, datetime):
        return True
    now = now or datetime.now(timezone.utc)
    return _as_utc(anchor) + timedelta(hours=hours) <= _as_utc(now)


def should_scrape(
    dataset: str,
    meta: Optional[Dict[str, Any]],
    *,
    force: bool = False,
    now: Optional[datetime] = None,
) -> Tuple[bool, str]:
    """Decide whether a dataset scrape attempt should proceed (pre-canary)."""
    if force:
        return True, "force"
    if not is_smart_scrape_dataset(dataset):
        return True, "not_gated"
    if not meta:
        return True, "no_prior_state"
    if not is_ttl_expired(meta, dataset, now=now):
        return False, STATUS_SKIPPED_FRESH
    return True, "ttl_expired"


def has_changed(
    dataset: str,
    canary: Dict[str, Any],
    meta: Optional[Dict[str, Any]],
) -> Tuple[bool, str]:
    """Compare lightweight canary signals against stored freshness metadata."""
    if not meta:
        return True, "no_prior_state"

    if dataset == DATASET_FINANCIAL_STATEMENTS:
        latest = canary.get("latest_period_end")
        prior = meta.get("latest_period_end")
        if latest and prior and latest == prior:
            return False, STATUS_SKIPPED_UNCHANGED
        if latest and not prior:
            return True, "new_period_end"
        if latest != prior:
            return True, "period_end_changed"
        return True, "period_end_missing"

    if dataset == DATASET_CORPORATE_ACTIONS:
        latest = canary.get("latest_action_date")
        prior = meta.get("latest_action_date")
        if latest and prior and latest == prior:
            return False, STATUS_SKIPPED_UNCHANGED
        if latest and not prior:
            return True, "new_action_date"
        if latest != prior:
            return True, "action_date_changed"
        return True, "action_date_missing"

    if dataset in (DATASET_RATIOS, DATASET_OWNERSHIP):
        fp = canary.get("fingerprint")
        prior = meta.get("last_fingerprint")
        if fp and prior and fp == prior:
            return False, STATUS_SKIPPED_UNCHANGED
        return True, "fingerprint_changed"

    if dataset == DATASET_EARNINGS_HISTORY:
        latest = canary.get("latest_action_date")
        prior = meta.get("latest_action_date")
        if latest and prior and latest == prior:
            return False, STATUS_SKIPPED_UNCHANGED
        return True, "earnings_date_changed"

    # fingerprint-based change detection for remaining gated datasets
    fp = canary.get("fingerprint")
    prior = meta.get("last_fingerprint")
    if fp and prior and fp == prior:
        return False, STATUS_SKIPPED_UNCHANGED
    return True, "fingerprint_changed"


def preview_decision(
    dataset: str,
    meta: Optional[Dict[str, Any]],
    *,
    force: bool = False,
    canary: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Dry-run helper: report scrape/skip decision and reason."""
    scrape, reason = should_scrape(dataset, meta, force=force, now=now)
    out: Dict[str, Any] = {
        "dataset": dataset,
        "would_scrape": scrape,
        "reason": reason,
        "ttl_hours": ttl_hours(dataset),
        "has_prior_state": meta is not None,
    }
    if meta:
        out["last_status"] = meta.get("last_status")
        out["last_attempt_at"] = meta.get("last_attempt_at")
    if scrape and canary is not None and is_smart_scrape_dataset(dataset):
        changed, change_reason = has_changed(dataset, canary, meta)
        out["would_fetch_full"] = changed
        out["change_reason"] = change_reason
    return out
