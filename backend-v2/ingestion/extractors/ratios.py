"""Ratios / fundamentals extractor."""

from __future__ import annotations

from ingestion.catalog import DATASET_RATIOS
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import parse_ratios


def extract_ratios(client: InvestingClient, slug: str) -> tuple[dict, dict]:
    _, store, _ = PageExtractor(client, slug, "ratios").fetch_store()
    parsed = parse_ratios(store)
    return parsed, {"dataset": DATASET_RATIOS, "store": store}
