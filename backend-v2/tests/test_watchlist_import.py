"""Tests for portfolio CSV/TSV import into watchlist."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import server
from watchlist_import import extract_raw_symbols, resolve_symbols


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length):
        return self._items[:length] if length is not None else list(self._items)


@pytest.fixture
def client():
    return TestClient(server.app)


@pytest.fixture
def mock_verify_token():
    with patch("auth_service.verify_id_token") as mock:
        yield mock


@pytest.fixture
def mock_watchlist_db():
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    coll.insert_one = AsyncMock()
    coll.delete_one = AsyncMock(return_value=SimpleNamespace(deleted_count=1))
    coll.find = MagicMock(return_value=_FakeCursor([]))
    coll.bulk_write = AsyncMock(return_value=SimpleNamespace(upserted_count=0))
    with patch.object(server.db, "watchlist", coll):
        yield coll


def _auth_token():
    return {"uid": "user-abc", "email": "a@example.com"}


def _upload(client, content: bytes, filename: str = "portfolio.csv", headers=None, market=None):
    data = {"file": (filename, BytesIO(content), "text/csv")}
    if market is not None:
        # TestClient multipart: pass form fields alongside files
        return client.post(
            "/api/watchlist/import",
            headers=headers or {},
            files=data,
            data={"market": market},
        )
    return client.post(
        "/api/watchlist/import",
        headers=headers or {},
        files=data,
    )


class TestParseHelpers:
    def test_extract_csv_with_symbol_header(self):
        text = "Symbol,Quantity\nAAPL,10\nMSFT,5\n"
        assert extract_raw_symbols(text) == ["AAPL", "MSFT"]

    def test_extract_tsv_ticker_header(self):
        text = "Ticker\tQty\nGOOGL\t1\nNVDA\t2\n"
        assert extract_raw_symbols(text) == ["GOOGL", "NVDA"]

    def test_extract_no_header_first_column(self):
        text = "AAPL\nMSFT\n"
        assert extract_raw_symbols(text) == ["AAPL", "MSFT"]

    def test_resolve_valid_and_invalid(self):
        result = resolve_symbols(["AAPL", "NOTAREAL", "msft", "AAPL"])
        symbols = [v["symbol"] for v in result["valid"]]
        assert "AAPL" in symbols
        assert "MSFT" in symbols
        assert len(result["invalid"]) == 1
        assert result["invalid"][0]["reason"] == "not_in_universe"

    def test_resolve_india_symbol(self):
        result = resolve_symbols(["RELIANCE.NS", "RELIANCE"])
        assert any(v["symbol"] == "RELIANCE.NS" and v["market"] == "IN" for v in result["valid"])


class TestWatchlistImport:
    def test_import_requires_auth(self, client):
        r = _upload(client, b"Symbol\nAAPL\n")
        assert r.status_code == 401

    def test_import_mixed_rows(
        self, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_watchlist_db.find.return_value = _FakeCursor([])

        content = b"Symbol,Qty\nAAPL,10\nFAKEXYZ,1\nMSFT,2\n"
        r = _upload(
            client,
            content,
            headers={"Authorization": "Bearer good"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["summary"]["added"] == 2
        assert body["summary"]["invalid"] == 1
        assert body["summary"]["duplicates"] == 0
        assert {x["symbol"] for x in body["added"]} == {"AAPL", "MSFT"}
        assert body["invalid"][0]["raw"] == "FAKEXYZ"
        mock_watchlist_db.bulk_write.assert_awaited()
        ops = mock_watchlist_db.bulk_write.call_args[0][0]
        assert len(ops) == 2
        for op in ops:
            assert op._filter["user_id"] == "user-abc"

    def test_import_duplicates_skipped(
        self, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_watchlist_db.find.return_value = _FakeCursor([{"symbol": "AAPL"}])

        content = b"ticker\nAAPL\nMSFT\n"
        r = _upload(
            client,
            content,
            headers={"Authorization": "Bearer good"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["duplicates"] == 1
        assert body["summary"]["added"] == 1
        assert body["added"][0]["symbol"] == "MSFT"

    def test_import_empty_file(self, client, mock_verify_token, mock_watchlist_db):
        mock_verify_token.return_value = _auth_token()
        r = _upload(
            client,
            b"",
            headers={"Authorization": "Bearer good"},
        )
        assert r.status_code == 400
        assert "Empty" in r.json()["detail"]

    def test_import_unsupported_extension(
        self, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()
        r = _upload(
            client,
            b"AAPL",
            filename="portfolio.xlsx",
            headers={"Authorization": "Bearer good"},
        )
        assert r.status_code == 400
        assert "Unsupported file type" in r.json()["detail"]

    @patch("portfolio_document._extract_pdf_text_and_tables")
    def test_import_pdf_text(
        self, mock_pdf_text, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_watchlist_db.find.return_value = _FakeCursor([])
        mock_pdf_text.return_value = "Symbol\nAAPL\nMSFT\n"

        r = client.post(
            "/api/watchlist/import",
            headers={"Authorization": "Bearer good"},
            files={"file": ("portfolio.pdf", BytesIO(b"%PDF-1.4"), "application/pdf")},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 2
        assert body["summary"]["source"] == "pdf_text"
        assert {x["symbol"] for x in body["added"]} == {"AAPL", "MSFT"}

    @patch("portfolio_document._ocr_bytes_as_image")
    def test_import_image(
        self, mock_ocr, client, mock_verify_token, mock_watchlist_db
    ):
        mock_verify_token.return_value = _auth_token()
        mock_watchlist_db.find.return_value = _FakeCursor([])
        mock_ocr.return_value = "Symbol\nNVDA\n"

        r = client.post(
            "/api/watchlist/import",
            headers={"Authorization": "Bearer good"},
            files={"file": ("holdings.png", BytesIO(b"\x89PNG"), "image/png")},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 1
        assert body["summary"]["source"] == "image_ocr"
        assert body["added"][0]["symbol"] == "NVDA"
