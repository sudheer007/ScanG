"""Ownership / insider extractor."""

from __future__ import annotations

from ingestion.catalog import DATASET_OWNERSHIP
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import parse_ownership


def extract_ownership(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "ownership").fetch_store()
    parsed = parse_ownership(store)
    return parsed, {"dataset": DATASET_OWNERSHIP, "store": store}
