"""Canonical data catalog for Investing.com ingestion."""

from __future__ import annotations

from typing import Any, Dict, List

# statement_type values stored in financial_statements
STATEMENT_INCOME = "income"
STATEMENT_BALANCE = "balance"
STATEMENT_CASHFLOW = "cashflow"

PERIOD_ANNUAL = "annual"
PERIOD_QUARTERLY = "quarterly"

# corporate action types
ACTION_DIVIDEND = "dividend"
ACTION_SPLIT = "split"

# Core dataset keys
DATASET_INSTRUMENT = "instrument"
DATASET_FINANCIAL_STATEMENTS = "financial_statements"
DATASET_CORPORATE_ACTIONS = "corporate_actions"
DATASET_RATIOS = "ratios_fundamentals"
DATASET_OWNERSHIP = "ownership_insider"
DATASET_SECTOR_AGGREGATES = "sector_industry_aggregates"

# Tier 1 datasets (symbol-scoped)
DATASET_ANALYST_CONSENSUS = "analyst_consensus"
DATASET_EARNINGS_HISTORY = "earnings_history"
DATASET_TECHNICAL_INDICATORS = "technical_indicators"
DATASET_PRICE_HISTORY = "price_history"
DATASET_QUOTE_SNAPSHOT = "quote_snapshot"
DATASET_STOCK_NEWS = "stock_news"
DATASET_ANALYST_ACTIONS = "analyst_actions"

TIER1_DATASETS: List[str] = [
    DATASET_ANALYST_CONSENSUS,
    DATASET_EARNINGS_HISTORY,
    DATASET_TECHNICAL_INDICATORS,
    DATASET_PRICE_HISTORY,
    DATASET_QUOTE_SNAPSHOT,
    DATASET_STOCK_NEWS,
    DATASET_ANALYST_ACTIONS,
]

# Tier 2 datasets (market-wide hubs)
DATASET_EARNINGS_CALENDAR = "earnings_calendar"
DATASET_DIVIDEND_CALENDAR = "dividend_calendar"
DATASET_MACRO_EVENTS = "macro_events"
DATASET_INDEX_SECTOR_PERFORMANCE = "index_sector_performance"

TIER2_DATASETS: List[str] = [
    DATASET_EARNINGS_CALENDAR,
    DATASET_DIVIDEND_CALENDAR,
    DATASET_MACRO_EVENTS,
    DATASET_INDEX_SECTOR_PERFORMANCE,
]

# Tier 3 datasets (India-focused, symbol-scoped)
DATASET_OWNERSHIP_PROMOTER = "ownership_promoter_fii_dii_mf"
DATASET_DELIVERY_TURNOVER = "delivery_turnover_metrics"

TIER3_DATASETS: List[str] = [
    DATASET_OWNERSHIP_PROMOTER,
    DATASET_DELIVERY_TURNOVER,
]

PLANNED_DATASETS: List[str] = TIER1_DATASETS + TIER2_DATASETS + TIER3_DATASETS

SYMBOL_DATASETS: List[str] = [
    DATASET_INSTRUMENT,
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_CORPORATE_ACTIONS,
    DATASET_RATIOS,
    DATASET_OWNERSHIP,
    DATASET_SECTOR_AGGREGATES,
    *TIER1_DATASETS,
    *TIER3_DATASETS,
]

MARKET_DATASETS: List[str] = list(TIER2_DATASETS)

DATASETS: List[str] = SYMBOL_DATASETS + MARKET_DATASETS

# Datasets gated by smart freshness policy
SMART_SCRAPE_DATASETS: List[str] = [
    DATASET_FINANCIAL_STATEMENTS,
    DATASET_CORPORATE_ACTIONS,
    DATASET_RATIOS,
    DATASET_OWNERSHIP,
    DATASET_ANALYST_CONSENSUS,
    DATASET_EARNINGS_HISTORY,
    DATASET_TECHNICAL_INDICATORS,
    DATASET_PRICE_HISTORY,
    DATASET_QUOTE_SNAPSHOT,
    DATASET_STOCK_NEWS,
    DATASET_ANALYST_ACTIONS,
    DATASET_OWNERSHIP_PROMOTER,
    DATASET_DELIVERY_TURNOVER,
    DATASET_EARNINGS_CALENDAR,
    DATASET_DIVIDEND_CALENDAR,
    DATASET_MACRO_EVENTS,
    DATASET_INDEX_SECTOR_PERFORMANCE,
]

# TTL in hours per smart-scrape dataset
SMART_SCRAPE_TTL_HOURS: Dict[str, int] = {
    DATASET_FINANCIAL_STATEMENTS: 24 * 7,
    DATASET_CORPORATE_ACTIONS: 24 * 3,
    DATASET_RATIOS: 24,
    DATASET_OWNERSHIP: 24 * 7,
    DATASET_ANALYST_CONSENSUS: 24,
    DATASET_EARNINGS_HISTORY: 24 * 3,
    DATASET_TECHNICAL_INDICATORS: 12,
    DATASET_PRICE_HISTORY: 24,
    DATASET_QUOTE_SNAPSHOT: 1,
    DATASET_STOCK_NEWS: 6,
    DATASET_OWNERSHIP_PROMOTER: 24 * 7,
    DATASET_DELIVERY_TURNOVER: 24,
    DATASET_EARNINGS_CALENDAR: 12,
    DATASET_DIVIDEND_CALENDAR: 24,
    DATASET_MACRO_EVENTS: 6,
    DATASET_INDEX_SECTOR_PERFORMANCE: 6,
    DATASET_ANALYST_ACTIONS: 24,
}

# Investing page suffix -> NEXT_DATA store name (symbol pages)
PAGE_STORES: Dict[str, str] = {
    "income-statement": "incomeStatementStore",
    "balance-sheet": "balanceSheetStore",
    "cash-flow": "cashFlowStore",
    "dividends": "dividendsStore",
    "historical-data-splits": "historicalDataSplitsStore",
    "ratios": "ratiosStore",
    "ownership": "ownershipStore",
    "company-profile": "companyProfileStore",
    "consensus-estimates": "consensusEstimatesStore",
    "earnings": "earningsStore",
    "technical": "technicalStore",
    "historical-data": "historicalDataStore",
    "news": "newsStore",
}

# Market hub pages (no symbol slug)
HUB_PAGES: Dict[str, str] = {
    DATASET_EARNINGS_CALENDAR: "https://www.investing.com/earnings-calendar/",
    DATASET_DIVIDEND_CALENDAR: "https://www.investing.com/dividends-calendar/",
    DATASET_MACRO_EVENTS: "https://www.investing.com/economic-calendar/",
    DATASET_INDEX_SECTOR_PERFORMANCE: "https://www.investing.com/indices/major-indices",
}

CATALOG: List[Dict[str, Any]] = [
    {
        "dataset": DATASET_INSTRUMENT,
        "collection": "instruments",
        "tier": 0,
        "scope": "symbol",
        "source": "search API + equity overview",
        "parser": "search quotes + equityStore.instrument",
        "fields": [
            "symbol", "market", "investing_pair_id", "slug", "name", "exchange", "currency",
            "sector", "industry", "description", "employees", "isin", "website", "ipo_date",
            "shares_outstanding",
        ],
    },
    {
        "dataset": DATASET_FINANCIAL_STATEMENTS,
        "collection": "financial_statements",
        "tier": 0,
        "scope": "symbol",
        "source": "income/balance/cash-flow pages",
        "parser": "incomeStatementStore / balanceSheetStore / cashFlowStore",
        "fields": ["symbol", "statement_type", "period_type", "period_end", "currency", "line_items"],
    },
    {
        "dataset": DATASET_CORPORATE_ACTIONS,
        "collection": "corporate_actions",
        "tier": 0,
        "scope": "symbol",
        "source": "dividends + historical splits pages",
        "parser": "dividendsStore.equityDividends + historicalDataSplitsStore.splits",
        "fields": ["symbol", "action_type", "action_date", "amount", "ratio", "payment_date", "yield_pct"],
    },
    {
        "dataset": DATASET_RATIOS,
        "collection": "ratios_fundamentals",
        "tier": 0,
        "scope": "symbol",
        "source": "ratios page",
        "parser": "ratiosStore.ratiosData.indicators",
        "fields": ["symbol", "as_of_date", "ratios", "ratio_details", "industry_benchmarks", "roce_roic"],
    },
    {
        "dataset": DATASET_OWNERSHIP,
        "collection": "ownership_insider",
        "tier": 0,
        "scope": "symbol",
        "source": "ownership page",
        "parser": "ownershipStore institutional + mutual fund holders + insider rows",
        "fields": [
            "symbol", "as_of_date", "institutional", "mutual_funds", "insider_transactions",
            "pct_shares_outstanding", "holdings_breakdown",
        ],
    },
    {
        "dataset": DATASET_SECTOR_AGGREGATES,
        "collection": "sector_industry_aggregates",
        "tier": 0,
        "scope": "symbol",
        "source": "company profile + ratios industry benchmarks",
        "parser": "companyProfileStore.profile + ratios industry_value fields",
        "fields": ["market", "sector", "industry", "as_of_date", "benchmarks"],
    },
    {
        "dataset": DATASET_ANALYST_CONSENSUS,
        "collection": "analyst_consensus",
        "tier": 1,
        "scope": "symbol",
        "source": "consensus-estimates page",
        "parser": "consensusEstimatesStore.forecastSummary + forecastStore.forecast",
        "fields": ["symbol", "as_of_date", "consensus", "target_prices", "rating_counts"],
    },
    {
        "dataset": DATASET_EARNINGS_HISTORY,
        "collection": "earnings_history",
        "tier": 1,
        "scope": "symbol",
        "source": "earnings page",
        "parser": "earningsStore.earnings + forecasts",
        "fields": ["symbol", "as_of_date", "quarters", "forecasts"],
    },
    {
        "dataset": DATASET_TECHNICAL_INDICATORS,
        "collection": "technical_indicators",
        "tier": 1,
        "scope": "symbol",
        "source": "technical page",
        "parser": "technicalStore.analysisDetails multi-timeframe",
        "fields": ["symbol", "as_of_date", "timeframes", "summary"],
    },
    {
        "dataset": DATASET_PRICE_HISTORY,
        "collection": "price_history",
        "tier": 1,
        "scope": "symbol",
        "source": "historical-data page",
        "parser": "historicalDataStore.historicalData.data",
        "fields": ["symbol", "as_of_date", "bars", "summary"],
    },
    {
        "dataset": DATASET_QUOTE_SNAPSHOT,
        "collection": "quote_snapshots",
        "tier": 1,
        "scope": "symbol",
        "source": "equity overview",
        "parser": "equityStore.instrument price + fundamental",
        "fields": ["symbol", "as_of_date", "price", "volume", "fundamental", "performance"],
    },
    {
        "dataset": DATASET_STOCK_NEWS,
        "collection": "stock_news",
        "tier": 1,
        "scope": "symbol",
        "source": "news page",
        "parser": "newsStore._news + _breakingNews",
        "fields": ["symbol", "as_of_date", "articles"],
    },
    {
        "dataset": DATASET_EARNINGS_CALENDAR,
        "collection": "earnings_calendar",
        "tier": 2,
        "scope": "market",
        "source": "earnings-calendar hub",
        "parser": "earningsStore.earningsAssets",
        "fields": ["market", "as_of_date", "events_by_date"],
    },
    {
        "dataset": DATASET_DIVIDEND_CALENDAR,
        "collection": "dividend_calendar",
        "tier": 2,
        "scope": "market",
        "source": "dividends-calendar hub",
        "parser": "dividendTbl HTML rows",
        "fields": ["market", "as_of_date", "events"],
    },
    {
        "dataset": DATASET_MACRO_EVENTS,
        "collection": "macro_events",
        "tier": 2,
        "scope": "market",
        "source": "economic-calendar hub",
        "parser": "economicCalendarStore.calendarEventsByDate",
        "fields": ["market", "as_of_date", "events_by_date"],
    },
    {
        "dataset": DATASET_INDEX_SECTOR_PERFORMANCE,
        "collection": "index_sector_performance",
        "tier": 2,
        "scope": "market",
        "source": "indices/major-indices hub",
        "parser": "assetsCollectionStore.assetsCollection._collection",
        "fields": ["market", "as_of_date", "indices"],
    },
    {
        "dataset": DATASET_ANALYST_ACTIONS,
        "collection": "analyst_actions",
        "tier": 1,
        "scope": "symbol",
        "source": "consensus-estimates page",
        "parser": "forecastStore.ratings",
        "fields": ["symbol", "as_of_date", "actions"],
    },
    {
        "dataset": DATASET_OWNERSHIP_PROMOTER,
        "collection": "ownership_promoter_fii_dii_mf",
        "tier": 3,
        "scope": "symbol",
        "source": "ownership page (India)",
        "parser": "ownershipStore.percentOfSharesOutstanding + holders",
        "fields": ["symbol", "as_of_date", "promoter_pct", "fii_pct", "dii_pct", "mf_pct", "breakdown"],
    },
    {
        "dataset": DATASET_DELIVERY_TURNOVER,
        "collection": "delivery_turnover_metrics",
        "tier": 3,
        "scope": "symbol",
        "source": "equity overview volume (India)",
        "parser": "equityStore.instrument.volume._turnover",
        "fields": ["symbol", "as_of_date", "turnover", "delivery_pct", "traded_value"],
    },
]


def get_catalog_entry(dataset: str) -> Dict[str, Any] | None:
    for row in CATALOG:
        if row["dataset"] == dataset:
            return row
    return None


def is_market_dataset(dataset: str) -> bool:
    return dataset in MARKET_DATASETS


def is_symbol_dataset(dataset: str) -> bool:
    return dataset in SYMBOL_DATASETS


def tier_for_dataset(dataset: str) -> int | None:
    entry = get_catalog_entry(dataset)
    return entry.get("tier") if entry else None
