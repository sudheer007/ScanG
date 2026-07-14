"""Mongo collection names and index definitions."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

INSTRUMENTS = "instruments"
FINANCIAL_STATEMENTS = "financial_statements"
CORPORATE_ACTIONS = "corporate_actions"
OWNERSHIP_INSIDER = "ownership_insider"
RATIOS_FUNDAMENTALS = "ratios_fundamentals"
SECTOR_INDUSTRY_AGGREGATES = "sector_industry_aggregates"
ANALYST_CONSENSUS = "analyst_consensus"
EARNINGS_HISTORY = "earnings_history"
TECHNICAL_INDICATORS = "technical_indicators"
PRICE_HISTORY = "price_history"
QUOTE_SNAPSHOTS = "quote_snapshots"
STOCK_NEWS = "stock_news"
EARNINGS_CALENDAR = "earnings_calendar"
DIVIDEND_CALENDAR = "dividend_calendar"
MACRO_EVENTS = "macro_events"
INDEX_SECTOR_PERFORMANCE = "index_sector_performance"
ANALYST_ACTIONS = "analyst_actions"
OWNERSHIP_PROMOTER = "ownership_promoter_fii_dii_mf"
DELIVERY_TURNOVER = "delivery_turnover_metrics"
INGESTION_RUNS = "ingestion_runs"
INGESTION_ERRORS = "ingestion_errors"
INGESTION_FRESHNESS = "ingestion_freshness"
RAW_PAYLOADS = "raw_payloads"

COLLECTIONS: Tuple[str, ...] = (
    INSTRUMENTS,
    FINANCIAL_STATEMENTS,
    CORPORATE_ACTIONS,
    OWNERSHIP_INSIDER,
    RATIOS_FUNDAMENTALS,
    SECTOR_INDUSTRY_AGGREGATES,
    ANALYST_CONSENSUS,
    EARNINGS_HISTORY,
    TECHNICAL_INDICATORS,
    PRICE_HISTORY,
    QUOTE_SNAPSHOTS,
    STOCK_NEWS,
    EARNINGS_CALENDAR,
    DIVIDEND_CALENDAR,
    MACRO_EVENTS,
    INDEX_SECTOR_PERFORMANCE,
    ANALYST_ACTIONS,
    OWNERSHIP_PROMOTER,
    DELIVERY_TURNOVER,
    INGESTION_RUNS,
    INGESTION_ERRORS,
    INGESTION_FRESHNESS,
    RAW_PAYLOADS,
)

# (collection, index_spec, unique, name)
INDEX_SPECS: List[Tuple[str, List[Tuple[str, int]], bool, str]] = [
    (INSTRUMENTS, [("symbol", 1)], True, "uniq_symbol"),
    (INSTRUMENTS, [("market", 1), ("investing_pair_id", 1)], False, "market_pair"),
    (FINANCIAL_STATEMENTS, [("symbol", 1), ("statement_type", 1), ("period_type", 1), ("period_end", 1)], True, "uniq_stmt_period"),
    (FINANCIAL_STATEMENTS, [("symbol", 1), ("as_of_date", -1)], False, "symbol_as_of"),
    (CORPORATE_ACTIONS, [("symbol", 1), ("action_type", 1), ("action_date", 1)], True, "uniq_action"),
    (CORPORATE_ACTIONS, [("symbol", 1), ("as_of_date", -1)], False, "corp_symbol_as_of"),
    (OWNERSHIP_INSIDER, [("symbol", 1), ("as_of_date", 1)], True, "uniq_ownership_snapshot"),
    (RATIOS_FUNDAMENTALS, [("symbol", 1), ("as_of_date", 1)], True, "uniq_ratios_snapshot"),
    (SECTOR_INDUSTRY_AGGREGATES, [("market", 1), ("sector", 1), ("industry", 1), ("as_of_date", 1)], True, "uniq_sector_agg"),
    (SECTOR_INDUSTRY_AGGREGATES, [("sector", 1), ("as_of_date", -1)], False, "sector_as_of"),
    (ANALYST_CONSENSUS, [("symbol", 1), ("as_of_date", 1)], True, "uniq_analyst_consensus"),
    (EARNINGS_HISTORY, [("symbol", 1), ("as_of_date", 1)], True, "uniq_earnings_history"),
    (TECHNICAL_INDICATORS, [("symbol", 1), ("as_of_date", 1)], True, "uniq_technical"),
    (PRICE_HISTORY, [("symbol", 1), ("as_of_date", 1)], True, "uniq_price_history"),
    (QUOTE_SNAPSHOTS, [("symbol", 1), ("as_of_date", 1)], True, "uniq_quote_snapshot"),
    (STOCK_NEWS, [("symbol", 1), ("article_id", 1)], True, "uniq_stock_news_article"),
    (STOCK_NEWS, [("symbol", 1), ("as_of_date", -1)], False, "news_symbol_as_of"),
    (EARNINGS_CALENDAR, [("market", 1), ("event_date", 1), ("symbol", 1)], True, "uniq_earnings_cal_event"),
    (EARNINGS_CALENDAR, [("market", 1), ("as_of_date", -1)], False, "earnings_cal_as_of"),
    (DIVIDEND_CALENDAR, [("market", 1), ("ex_date", 1), ("symbol", 1)], True, "uniq_dividend_cal_event"),
    (DIVIDEND_CALENDAR, [("market", 1), ("as_of_date", -1)], False, "dividend_cal_as_of"),
    (MACRO_EVENTS, [("event_id", 1), ("event_date", 1)], True, "uniq_macro_event"),
    (MACRO_EVENTS, [("as_of_date", -1)], False, "macro_as_of"),
    (INDEX_SECTOR_PERFORMANCE, [("market", 1), ("index_id", 1), ("as_of_date", 1)], True, "uniq_index_perf"),
    (INDEX_SECTOR_PERFORMANCE, [("market", 1), ("as_of_date", -1)], False, "index_perf_as_of"),
    (ANALYST_ACTIONS, [("symbol", 1), ("action_date", 1), ("firm_name", 1)], True, "uniq_analyst_action"),
    (ANALYST_ACTIONS, [("symbol", 1), ("as_of_date", -1)], False, "analyst_actions_as_of"),
    (OWNERSHIP_PROMOTER, [("symbol", 1), ("as_of_date", 1)], True, "uniq_ownership_promoter"),
    (DELIVERY_TURNOVER, [("symbol", 1), ("as_of_date", 1)], True, "uniq_delivery_turnover"),
    (INGESTION_RUNS, [("run_id", 1)], True, "uniq_run"),
    (INGESTION_RUNS, [("started_at", -1)], False, "runs_started"),
    (INGESTION_ERRORS, [("run_id", 1), ("symbol", 1), ("dataset", 1)], False, "errors_run_symbol"),
    (INGESTION_FRESHNESS, [("symbol", 1), ("dataset", 1)], True, "uniq_symbol_dataset"),
    (INGESTION_FRESHNESS, [("dataset", 1), ("last_attempt_at", -1)], False, "dataset_last_attempt"),
    (INGESTION_FRESHNESS, [("dataset", 1), ("market", 1)], False, "dataset_market"),
    (RAW_PAYLOADS, [("symbol", 1), ("dataset", 1), ("fetched_at", -1)], False, "raw_symbol_dataset"),
    (RAW_PAYLOADS, [("fetched_at", 1)], False, "raw_ttl"),
]

# TTL retention for raw payloads (30 days)
RAW_PAYLOAD_TTL_SECONDS = 30 * 24 * 3600


def index_models() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for coll, keys, unique, name in INDEX_SPECS:
        out.append({
            "collection": coll,
            "keys": keys,
            "unique": unique,
            "name": name,
        })
    return out
