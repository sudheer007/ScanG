"""Sector / industry aggregate extractor."""

from __future__ import annotations

from ingestion.catalog import DATASET_SECTOR_AGGREGATES
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.extractors.ratios import extract_ratios
from ingestion.parsers import parse_profile


def extract_sector_aggregates(
    client: InvestingClient,
    slug: str,
    *,
    market: str,
    symbol: str,
) -> tuple[dict, dict]:
    _, profile_store, _ = PageExtractor(client, slug, "company-profile").fetch_store()
    profile = parse_profile(profile_store)
    ratios, ratios_raw = extract_ratios(client, slug)

    doc = {
        "market": market,
        "symbol": symbol,
        "sector": profile.get("sector"),
        "industry": profile.get("industry"),
        "sector_link": profile.get("sector_link"),
        "industry_link": profile.get("industry_link"),
        "market_name": profile.get("market_name"),
        "description": profile.get("description"),
        "employees": profile.get("employees"),
        "website": profile.get("website"),
        "ipo_date": profile.get("ipo_date"),
        "shares_outstanding": profile.get("shares_outstanding"),
        "industry_benchmarks": ratios.get("industry_benchmarks") or {},
        "company_ratios": ratios.get("ratios") or {},
    }
    raw = {
        "dataset": DATASET_SECTOR_AGGREGATES,
        "profile_store": profile_store,
        "ratios_raw": ratios_raw,
    }
    return doc, raw
