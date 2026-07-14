"""Extract portfolio symbols from CSV, PDF, and image uploads (no cloud AI)."""

from __future__ import annotations

import io
import os
import re
import shutil
from pathlib import Path
from typing import List, Optional, Set, Tuple

import pdfplumber
import fitz  # pymupdf
import pytesseract
from PIL import Image, ImageOps

from stock_universe import get_universe
from watchlist_import import (
    MAX_PDF_PAGES,
    SYMBOL_HEADERS,
    SYMBOL_RE,
    extract_raw_symbols,
    find_symbol_column,
    normalize_header,
    normalize_symbol,
)

TEXT_EXTENSIONS = {".csv", ".tsv", ".txt"}
PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

PDF_TEXT_MIN_SYMBOLS = 2
_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9.&-]{0,31}\b")

_WINDOWS_TESSERACT_CANDIDATES = (
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
)
_tesseract_configured = False


def _configure_tesseract() -> None:
    global _tesseract_configured
    if _tesseract_configured:
        return

    env_cmd = (os.environ.get("TESSERACT_CMD") or "").strip()
    if env_cmd and Path(env_cmd).is_file():
        pytesseract.pytesseract.tesseract_cmd = env_cmd
        _tesseract_configured = True
        return

    which = shutil.which("tesseract")
    if which:
        pytesseract.pytesseract.tesseract_cmd = which
        _tesseract_configured = True
        return

    for candidate in _WINDOWS_TESSERACT_CANDIDATES:
        if candidate.is_file():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
            _tesseract_configured = True
            return

    _tesseract_configured = True


class OcrUnavailableError(Exception):
    """Raised when the Tesseract binary is not installed or not on PATH."""


class UnsupportedPortfolioFileError(Exception):
    """Raised when the upload type is not supported."""


def is_supported_extension(filename: str) -> bool:
    lower = (filename or "").lower()
    return any(lower.endswith(ext) for ext in TEXT_EXTENSIONS | PDF_EXTENSIONS | IMAGE_EXTENSIONS)


def max_bytes_for_filename(filename: str) -> int:
    from watchlist_import import MAX_FILE_BYTES, MAX_TEXT_FILE_BYTES

    lower = (filename or "").lower()
    if any(lower.endswith(ext) for ext in TEXT_EXTENSIONS):
        return MAX_TEXT_FILE_BYTES
    return MAX_FILE_BYTES


def _build_universe_set(market: Optional[str]) -> Set[str]:
    if market:
        return set(get_universe(market.upper()))
    us = set(get_universe("US"))
    india = set(get_universe("IN"))
    return us | india


def _symbol_in_universe(token: str, universe: Set[str]) -> bool:
    normalized = normalize_symbol(token)
    if not normalized or not SYMBOL_RE.match(normalized):
        return False
    candidates = [normalized]
    if normalized.endswith(".NS"):
        candidates.append(normalized[:-3])
    elif "." not in normalized and "-" not in normalized:
        candidates.append(f"{normalized}.NS")
    if "-" in normalized:
        candidates.append(normalized.replace("-", ".", 1))
    if "." in normalized and not normalized.endswith(".NS"):
        candidates.append(normalized.replace(".", "-", 1))
    return any(c in universe for c in candidates)


def _append_unique(symbols: List[str], seen: Set[str], raw: str) -> None:
    key = raw.strip().upper()
    if not key or key in seen:
        return
    seen.add(key)
    symbols.append(raw.strip())


def _looks_like_symbol_token(raw: str) -> bool:
    normalized = normalize_symbol(raw)
    return bool(normalized and SYMBOL_RE.match(normalized))


def _extract_from_header_column(text: str) -> List[str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    symbols: List[str] = []
    seen: Set[str] = set()

    for i, line in enumerate(lines):
        parts = re.split(r"\s*[|,\t;]\s*", line)
        if not parts:
            continue
        headers = [normalize_header(p) for p in parts]
        if not any(h in SYMBOL_HEADERS for h in headers):
            continue
        col_idx = find_symbol_column(parts)
        for row_line in lines[i + 1 :]:
            row_parts = re.split(r"\s*[|,\t;]\s*", row_line)
            if col_idx >= len(row_parts):
                continue
            raw = (row_parts[col_idx] or "").strip()
            if raw:
                _append_unique(symbols, seen, raw)
    return symbols


def _extract_regex_universe_filtered(text: str, universe: Set[str]) -> List[str]:
    symbols: List[str] = []
    seen: Set[str] = set()
    upper_text = text.upper()
    for match in _TOKEN_RE.finditer(upper_text):
        token = match.group(0)
        if _symbol_in_universe(token, universe):
            _append_unique(symbols, seen, token)
    return symbols


def extract_symbols_from_text(text: str, market: Optional[str] = None) -> List[str]:
    """Extract ticker symbols from unstructured or tabular text."""
    if not text or not text.strip():
        return []

    universe = _build_universe_set(market)
    seen: Set[str] = set()
    merged: List[str] = []

    for raw in extract_raw_symbols(text):
        if _looks_like_symbol_token(raw):
            _append_unique(merged, seen, raw)

    if len(merged) < PDF_TEXT_MIN_SYMBOLS:
        for raw in _extract_from_header_column(text):
            _append_unique(merged, seen, raw)

    if len(merged) < PDF_TEXT_MIN_SYMBOLS:
        for raw in _extract_regex_universe_filtered(text, universe):
            _append_unique(merged, seen, raw)

    return merged


def _decode_text_bytes(raw_bytes: bytes) -> str:
    try:
        return raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw_bytes.decode("latin-1")


def _ocr_image(image: Image.Image) -> str:
    _configure_tesseract()
    try:
        prepared = ImageOps.grayscale(image)
        prepared = ImageOps.autocontrast(prepared)
        return pytesseract.image_to_string(prepared)
    except pytesseract.TesseractNotFoundError as exc:
        raise OcrUnavailableError("OCR is not available on the server") from exc


def _ocr_bytes_as_image(raw_bytes: bytes) -> str:
    image = Image.open(io.BytesIO(raw_bytes))
    return _ocr_image(image)


def _extract_pdf_text_and_tables(raw_bytes: bytes) -> str:
    chunks: List[str] = []
    with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
        for page in pdf.pages[:MAX_PDF_PAGES]:
            page_text = page.extract_text() or ""
            if page_text.strip():
                chunks.append(page_text)
            tables = page.extract_tables() or []
            for table in tables:
                for row in table:
                    if not row:
                        continue
                    cells = [str(c or "").strip() for c in row]
                    if any(cells):
                        chunks.append("\t".join(cells))
    return "\n".join(chunks)


def _extract_pdf_via_ocr(raw_bytes: bytes) -> str:
    chunks: List[str] = []
    doc = fitz.open(stream=raw_bytes, filetype="pdf")
    try:
        page_count = min(len(doc), MAX_PDF_PAGES)
        for idx in range(page_count):
            page = doc.load_page(idx)
            pix = page.get_pixmap(dpi=200)
            image = Image.open(io.BytesIO(pix.tobytes("png")))
            chunks.append(_ocr_image(image))
    finally:
        doc.close()
    return "\n".join(chunks)


def _extract_from_pdf(raw_bytes: bytes, market: Optional[str]) -> Tuple[List[str], str]:
    text = _extract_pdf_text_and_tables(raw_bytes)
    symbols = extract_symbols_from_text(text, market=market)
    if len(symbols) >= PDF_TEXT_MIN_SYMBOLS:
        return symbols, "pdf_text"

    ocr_text = _extract_pdf_via_ocr(raw_bytes)
    combined = f"{text}\n{ocr_text}".strip()
    return extract_symbols_from_text(combined, market=market), "pdf_ocr"


def _extract_from_image(raw_bytes: bytes, market: Optional[str]) -> Tuple[List[str], str]:
    text = _ocr_bytes_as_image(raw_bytes)
    return extract_symbols_from_text(text, market=market), "image_ocr"


def _classify_file(filename: str, content_type: Optional[str]) -> str:
    lower = (filename or "").lower()
    mime = (content_type or "").lower()

    if any(lower.endswith(ext) for ext in TEXT_EXTENSIONS):
        return "text"
    if any(lower.endswith(ext) for ext in PDF_EXTENSIONS) or mime == "application/pdf":
        return "pdf"
    if any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS) or mime.startswith("image/"):
        return "image"
    raise UnsupportedPortfolioFileError(
        "Unsupported file type. Upload CSV, TSV, TXT, PDF, or an image (JPEG/PNG/WebP)."
    )


def extract_raw_symbols_from_upload(
    raw_bytes: bytes,
    filename: str,
    content_type: Optional[str] = None,
    market: Optional[str] = None,
) -> Tuple[List[str], str]:
    """
    Route upload bytes to the appropriate extractor.
    Returns (symbols, source) where source is csv | pdf_text | pdf_ocr | image_ocr.
    """
    kind = _classify_file(filename, content_type)

    if kind == "text":
        text = _decode_text_bytes(raw_bytes)
        return extract_raw_symbols(text), "csv"

    if kind == "pdf":
        return _extract_from_pdf(raw_bytes, market)

    if kind == "image":
        return _extract_from_image(raw_bytes, market)

    raise UnsupportedPortfolioFileError(
        "Unsupported file type. Upload CSV, TSV, TXT, PDF, or an image (JPEG/PNG/WebP)."
    )
