"""Phase 0 prerequisite validation for ingestion foundations."""

from __future__ import annotations

from typing import Any, Dict

from ingestion import collections as c
from ingestion.catalog import (
    CATALOG,
    DATASETS,
    MARKET_DATASETS,
    PAGE_STORES,
    PLANNED_DATASETS,
    SYMBOL_DATASETS,
    TIER1_DATASETS,
    TIER2_DATASETS,
    TIER3_DATASETS,
)
from ingestion.canary import CANARY_FETCHERS
from ingestion.symbol_handlers import SYMBOL_HANDLERS


def validate_prerequisites() -> Dict[str, Any]:
    """Validate ingestion foundations and tier dataset readiness."""
    catalog_datasets = {row["dataset"] for row in CATALOG}
    indexed_collections = {spec[0] for spec in c.INDEX_SPECS}
    missing_catalog = [d for d in DATASETS if d not in catalog_datasets]
    missing_indexes = [coll for coll in c.COLLECTIONS if coll not in indexed_collections and coll != c.RAW_PAYLOADS]

    symbol_with_handlers = set(SYMBOL_HANDLERS.keys())
    missing_symbol_handlers = [
        d for d in SYMBOL_DATASETS
        if d not in ("instrument",) and d not in symbol_with_handlers
    ]

    tier1_ready = [d for d in TIER1_DATASETS if d in symbol_with_handlers]
    tier2_ready = list(MARKET_DATASETS)
    tier3_ready = [d for d in TIER3_DATASETS if d in symbol_with_handlers]

    return {
        "ok": not (missing_catalog or missing_indexes or missing_symbol_handlers),
        "datasets": DATASETS,
        "planned_datasets": PLANNED_DATASETS,
        "tier1_datasets": TIER1_DATASETS,
        "tier2_datasets": TIER2_DATASETS,
        "tier3_datasets": TIER3_DATASETS,
        "page_stores": len(PAGE_STORES),
        "canary_fetchers": list(CANARY_FETCHERS.keys()),
        "symbol_handlers": list(SYMBOL_HANDLERS.keys()),
        "collections": list(c.COLLECTIONS),
        "issues": {
            "missing_catalog_entries": missing_catalog,
            "collections_without_indexes": missing_indexes,
            "missing_symbol_handlers": missing_symbol_handlers,
        },
        "tier_coverage": {
            "tier1_ready": tier1_ready,
            "tier1_pct": round(100 * len(tier1_ready) / max(len(TIER1_DATASETS), 1)),
            "tier2_ready": tier2_ready,
            "tier2_pct": 100 if tier2_ready else 0,
            "tier3_ready": tier3_ready,
            "tier3_pct": round(100 * len(tier3_ready) / max(len(TIER3_DATASETS), 1)),
        },
    }
