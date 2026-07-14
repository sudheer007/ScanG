"""Ingestion run and error logging."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pymongo.database import Database

from ingestion import collections as c


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RunLogger:
    def __init__(self, db: Database, *, market: str, symbol: Optional[str] = None, datasets: Optional[list[str]] = None):
        self.db = db
        self.run_id = str(uuid.uuid4())
        self.run_type = "symbol"
        self.market = market.upper()
        self.symbol = symbol
        self.datasets = datasets or []
        self.counts: Dict[str, int] = {}
        self.errors: list[Dict[str, Any]] = []
        self.started_at = _now()
        self._finished = False

    def inc(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n

    def log_error(self, *, dataset: str, message: str, context: Optional[Dict[str, Any]] = None) -> None:
        err = {
            "run_id": self.run_id,
            "market": self.market,
            "symbol": self.symbol,
            "dataset": dataset,
            "message": message,
            "context": context or {},
            "created_at": _now(),
        }
        self.errors.append(err)
        self.db[c.INGESTION_ERRORS].insert_one(err)

    def finish(self, status: str = "completed") -> Dict[str, Any]:
        if self._finished:
            return self.summary()
        finished_at = _now()
        doc = {
            "run_id": self.run_id,
            "run_type": self.run_type,
            "market": self.market,
            "symbol": self.symbol,
            "datasets": self.datasets,
            "status": status,
            "counts": self.counts,
            "error_count": len(self.errors),
            "started_at": self.started_at,
            "finished_at": finished_at,
            "duration_s": (finished_at - self.started_at).total_seconds(),
        }
        self.db[c.INGESTION_RUNS].insert_one(doc)
        self._finished = True
        return doc

    def summary(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "run_type": self.run_type,
            "market": self.market,
            "symbol": self.symbol,
            "counts": self.counts,
            "error_count": len(self.errors),
        }


class BatchRunLogger(RunLogger):
    """Batch / nightly ingestion run metadata."""

    def __init__(
        self,
        db: Database,
        *,
        partition: str,
        market: str,
        datasets: Optional[list[str]] = None,
        dry_run: bool = False,
        parent_run_id: Optional[str] = None,
    ):
        super().__init__(db, market=market, datasets=datasets)
        self.run_type = "batch"
        self.partition = partition
        self.dry_run = dry_run
        self.parent_run_id = parent_run_id
        self.plan: Dict[str, Any] = {}

    def set_plan(self, *, symbol_count: int, batch_count: int, batch_size: int) -> None:
        self.plan = {
            "symbol_count": symbol_count,
            "batch_count": batch_count,
            "batch_size": batch_size,
        }

    def finish(self, status: str = "completed", extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if self._finished:
            return self.summary()
        finished_at = _now()
        doc: Dict[str, Any] = {
            "run_id": self.run_id,
            "run_type": self.run_type,
            "partition": self.partition,
            "parent_run_id": self.parent_run_id,
            "market": self.market,
            "datasets": self.datasets,
            "dry_run": self.dry_run,
            "plan": self.plan,
            "status": status,
            "counts": self.counts,
            "error_count": len(self.errors),
            "started_at": self.started_at,
            "finished_at": finished_at,
            "duration_s": (finished_at - self.started_at).total_seconds(),
        }
        if extra:
            doc.update(extra)
        self.db[c.INGESTION_RUNS].insert_one(doc)
        self._finished = True
        return doc
