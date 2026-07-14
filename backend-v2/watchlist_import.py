"""Parse portfolio CSV/TSV files and resolve symbols against the stock universe."""

from __future__ import annotations

import csv
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from stock_universe import get_universe

MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024  # 2 MB for plain text
MAX_PDF_PAGES = 10
MAX_SYMBOLS = 500

SUPPORTED_EXTENSIONS = (
    ".csv",
    ".tsv",
    ".txt",
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
)

SYMBOL_HEADERS = {
    "symbol",
    "ticker",
    "scrip",
    "code",
    "stock",
    "security",
    "tradingsymbol",
    "trading_symbol",
    "nsecode",
    "bsecode",
}

SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,31}$")

# Backward-compatible aliases for internal use
_SYMBOL_HEADERS = SYMBOL_HEADERS
_SYMBOL_RE = SYMBOL_RE


def normalize_header(value: str) -> str:
    return re.sub(r"[\s_\-]+", "", (value or "").strip().lower())


def _normalize_header(value: str) -> str:
    return normalize_header(value)


def normalize_symbol(raw: str) -> str:
    text = (raw or "").strip().strip('"').strip("'").upper()
    # Common share-class formats: BRK.B <-> BRK-B
    if re.match(r"^[A-Z]+\.[A-Z]$", text):
        text = text.replace(".", "-", 1)
    return text


def _normalize_symbol(raw: str) -> str:
    return normalize_symbol(raw)


def _detect_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        return dialect.delimiter
    except csv.Error:
        if "\t" in sample:
            return "\t"
        if ";" in sample and sample.count(";") >= sample.count(","):
            return ";"
        return ","


def find_symbol_column(headers: List[str]) -> int:
    normalized = [normalize_header(h) for h in headers]
    for idx, name in enumerate(normalized):
        if name in SYMBOL_HEADERS:
            return idx
    return 0


def _find_symbol_column(headers: List[str]) -> int:
    return find_symbol_column(headers)


def extract_raw_symbols(text: str) -> List[str]:
    """Extract ordered unique raw symbol strings from CSV/TSV text."""
    if not text or not text.strip():
        return []

    sample = text[:4096]
    delimiter = _detect_delimiter(sample)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [row for row in reader if any((cell or "").strip() for cell in row)]
    if not rows:
        return []

    first = rows[0]
    has_header = any(normalize_header(cell) in SYMBOL_HEADERS for cell in first)
    data_rows = rows[1:] if has_header else rows
    col_idx = find_symbol_column(first) if has_header else 0

    seen = set()
    symbols: List[str] = []
    for row in data_rows:
        if col_idx >= len(row):
            continue
        raw = (row[col_idx] or "").strip()
        if not raw:
            continue
        key = raw.upper()
        if key in seen:
            continue
        seen.add(key)
        symbols.append(raw)
    return symbols


def _resolve_in_universe(symbol: str, market_override: Optional[str]) -> Optional[Tuple[str, str]]:
    """Return (canonical_symbol, market) if found in universe, else None."""
    candidates = [symbol]
    if symbol.endswith(".NS"):
        candidates.append(symbol[:-3])
    elif "." not in symbol and "-" not in symbol:
        candidates.append(f"{symbol}.NS")
    # Share-class variants
    if "-" in symbol:
        candidates.append(symbol.replace("-", ".", 1))
    if "." in symbol and not symbol.endswith(".NS"):
        candidates.append(symbol.replace(".", "-", 1))

    markets = [market_override.upper()] if market_override else ["US", "IN"]
    for market in markets:
        universe = set(get_universe(market))
        for cand in candidates:
            if cand in universe:
                return cand, market
    return None


def resolve_symbols(
    raw_symbols: List[str],
    market: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate and resolve symbols. Invalid rows are skipped with reasons."""
    truncated = False
    symbols = raw_symbols
    if len(symbols) > MAX_SYMBOLS:
        symbols = symbols[:MAX_SYMBOLS]
        truncated = True

    valid: List[Dict[str, str]] = []
    invalid: List[Dict[str, str]] = []
    seen_valid = set()

    for raw in symbols:
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
        valid.append({"symbol": canon, "market": mkt})

    return {
        "parsed": len(raw_symbols),
        "truncated": truncated,
        "valid": valid,
        "invalid": invalid,
    }
