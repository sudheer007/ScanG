"""MongoDB helpers for ingestion."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from ingestion.collections import INDEX_SPECS, RAW_PAYLOAD_TTL_SECONDS, RAW_PAYLOADS

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

_client: Optional[MongoClient] = None
_async_client: Optional[AsyncIOMotorClient] = None


def _mongo_url() -> str:
    url = os.environ.get("MONGO_URL")
    if not url:
        raise RuntimeError("MONGO_URL is not set in backend-v2/.env")
    return url


def _db_name() -> str:
    name = os.environ.get("DB_NAME")
    if not name:
        raise RuntimeError("DB_NAME is not set in backend-v2/.env")
    return name


def get_sync_db() -> Database:
    global _client
    if _client is None:
        _client = MongoClient(_mongo_url())
    return _client[_db_name()]


def get_async_db() -> AsyncIOMotorDatabase:
    global _async_client
    if _async_client is None:
        _async_client = AsyncIOMotorClient(_mongo_url())
    return _async_client[_db_name()]


def _dir_keys(keys):
    out = []
    for field, direction in keys:
        out.append((field, ASCENDING if direction >= 0 else DESCENDING))
    return out


def ensure_indexes(db: Optional[Database] = None) -> dict:
    """Create ingestion collection indexes (idempotent)."""
    if db is None:
        db = get_sync_db()
    created = []
    for coll_name, keys, unique, name in INDEX_SPECS:
        if name == "raw_ttl":
            db[coll_name].create_index(
                _dir_keys(keys),
                name=name,
                expireAfterSeconds=RAW_PAYLOAD_TTL_SECONDS,
            )
            created.append({"collection": coll_name, "index": name, "ttl_s": RAW_PAYLOAD_TTL_SECONDS})
            continue
        db[coll_name].create_index(_dir_keys(keys), unique=unique, name=name)
        created.append({"collection": coll_name, "index": name, "unique": unique})
    return {"indexes": created}


def close_clients() -> None:
    global _client, _async_client
    if _client is not None:
        _client.close()
        _client = None
    if _async_client is not None:
        _async_client.close()
        _async_client = None
