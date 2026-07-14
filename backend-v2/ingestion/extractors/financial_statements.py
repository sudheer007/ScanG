"""Financial statements extractor."""

from __future__ import annotations

from typing import List

from ingestion.catalog import (
    DATASET_FINANCIAL_STATEMENTS,
    STATEMENT_BALANCE,
    STATEMENT_CASHFLOW,
    STATEMENT_INCOME,
)
from ingestion.client import InvestingClient
from ingestion.extractors.base import PageExtractor
from ingestion.parsers import parse_financial_store


def extract_financial_statements(client: InvestingClient, slug: str) -> tuple[list[dict], dict]:
    configs = [
        ("income-statement", "incomeStatementDataAnnual", "incomeStatementDataQuarterly", STATEMENT_INCOME),
        ("balance-sheet", "balanceSheetDataAnnual", "balanceSheetDataQuarterly", STATEMENT_BALANCE),
        ("cash-flow", "cashFlowDataAnnual", "cashFlowDataQuarterly", STATEMENT_CASHFLOW),
    ]
    rows: List[dict] = []
    raw = {}
    for suffix, annual_key, quarterly_key, statement_type in configs:
        _, store, _ = PageExtractor(client, slug, suffix).fetch_store()
        raw[suffix] = store
        rows.extend(
            parse_financial_store(
                store,
                annual_key=annual_key,
                quarterly_key=quarterly_key,
                statement_type=statement_type,
            )
        )
    return rows, {"dataset": DATASET_FINANCIAL_STATEMENTS, "stores": raw, "row_count": len(rows)}
