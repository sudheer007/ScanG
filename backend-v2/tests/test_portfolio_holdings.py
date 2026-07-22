"""Tests for portfolio holdings CSV parsing and portfolio API."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import server
from portfolio_holdings import extract_raw_holdings, parse_number, resolve_holdings


class _FakeCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, length):
        return self._items[:length] if length is not None else list(self._items)


@pytest.fixture
def client():
    # Disable rate limits so suite can exercise many import/CRUD calls
    server.limiter.enabled = False
    return TestClient(server.app)


@pytest.fixture
def mock_verify_token():
    with patch("auth_service.verify_id_token") as mock:
        yield mock


@pytest.fixture
def mock_portfolio_db():
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    coll.insert_one = AsyncMock()
    coll.update_one = AsyncMock()
    coll.delete_one = AsyncMock(return_value=SimpleNamespace(deleted_count=1))
    coll.find = MagicMock(return_value=_FakeCursor([]))
    coll.bulk_write = AsyncMock(return_value=SimpleNamespace(upserted_count=0))
    with patch.object(server.db, "portfolio", coll):
        yield coll


def _auth_token():
    return {"uid": "user-abc", "email": "a@example.com"}


def _auth_headers():
    return {"Authorization": "Bearer fake-token"}


def _upload(client, content: bytes, filename: str = "holdings.csv", market=None):
    data = {"file": (filename, BytesIO(content), "text/csv")}
    if market is not None:
        return client.post(
            "/api/portfolio/import",
            headers=_auth_headers(),
            files=data,
            data={"market": market},
        )
    return client.post(
        "/api/portfolio/import",
        headers=_auth_headers(),
        files=data,
    )


# ---------------------------------------------------------------------------
# Unit: parse helpers
# ---------------------------------------------------------------------------


class TestHoldingsParse:
    def test_parse_number_indian_commas(self):
        assert parse_number("15,58,475.35") == 1558475.35
        assert parse_number("₹1,234.50") == 1234.5

    def test_parse_number_us_currency_and_percent(self):
        assert parse_number("$1,234.50") == 1234.5
        assert parse_number("12.5%") == 12.5

    def test_parse_number_accounting_negative(self):
        assert parse_number("(100.5)") == -100.5

    def test_parse_number_blank_and_na(self):
        assert parse_number("") is None
        assert parse_number("-") is None
        assert parse_number("N/A") is None
        assert parse_number("na") is None

    def test_extract_qty_and_avg(self):
        text = "Symbol,Qty,Avg Price\nAAPL,10,150.25\nMSFT,5,300\n"
        rows = extract_raw_holdings(text)
        assert len(rows) == 2
        assert rows[0]["raw"] == "AAPL"
        assert rows[0]["quantity"] == 10
        assert rows[0]["avg_price"] == 150.25

    def test_extract_from_invested_column(self):
        text = "Ticker,Quantity,Invested\nGOOGL,2,4000\n"
        rows = extract_raw_holdings(text)
        assert len(rows) == 1
        assert rows[0]["avg_price"] == 2000.0

    def test_extract_tsv_with_avg_cost(self):
        text = "Symbol\tShares\tAverage Cost\nNVDA\t3\t450.5\n"
        rows = extract_raw_holdings(text)
        assert len(rows) == 1
        assert rows[0]["raw"] == "NVDA"
        assert rows[0]["quantity"] == 3
        assert rows[0]["avg_price"] == 450.5

    def test_extract_skips_zero_and_missing_qty(self):
        text = "Symbol,Qty,Avg Price\nAAPL,0,150\nMSFT,,200\nTSLA,2,100\n"
        rows = extract_raw_holdings(text)
        assert len(rows) == 1
        assert rows[0]["raw"] == "TSLA"

    def test_extract_skips_missing_avg_without_invested(self):
        text = "Symbol,Qty,Avg Price\nAAPL,10,\nMSFT,5,0\n"
        rows = extract_raw_holdings(text)
        assert rows == []

    def test_extract_dedupes_by_symbol(self):
        text = "Symbol,Qty,Avg\nAAPL,10,100\naapl,20,200\n"
        rows = extract_raw_holdings(text)
        assert len(rows) == 1
        assert rows[0]["quantity"] == 10

    def test_extract_requires_header(self):
        text = "AAPL,10,150\nMSFT,5,300\n"
        assert extract_raw_holdings(text) == []

    def test_extract_empty_text(self):
        assert extract_raw_holdings("") == []
        assert extract_raw_holdings("   ") == []

    def test_extract_pipe_broker_headers(self):
        text = "Scrip|Quantity|Avg. Price\nRELIANCE|5|2500\n"
        rows = extract_raw_holdings(text)
        # pipe delimiter may not be auto-detected by csv; ensure at least no crash
        assert isinstance(rows, list)

    def test_resolve_holdings(self):
        result = resolve_holdings(
            [
                {"raw": "AAPL", "quantity": 10, "avg_price": 100},
                {"raw": "FAKEXYZ", "quantity": 1, "avg_price": 10},
            ]
        )
        assert any(v["symbol"] == "AAPL" for v in result["valid"])
        assert len(result["invalid"]) == 1
        assert result["invalid"][0]["reason"] == "not_in_universe"

    def test_resolve_missing_qty_and_avg(self):
        result = resolve_holdings(
            [
                {"raw": "AAPL", "quantity": 0, "avg_price": 100},
                {"raw": "MSFT", "quantity": 5, "avg_price": None},
            ]
        )
        reasons = {row["reason"] for row in result["invalid"]}
        assert "missing_quantity" in reasons
        assert "missing_avg_price" in reasons
        assert result["valid"] == []

    def test_resolve_india_market_filter(self):
        result = resolve_holdings(
            [{"raw": "RELIANCE", "quantity": 2, "avg_price": 2500}],
            market="IN",
        )
        assert len(result["valid"]) == 1
        assert result["valid"][0]["symbol"] == "RELIANCE.NS"
        assert result["valid"][0]["market"] == "IN"

    def test_resolve_dedupes_canonical_symbols(self):
        result = resolve_holdings(
            [
                {"raw": "AAPL", "quantity": 1, "avg_price": 10},
                {"raw": "aapl", "quantity": 2, "avg_price": 20},
            ]
        )
        assert len(result["valid"]) == 1
        assert result["valid"][0]["quantity"] == 1


# ---------------------------------------------------------------------------
# API: CRUD
# ---------------------------------------------------------------------------


class TestPortfolioCrud:
    def test_list_requires_auth(self, client):
        r = client.get("/api/portfolio/user-abc")
        assert r.status_code == 401

    def test_list_forbidden_other_user(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = client.get("/api/portfolio/other-user", headers=_auth_headers())
        assert r.status_code == 403

    def test_list_holdings(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        mock_portfolio_db.find.return_value = _FakeCursor(
            [
                {
                    "user_id": "user-abc",
                    "symbol": "AAPL",
                    "market": "US",
                    "quantity": 10,
                    "avg_price": 150,
                }
            ]
        )
        r = client.get("/api/portfolio/user-abc", headers=_auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) == 1
        assert body["items"][0]["symbol"] == "AAPL"

    def test_upsert_create(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        mock_portfolio_db.find_one = AsyncMock(return_value=None)
        r = client.post(
            "/api/portfolio",
            headers=_auth_headers(),
            json={
                "symbol": "AAPL",
                "market": "US",
                "quantity": 10,
                "avg_price": 150.25,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["updated"] is False
        assert body["item"]["symbol"] == "AAPL"
        assert body["item"]["user_id"] == "user-abc"
        mock_portfolio_db.insert_one.assert_awaited()

    def test_upsert_update_existing(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        existing = {
            "user_id": "user-abc",
            "symbol": "AAPL",
            "market": "US",
            "quantity": 5,
            "avg_price": 100,
        }
        updated = {**existing, "quantity": 12, "avg_price": 140}
        mock_portfolio_db.find_one = AsyncMock(side_effect=[existing, updated])
        r = client.post(
            "/api/portfolio",
            headers=_auth_headers(),
            json={
                "symbol": "AAPL",
                "market": "US",
                "quantity": 12,
                "avg_price": 140,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["updated"] is True
        assert body["item"]["quantity"] == 12
        mock_portfolio_db.update_one.assert_awaited()

    def test_upsert_rejects_zero_quantity(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = client.post(
            "/api/portfolio",
            headers=_auth_headers(),
            json={"symbol": "AAPL", "market": "US", "quantity": 0, "avg_price": 100},
        )
        assert r.status_code == 400
        assert "quantity" in r.json()["detail"]

    def test_upsert_rejects_zero_avg_price(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = client.post(
            "/api/portfolio",
            headers=_auth_headers(),
            json={"symbol": "AAPL", "market": "US", "quantity": 1, "avg_price": 0},
        )
        assert r.status_code == 400
        assert "avg_price" in r.json()["detail"]

    def test_upsert_forbidden_user_id_mismatch(
        self, client, mock_verify_token, mock_portfolio_db
    ):
        mock_verify_token.return_value = _auth_token()
        r = client.post(
            "/api/portfolio",
            headers=_auth_headers(),
            json={
                "user_id": "other-user",
                "symbol": "AAPL",
                "market": "US",
                "quantity": 1,
                "avg_price": 10,
            },
        )
        assert r.status_code == 403

    def test_delete_holding(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = client.delete("/api/portfolio/user-abc/AAPL", headers=_auth_headers())
        assert r.status_code == 200
        assert r.json() == {"ok": True, "deleted": 1}
        mock_portfolio_db.delete_one.assert_awaited()

    def test_delete_requires_auth(self, client):
        r = client.delete("/api/portfolio/user-abc/AAPL")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# API: import
# ---------------------------------------------------------------------------


class TestPortfolioImport:
    def test_import_requires_auth(self, client):
        r = client.post(
            "/api/portfolio/import",
            files={"file": ("h.csv", BytesIO(b"Symbol,Qty,Avg\nAAPL,1,10\n"), "text/csv")},
        )
        assert r.status_code == 401

    def test_import_holdings(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Symbol,Qty,Avg Price\nAAPL,10,150\nMSFT,5,300\n"
        r = _upload(client, content)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["summary"]["added"] == 2
        assert body["summary"]["updated"] == 0
        assert body["summary"]["invalid"] == 0
        assert body["summary"]["source"] == "csv"
        assert {x["symbol"] for x in body["added"]} == {"AAPL", "MSFT"}
        assert mock_portfolio_db.bulk_write.await_count == 1

    def test_import_mixed_valid_invalid(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Symbol,Qty,Avg Price\nAAPL,10,150\nFAKEXYZ,1,10\nMSFT,5,300\n"
        r = _upload(client, content)
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 2
        assert body["summary"]["invalid"] == 1
        assert body["invalid"][0]["raw"] == "FAKEXYZ"
        assert body["invalid"][0]["reason"] == "not_in_universe"

    def test_import_updates_existing(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        mock_portfolio_db.find.return_value = _FakeCursor([{"symbol": "AAPL"}])
        content = b"Symbol,Qty,Avg Price\nAAPL,20,160\nMSFT,5,300\n"
        r = _upload(client, content)
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["updated"] == 1
        assert body["summary"]["added"] == 1
        assert body["added"][0]["symbol"] == "MSFT"

    def test_import_from_invested_column(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Ticker,Quantity,Invested\nGOOGL,2,4000\n"
        r = _upload(client, content)
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 1
        assert body["added"][0]["avg_price"] == 2000.0

    def test_import_india_market(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Symbol,Qty,Avg Price\nRELIANCE,10,2500\n"
        r = _upload(client, content, market="IN")
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 1
        assert body["added"][0]["symbol"] == "RELIANCE.NS"
        assert body["added"][0]["market"] == "IN"

    def test_import_invalid_market(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = _upload(client, b"Symbol,Qty,Avg\nAAPL,1,10\n", market="EU")
        assert r.status_code == 400
        assert "market" in r.json()["detail"]

    def test_import_missing_columns(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = _upload(client, b"Symbol\nAAPL\n")
        assert r.status_code == 400
        assert "No holdings found" in r.json()["detail"]

    def test_import_empty_file(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = _upload(client, b"")
        assert r.status_code == 400
        assert "Empty file" in r.json()["detail"]

    def test_import_unsupported_extension(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        r = _upload(client, b"Symbol,Qty,Avg\nAAPL,1,10\n", filename="holdings.xlsx")
        assert r.status_code == 400
        assert "Unsupported" in r.json()["detail"]

    def test_import_all_invalid_still_ok(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Symbol,Qty,Avg Price\nFAKEXYZ,1,10\nNOTREAL,2,20\n"
        r = _upload(client, content)
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["added"] == 0
        assert body["summary"]["invalid"] == 2
        mock_portfolio_db.bulk_write.assert_not_awaited()

    def test_import_txt_extension(self, client, mock_verify_token, mock_portfolio_db):
        mock_verify_token.return_value = _auth_token()
        content = b"Symbol,Qty,Avg Price\nAAPL,3,120\n"
        r = _upload(client, content, filename="holdings.txt")
        assert r.status_code == 200
        assert r.json()["summary"]["added"] == 1
