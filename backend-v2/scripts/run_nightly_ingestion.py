#!/usr/bin/env python3
"""Nightly Investing.com batch ingestion (cron / Task Scheduler entrypoint)."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingestion.batch import ALL_PARTITIONS, run_nightly
from ingestion.catalog import DATASETS
from ingestion.db import close_clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run nightly Investing.com ingestion batches")
    parser.add_argument(
        "--partitions",
        default=",".join(ALL_PARTITIONS),
        help=f"Comma-separated partitions (default: {','.join(ALL_PARTITIONS)})",
    )
    parser.add_argument(
        "--datasets",
        default=",".join(DATASETS),
        help=f"Comma-separated datasets (default: all)",
    )
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--inter-batch-delay", type=float, default=2.0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Plan batches without scraping")
    args = parser.parse_args()

    partitions = [p.strip() for p in args.partitions.split(",") if p.strip()]
    datasets = [d.strip() for d in args.datasets.split(",") if d.strip()]

    result = run_nightly(
        partitions=partitions,
        datasets=datasets,
        batch_size=args.batch_size,
        inter_batch_delay_s=args.inter_batch_delay,
        dry_run=args.dry_run,
        offset=args.offset,
        limit=args.limit,
    )
    print(json.dumps(result, indent=2, default=str))
    close_clients()
    return 0 if result.get("status") in ("completed", "dry_run") else 1


if __name__ == "__main__":
    raise SystemExit(main())
