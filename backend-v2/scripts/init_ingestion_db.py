#!/usr/bin/env python3
"""Initialize MongoDB indexes for ingestion collections."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingestion.db import close_clients, ensure_indexes, get_sync_db


def main() -> int:
    db = get_sync_db()
    result = ensure_indexes(db)
    print(json.dumps(result, indent=2))
    close_clients()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
