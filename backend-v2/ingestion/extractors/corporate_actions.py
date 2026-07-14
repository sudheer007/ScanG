"""Corporate actions extractor (dividends + splits)."""

from __future__ import annotations

from ingestion.catalog import DATASET_CORPORATE_ACTIONS
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import parse_dividends, parse_splits


def extract_corporate_actions(client: InvestingClient, slug: str) -> tuple[list[dict], dict]:
    _, dividends_store, _ = PageExtractor(client, slug, "dividends").fetch_store()
    _, splits_store, _ = PageExtractor(client, slug, "historical-data-splits").fetch_store()
    rows = parse_dividends(dividends_store) + parse_splits(splits_store)
    return rows, {
        "dataset": DATASET_CORPORATE_ACTIONS,
        "dividends": dividends_store,
        "splits": splits_store,
        "row_count": len(rows),
    }
