"""Parse portfolio holdings (symbol + quantity + avg price) from CSV/TSV text."""

from __future__ import annotations

import csv
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from watchlist_import import (
    MAX_SYMBOLS,
    SYMBOL_HEADERS,
    SYMBOL_RE,
    _detect_delimiter,
    _resolve_in_universe,
    find_symbol_column,
    normalize_header,
    normalize_symbol,
)

QTY_HEADERS = {
    "qty",
    "quantity",
    "shares",
    "units",
    "holdingqty",
    "netqty",
    "availableqty",
    "quantityavailable",
    "noofshares",
    "freefloatquantity",
    "filledqty",
    "netquantity",
}

AVG_HEADERS = {
    "avg",
    "average",
    "avgprice",
    "averageprice",
    "avgpurchaseprice",
    "avgcost",
    "averagecost",
    "buyavg",
    "averagebuyprice",
    "avgrate",
    "buyprice",
    "costprice",
    "purchaseprice",
    "wacc",
    "averagecostprice",
    "avgbuyprice",
}

INVESTED_HEADERS = {
    "invested",
    "investment",
    "investedamount",
    "totalinvestment",
    "totalcost",
    "costvalue",
    "buyvalue",
    "investmentvalue",
}


def parse_number(value: str) -> Optional[float]:
    """Parse a numeric cell (handles currency symbols and Indian/US commas)."""
    text = (value or "").strip()
    if not text or text in {"-", "—", "–", "NA", "N/A", "na", "n/a"}:
        return None
    neg = False
    if text.startswith("(") and text.endswith(")"):
        neg = True
        text = text[1:-1]
    text = re.sub(r"[₹$€£%\s]", "", text)
    text = text.replace(",", "")
    if not text or text in {".", "-", "+"}:
        return None
    try:
        num = float(text)
    except ValueError:
        return None
    return -num if neg else num


def _header_key(value: str) -> str:
    """Normalize headers for matching (drops punctuation like Avg. → avg)."""
    return re.sub(r"[^a-z0-9]", "", normalize_header(value))


def _find_column(headers: List[str], candidates: set) -> Optional[int]:
    normalized = [_header_key(h) for h in headers]
    for idx, name in enumerate(normalized):
        if name in candidates:
            return idx
    return None


def extract_raw_holdings(text: str) -> List[Dict[str, Any]]:
    """
    Extract ordered unique holdings from CSV/TSV text.
    Each holding: {raw, quantity, avg_price} — avg_price may be derived from invested/qty.
    """
    if not text or not text.strip():
        return []

    sample = text[:4096]
    delimiter = _detect_delimiter(sample)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [row for row in reader if any((cell or "").strip() for cell in row)]
    if not rows:
        return []

    first = rows[0]
    has_header = any(_header_key(cell) in SYMBOL_HEADERS or normalize_header(cell) in SYMBOL_HEADERS for cell in first)
    if not has_header:
        # Holdings require qty + avg columns; bare symbol lists are not enough
        return []

    data_rows = rows[1:]
    symbol_idx = find_symbol_column(first)
    qty_idx = _find_column(first, QTY_HEADERS)
    avg_idx = _find_column(first, AVG_HEADERS)
    invested_idx = _find_column(first, INVESTED_HEADERS)

    if qty_idx is None:
        return []

    seen = set()
    holdings: List[Dict[str, Any]] = []
    for row in data_rows:
        if symbol_idx >= len(row):
            continue
        raw = (row[symbol_idx] or "").strip()
        if not raw:
            continue
        key = raw.upper()
        if key in seen:
            continue

        qty = parse_number(row[qty_idx]) if qty_idx < len(row) else None
        if qty is None or qty <= 0:
            continue

        avg_price: Optional[float] = None
        if avg_idx is not None and avg_idx < len(row):
            avg_price = parse_number(row[avg_idx])
        if (avg_price is None or avg_price <= 0) and invested_idx is not None and invested_idx < len(row):
            invested = parse_number(row[invested_idx])
            if invested is not None and invested > 0 and qty > 0:
                avg_price = invested / qty

        if avg_price is None or avg_price <= 0:
            continue

        seen.add(key)
        holdings.append({"raw": raw, "quantity": qty, "avg_price": avg_price})
    return holdings


def resolve_holdings(
    raw_holdings: List[Dict[str, Any]],
    market: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate/resolve holdings. Skips invalid symbols with reasons."""
    truncated = False
    items = raw_holdings
    if len(items) > MAX_SYMBOLS:
        items = items[:MAX_SYMBOLS]
        truncated = True

    valid: List[Dict[str, Any]] = []
    invalid: List[Dict[str, str]] = []
    seen_valid = set()

    for entry in items:
        raw = entry.get("raw") or ""
        qty = entry.get("quantity")
        avg = entry.get("avg_price")
        if qty is None or float(qty) <= 0:
            invalid.append({"raw": raw or "?", "reason": "missing_quantity"})
            continue
        if avg is None or float(avg) <= 0:
            invalid.append({"raw": raw or "?", "reason": "missing_avg_price"})
            continue

        normalized = normalize_symbol(raw)
        if not normalized or not SYMBOL_RE.match(normalized):
            invalid.append({"raw": raw, "reason": "invalid_format"})
            continue
        resolved = _resolve_in_universe(normalized, market)
        if not resolved:
            invalid.append({"raw": raw, "reason": "not_in_universe"})
            continue
        canon, mkt = resolved
        if canon in seen_valid:
            continue
        seen_valid.add(canon)
        valid.append(
            {
                "symbol": canon,
                "market": mkt,
                "quantity": float(qty),
                "avg_price": float(avg),
            }
        )

    return {
        "parsed": len(raw_holdings),
        "truncated": truncated,
        "valid": valid,
        "invalid": invalid,
    }
