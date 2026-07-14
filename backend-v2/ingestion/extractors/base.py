"""Base extractor utilities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from ingestion.catalog import PAGE_STORES
from ingestion.client import InvestingClient
from ingestion.parsers import content_fingerprint, page_state, store_payload


@dataclass
class ExtractResult:
    dataset: str
    data: Any
    fingerprint: str
    raw_store: Dict[str, Any]


class PageExtractor:
    def __init__(self, client: InvestingClient, slug: str, page_suffix: str):
        self.client = client
        self.slug = slug
        self.page_suffix = page_suffix
        self.store_name = PAGE_STORES[page_suffix]

    def fetch_store(self) -> tuple[str, Dict[str, Any], str]:
        html = self.client.equity_page(self.slug, self.page_suffix)
        state = page_state(html)
        store = store_payload(state, self.store_name)
        return html, store, content_fingerprint(html)
