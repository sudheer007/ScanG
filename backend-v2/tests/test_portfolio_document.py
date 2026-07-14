"""Tests for portfolio PDF/image symbol extraction."""

from __future__ import annotations

import io
from unittest.mock import patch

import fitz
import pytest

from portfolio_document import (
    OcrUnavailableError,
    UnsupportedPortfolioFileError,
    extract_raw_symbols_from_upload,
    extract_symbols_from_text,
)


def _make_text_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestExtractSymbolsFromText:
    def test_csv_like_text(self):
        text = "Symbol,Quantity\nAAPL,10\nMSFT,5\n"
        assert extract_raw_symbols_from_upload(text.encode(), "holdings.csv", "text/csv")[0] == [
            "AAPL",
            "MSFT",
        ]

    def test_header_column_in_plain_text(self):
        text = "Symbol | Qty\nAAPL | 10\nNVDA | 2\n"
        symbols = extract_symbols_from_text(text)
        assert "AAPL" in symbols
        assert "NVDA" in symbols

    def test_universe_filter_removes_noise(self):
        text = "TOTAL QTY DATE AAPL FAKEXYZ MSFT"
        symbols = extract_symbols_from_text(text)
        assert "AAPL" in symbols
        assert "MSFT" in symbols
        assert "TOTAL" not in symbols
        assert "FAKEXYZ" not in symbols

    def test_india_symbol_in_text(self):
        text = "Scrip\nRELIANCE.NS\nTCS.NS\n"
        symbols = extract_symbols_from_text(text, market="IN")
        assert "RELIANCE.NS" in symbols
        assert "TCS.NS" in symbols


class TestPdfExtraction:
    def test_pdf_text_extraction(self):
        pdf_bytes = _make_text_pdf("Symbol\nAAPL\nMSFT\n")
        symbols, source = extract_raw_symbols_from_upload(
            pdf_bytes, "portfolio.pdf", "application/pdf"
        )
        assert source == "pdf_text"
        assert "AAPL" in symbols
        assert "MSFT" in symbols

    @patch("portfolio_document._extract_pdf_via_ocr")
    @patch("portfolio_document._extract_pdf_text_and_tables")
    def test_pdf_falls_back_to_ocr(self, mock_text, mock_ocr):
        mock_text.return_value = "no tickers here"
        mock_ocr.return_value = "Symbol\nGOOGL\nNVDA\n"
        symbols, source = extract_raw_symbols_from_upload(
            b"%PDF-fake", "scan.pdf", "application/pdf"
        )
        assert source == "pdf_ocr"
        assert "GOOGL" in symbols
        assert "NVDA" in symbols


class TestImageExtraction:
    @patch("portfolio_document._ocr_bytes_as_image")
    def test_image_ocr_path(self, mock_ocr):
        mock_ocr.return_value = "Ticker\nAAPL\n"
        symbols, source = extract_raw_symbols_from_upload(
            b"\x89PNG\r\n", "shot.png", "image/png"
        )
        assert source == "image_ocr"
        assert symbols == ["AAPL"]

    @patch("portfolio_document._ocr_bytes_as_image")
    def test_ocr_unavailable_raises(self, mock_ocr):
        mock_ocr.side_effect = OcrUnavailableError("OCR is not available on the server")
        with pytest.raises(OcrUnavailableError, match="OCR is not available"):
            extract_raw_symbols_from_upload(b"fake", "shot.png", "image/png")


class TestFileRouting:
    def test_unsupported_extension(self):
        with pytest.raises(UnsupportedPortfolioFileError):
            extract_raw_symbols_from_upload(b"data", "file.xlsx", None)

    def test_txt_uses_csv_path(self):
        content = b"Symbol\nTSLA\n"
        symbols, source = extract_raw_symbols_from_upload(content, "list.txt", "text/plain")
        assert source == "csv"
        assert symbols == ["TSLA"]
