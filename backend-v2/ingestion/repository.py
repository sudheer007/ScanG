"""Mongo upsert helpers for ingestion documents."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo.database import Database

from ingestion import collections as c


def _now() -> datetime:
    return datetime.now(timezone.utc)


class IngestionRepository:
    def __init__(self, db: Database):
        self.db = db

    def upsert_instrument(self, doc: Dict[str, Any]) -> None:
        now = _now()
        payload = {
            **doc,
            "updated_at": now,
            "source": "investing.com",
        }
        self.db[c.INSTRUMENTS].update_one(
            {"symbol": doc["symbol"]},
            {"$set": payload, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

    def upsert_financial_statements(self, symbol: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {
                "symbol": symbol,
                "statement_type": row["statement_type"],
                "period_type": row["period_type"],
                "period_end": row.get("period_end"),
            }
            payload = {
                **row,
                "symbol": symbol,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.FINANCIAL_STATEMENTS].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_corporate_actions(self, symbol: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {
                "symbol": symbol,
                "action_type": row["action_type"],
                "action_date": row.get("action_date"),
            }
            payload = {
                **row,
                "symbol": symbol,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.CORPORATE_ACTIONS].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_ratios(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {
            **doc,
            "symbol": symbol,
            "as_of_date": as_of_date,
            "run_id": run_id,
            "source": "investing.com",
            "updated_at": _now(),
        }
        self.db[c.RATIOS_FUNDAMENTALS].update_one(key, {"$set": payload}, upsert=True)

    def upsert_ownership(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {
            **doc,
            "symbol": symbol,
            "as_of_date": as_of_date,
            "run_id": run_id,
            "source": "investing.com",
            "updated_at": _now(),
        }
        self.db[c.OWNERSHIP_INSIDER].update_one(key, {"$set": payload}, upsert=True)

    def upsert_sector_aggregate(self, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {
            "market": doc["market"],
            "sector": doc.get("sector"),
            "industry": doc.get("industry"),
            "as_of_date": as_of_date,
        }
        payload = {
            **doc,
            "as_of_date": as_of_date,
            "run_id": run_id,
            "source": "investing.com",
            "updated_at": _now(),
        }
        self.db[c.SECTOR_INDUSTRY_AGGREGATES].update_one(key, {"$set": payload}, upsert=True)

    def upsert_analyst_consensus(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.ANALYST_CONSENSUS].update_one(key, {"$set": payload}, upsert=True)

    def upsert_earnings_history(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.EARNINGS_HISTORY].update_one(key, {"$set": payload}, upsert=True)

    def upsert_technical_indicators(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.TECHNICAL_INDICATORS].update_one(key, {"$set": payload}, upsert=True)

    def upsert_price_history(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.PRICE_HISTORY].update_one(key, {"$set": payload}, upsert=True)

    def upsert_quote_snapshot(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.QUOTE_SNAPSHOTS].update_one(key, {"$set": payload}, upsert=True)

    def upsert_stock_news(self, symbol: str, articles: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for article in articles:
            aid = article.get("article_id")
            if not aid:
                continue
            key = {"symbol": symbol, "article_id": aid}
            payload = {
                **article,
                "symbol": symbol,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.STOCK_NEWS].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_analyst_actions(self, symbol: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {
                "symbol": symbol,
                "action_date": row.get("action_date"),
                "firm_name": row.get("firm_name"),
            }
            payload = {
                **row,
                "symbol": symbol,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.ANALYST_ACTIONS].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_earnings_calendar(self, market: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {"market": market, "event_date": row.get("event_date"), "symbol": row.get("symbol")}
            payload = {
                **row,
                "market": market,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.EARNINGS_CALENDAR].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_dividend_calendar(self, market: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {"market": market, "ex_date": row.get("ex_date"), "symbol": row.get("symbol")}
            payload = {
                **row,
                "market": market,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.DIVIDEND_CALENDAR].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_macro_events(self, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {"event_id": row.get("event_id"), "event_date": row.get("event_date")}
            payload = {
                **row,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.MACRO_EVENTS].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_index_sector_performance(self, market: str, rows: List[Dict[str, Any]], *, run_id: str, as_of_date: str) -> int:
        n = 0
        for row in rows:
            key = {"market": market, "index_id": row.get("index_id"), "as_of_date": as_of_date}
            payload = {
                **row,
                "market": market,
                "as_of_date": as_of_date,
                "run_id": run_id,
                "source": "investing.com",
                "updated_at": _now(),
            }
            self.db[c.INDEX_SECTOR_PERFORMANCE].update_one(key, {"$set": payload}, upsert=True)
            n += 1
        return n

    def upsert_ownership_promoter(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.OWNERSHIP_PROMOTER].update_one(key, {"$set": payload}, upsert=True)

    def upsert_delivery_turnover(self, symbol: str, doc: Dict[str, Any], *, run_id: str, as_of_date: str) -> None:
        key = {"symbol": symbol, "as_of_date": as_of_date}
        payload = {**doc, "symbol": symbol, "as_of_date": as_of_date, "run_id": run_id, "source": "investing.com", "updated_at": _now()}
        self.db[c.DELIVERY_TURNOVER].update_one(key, {"$set": payload}, upsert=True)

    def count_dataset_coverage(self, collection: str, *, market: Optional[str] = None) -> Dict[str, Any]:
        coll = self.db[collection]
        if market and collection not in (c.MACRO_EVENTS,):
            pipeline = [
                {"$match": {"market": market}},
                {"$group": {"_id": "$symbol" if "symbol" in (coll.find_one() or {}) else "$index_id", "count": {"$sum": 1}}},
                {"$count": "covered"},
            ]
        else:
            pipeline = [{"$group": {"_id": "$symbol", "count": {"$sum": 1}}}, {"$count": "covered"}]
        try:
            rows = list(coll.aggregate(pipeline))
            covered = rows[0]["covered"] if rows else 0
        except Exception:  # noqa: BLE001
            covered = coll.estimated_document_count()
        return {"collection": collection, "covered": covered}

    def save_raw_payload(
        self,
        *,
        symbol: str,
        dataset: str,
        fingerprint: str,
        payload: Dict[str, Any],
        run_id: str,
    ) -> None:
        self.db[c.RAW_PAYLOADS].insert_one({
            "symbol": symbol,
            "dataset": dataset,
            "fingerprint": fingerprint,
            "payload": payload,
            "run_id": run_id,
            "fetched_at": _now(),
            "source": "investing.com",
        })

    def get_freshness(self, symbol: str, dataset: str) -> Optional[Dict[str, Any]]:
        return self.db[c.INGESTION_FRESHNESS].find_one({"symbol": symbol, "dataset": dataset})

    def get_freshness_map(self, symbol: str, datasets: List[str]) -> Dict[str, Dict[str, Any]]:
        cursor = self.db[c.INGESTION_FRESHNESS].find(
            {"symbol": symbol, "dataset": {"$in": datasets}},
        )
        return {doc["dataset"]: doc for doc in cursor}

    def update_freshness(
        self,
        symbol: str,
        dataset: str,
        *,
        status: str,
        run_id: str,
        fingerprint: Optional[str] = None,
        latest_period_end: Optional[str] = None,
        latest_action_date: Optional[str] = None,
        market: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        now = _now()
        update: Dict[str, Any] = {
            "symbol": symbol,
            "dataset": dataset,
            "last_status": status,
            "last_run_id": run_id,
            "last_attempt_at": now,
            "updated_at": now,
        }
        if market:
            update["market"] = market
        if fingerprint is not None:
            update["last_fingerprint"] = fingerprint
        if latest_period_end is not None:
            update["latest_period_end"] = latest_period_end
        if latest_action_date is not None:
            update["latest_action_date"] = latest_action_date
        if error:
            update["last_error"] = error
        if status in ("updated", "skipped_unchanged"):
            update["last_success_at"] = now

        self.db[c.INGESTION_FRESHNESS].update_one(
            {"symbol": symbol, "dataset": dataset},
            {"$set": update, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
