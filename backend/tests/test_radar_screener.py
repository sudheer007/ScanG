"""Backend test suite for Radar Stock Screener.
Covers: health, markets overview (US/IN), stock detail, history,
batch quotes, radar strategies + scans, custom screener, search.
"""
import pytest

TIMEOUT = 90  # universe scans can be slow on cold cache


# ---------- Health ----------
def test_health(api_client, base_url):
    r = api_client.get(f"{base_url}/api/health", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "ts" in body


# ---------- Markets ----------
class TestMarkets:
    def test_overview_us(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/markets/overview", params={"market": "US"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["market"] == "US"
        assert body["currency"] == "USD"
        assert isinstance(body["indices"], list) and len(body["indices"]) >= 3
        idx_symbols = [i["symbol"] for i in body["indices"]]
        # Expect S&P/NASDAQ/Dow
        assert "^GSPC" in idx_symbols or "^IXIC" in idx_symbols or "^DJI" in idx_symbols
        for idx in body["indices"]:
            assert "name" in idx and "price" in idx and "change_pct" in idx and "sparkline" in idx
        assert isinstance(body["gainers"], list) and len(body["gainers"]) > 0
        assert isinstance(body["losers"], list) and len(body["losers"]) > 0
        # Gainers should be sorted desc by change_pct
        g = [x["change_pct"] for x in body["gainers"] if x.get("change_pct") is not None]
        assert g == sorted(g, reverse=True)
        sample = body["gainers"][0]
        for k in ("symbol", "name", "price", "change_pct", "sparkline"):
            assert k in sample, f"missing {k} in mover row"

    def test_overview_in(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/markets/overview", params={"market": "IN"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["market"] == "IN"
        assert body["currency"] == "INR"
        assert len(body["indices"]) >= 2
        idx_symbols = [i["symbol"] for i in body["indices"]]
        assert "^NSEI" in idx_symbols or "^BSESN" in idx_symbols
        # Movers must use NSE suffix
        assert any(s["symbol"].endswith(".NS") for s in body["gainers"])


# ---------- Radar ----------
class TestRadar:
    def test_strategies_list(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/radar/strategies", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "strategies" in body
        strats = body["strategies"]
        assert len(strats) == 8, f"expected 8 strategies, got {len(strats)}"
        for s in strats:
            assert {"key", "title", "subtitle", "icon"} <= set(s.keys())

    def test_value_picks_us(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/radar/value_picks", params={"market": "US"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["strategy"] == "value_picks"
        assert body["market"] == "US"
        assert isinstance(body["stocks"], list)
        # Validate filter rule was applied: pe<22, pb<4, roe>=10
        for s in body["stocks"][:10]:
            for k in ("pe", "pb", "roe", "market_cap"):
                assert k in s
            assert (s.get("pe") or 999) < 22
            assert (s.get("roe") or 0) >= 10

    def test_momentum_breakouts_us(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/radar/momentum_breakouts", params={"market": "US"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["strategy"] == "momentum_breakouts"
        for s in body["stocks"][:5]:
            assert 55 <= (s.get("rsi") or 0) <= 75
            assert (s.get("volume_surge") or 0) >= 1.2

    def test_unknown_strategy_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/radar/this_does_not_exist", timeout=20)
        assert r.status_code == 404


# ---------- Stocks ----------
class TestStocks:
    def test_stock_detail_aapl(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/AAPL", timeout=45)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in ("name", "price", "change_pct", "market_cap", "pe", "pb",
                  "roe", "rsi", "macd", "ma50", "ma200", "sparkline"):
            assert k in b, f"missing {k}"
        assert b["symbol"] == "AAPL"
        assert b["currency"] == "USD"
        assert isinstance(b["sparkline"], list) and len(b["sparkline"]) > 0
        assert b["price"] and b["price"] > 0

    def test_stock_detail_indian(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/RELIANCE.NS", timeout=45)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["symbol"] == "RELIANCE.NS"
        assert b["currency"] == "INR"
        assert b["price"] and b["price"] > 0

    def test_stock_history(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/AAPL/history",
                           params={"period": "1mo", "interval": "1d"}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["symbol"] == "AAPL"
        assert isinstance(b["points"], list) and len(b["points"]) >= 10
        pt = b["points"][0]
        for k in ("t", "o", "h", "l", "c", "v"):
            assert k in pt

    def test_stock_history_invalid_period(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/AAPL/history",
                           params={"period": "INVALID", "interval": "1d"}, timeout=15)
        assert r.status_code == 400

    def test_batch_quotes(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/batch/quotes",
                           params={"symbols": "AAPL,MSFT"}, timeout=45)
        assert r.status_code == 200, r.text
        b = r.json()
        assert isinstance(b["quotes"], list)
        # Both should resolve
        syms = [q["symbol"] for q in b["quotes"]]
        assert "AAPL" in syms and "MSFT" in syms
        for q in b["quotes"]:
            assert q.get("price") and q["price"] > 0

    def test_stock_not_found(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stocks/ZZZZZZZZNONE", timeout=30)
        assert r.status_code == 404


# ---------- Custom Screener ----------
class TestScreener:
    def test_custom_pe_roe(self, api_client, base_url):
        payload = {
            "market": "US",
            "filters": {"pe": {"max": 25}, "roe": {"min": 15}},
            "sort_by": "roe",
            "sort_desc": True,
            "limit": 20,
        }
        r = api_client.post(f"{base_url}/api/screener/custom", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["market"] == "US"
        assert isinstance(b["stocks"], list)
        assert len(b["stocks"]) <= 20
        roes = []
        for s in b["stocks"]:
            assert s.get("pe") is not None and s["pe"] <= 25
            assert s.get("roe") is not None and s["roe"] >= 15
            roes.append(s["roe"])
        # Sorted desc by roe
        assert roes == sorted(roes, reverse=True)


# ---------- Search ----------
class TestSearch:
    def test_search_apple(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/search", params={"q": "apple"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["query"] == "apple"
        assert isinstance(b["results"], list)
        symbols = [x["symbol"] for x in b["results"]]
        assert "AAPL" in symbols, f"AAPL not in results: {symbols}"

    def test_search_empty(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/search", params={"q": ""}, timeout=15)
        # min_length=1 -> 422
        assert r.status_code == 422
