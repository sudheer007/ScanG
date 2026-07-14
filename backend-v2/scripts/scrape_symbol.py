#!/usr/bin/env python3
"""Scrape one symbol from Investing.com into MongoDB."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingestion.catalog import DATASETS
from ingestion.db import close_clients
from ingestion.pipeline import scrape_symbol


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape Investing.com data for one symbol")
    parser.add_argument("symbol", help="Ticker symbol, e.g. AAPL or RELIANCE.NS")
    parser.add_argument("--market", choices=["US", "IN"], default=None)
    parser.add_argument(
        "--datasets",
        default=",".join(DATASETS),
        help=f"Comma-separated datasets (default: all). Options: {','.join(DATASETS)}",
    )
    parser.add_argument("--no-raw", action="store_true", help="Skip raw payload storage")
    args = parser.parse_args()

    datasets = [d.strip() for d in args.datasets.split(",") if d.strip()]
    result = scrape_symbol(
        args.symbol,
        market=args.market,
        datasets=datasets,
        save_raw=not args.no_raw,
    )
    print(json.dumps(result, indent=2, default=str))
    close_clients()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
