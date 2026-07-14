"""Unit tests for analyzer depth enhancements (offline, no Yahoo)."""
from __future__ import annotations

import pytest

from news_service import news_sentiment_summary, score_headline_sentiment
from sector_utils import (
    build_sector_context,
    infer_market,
    pick_peers,
    sector_benchmarks,
)
from analyzer_service import _build_trade_idea, _build_pros_cons, aggregate_sector_rotation
from discover_service import _ai_score, _rating_from_score


def _stock(symbol: str, sector: str, pe: float, mcap: float, **kw) -> dict:
    base = {
        "symbol": symbol,
        "name": symbol,
        "sector": sector,
        "pe": pe,
        "market_cap": mcap,
        "price": 100.0,
        "ma50": 98.0,
        "pb": 2.0,
        "roe": 15.0,
        "revenue_growth": 10.0,
        "change_pct": 1.0,
    }
    base.update(kw)
    return base


UNIVERSE = [
    _stock("AAA", "Tech", 20, 1e12),
    _stock("BBB", "Tech", 25, 900e9),
    _stock("CCC", "Tech", 30, 800e9),
    _stock("DDD", "Tech", 18, 700e9),
    _stock("EEE", "Tech", 22, 600e9),
    _stock("FFF", "Health", 15, 500e9),
]


class TestInferMarket:
    def test_us(self):
        assert infer_market("AAPL") == "US"

    def test_india(self):
        assert infer_market("RELIANCE.NS") == "IN"


class TestNewsSentiment:
    def test_bullish_headline(self):
        assert score_headline_sentiment("Company beats earnings, raises guidance") == "bullish"

    def test_bearish_headline(self):
        assert score_headline_sentiment("Stock falls after downgrade and profit miss") == "bearish"

    def test_neutral_headline(self):
        assert score_headline_sentiment("Company announces new product line") == "neutral"

    def test_summary_label(self):
        items = [
            {"title": "Earnings beat sends shares surging"},
            {"title": "Analyst upgrade to outperform"},
            {"title": "Record profit growth reported"},
        ]
        res = news_sentiment_summary(items)
        assert res["label"] == "Bullish"
        assert res["score"] > 0
        assert len(res["headlines"]) == 3


class TestSectorBenchmarks:
    def test_computes_sector_avg(self):
        bench = sector_benchmarks(UNIVERSE)
        assert "Tech" in bench
        assert bench["Tech"]["stock_count"] == 5
        assert bench["Tech"]["avg_pe"] == pytest.approx(23.0, abs=0.1)

    def test_health_sector_excluded_with_few_peers(self):
        bench = sector_benchmarks(UNIVERSE)
        assert "Health" not in bench  # only 1 stock, need >= 3 PE values


class TestPickPeers:
    def test_excludes_self(self):
        st = _stock("AAA", "Tech", 20, 1e12)
        peers = pick_peers(st, UNIVERSE, limit=6)
        symbols = [p["symbol"] for p in peers]
        assert "AAA" not in symbols
        assert len(peers) <= 5

    def test_similar_mcap_first(self):
        st = _stock("BBB", "Tech", 25, 900e9)
        peers = pick_peers(st, UNIVERSE, limit=3)
        assert peers[0]["symbol"] in ("AAA", "CCC")

    def test_enriched_peer_fields(self):
        enriched = [
            _stock("AAA", "Tech", 20, 1e12, rvol=1.5, roe=22.0, revenue_growth=12.0, price=150.0, currency="USD"),
            _stock("BBB", "Tech", 25, 900e9, volume_surge=1.3, roe=18.0),
            _stock("CCC", "Tech", 30, 800e9),
            _stock("DDD", "Tech", 18, 700e9),
            _stock("EEE", "Tech", 22, 600e9),
        ]
        st = _stock("TARGET", "Tech", 24, 850e9)
        peers = pick_peers(st, enriched, limit=3)
        assert len(peers) == 3
        aaa = next(p for p in peers if p["symbol"] == "AAA")
        assert aaa["volume_growth_pct"] == pytest.approx(50.0, abs=0.1)
        assert aaa["roe"] == pytest.approx(22.0)
        assert aaa["revenue_growth"] == pytest.approx(12.0)
        assert aaa["price"] == pytest.approx(150.0)
        bbb = next(p for p in peers if p["symbol"] == "BBB")
        assert bbb["volume_growth_pct"] == pytest.approx(30.0, abs=0.1)


class TestSectorContext:
    def test_builds_relative_pe(self):
        st = _stock("DDD", "Tech", 18, 700e9)
        bench = sector_benchmarks(UNIVERSE)
        ctx = build_sector_context(st, UNIVERSE, bench)
        assert ctx is not None
        assert ctx["valuation_tag"] == "Discount"
        assert ctx["vs_sector_pe_pct"] < 0

    def test_missing_sector_returns_none(self):
        st = _stock("ZZZ", "Unknown", 10, 1e9)
        bench = sector_benchmarks(UNIVERSE)
        assert build_sector_context(st, UNIVERSE, bench) is None


class TestHoldTradeIdea:
    def test_hold_generates_range_trade(self):
        st = _stock("HOLD", "Tech", 22, 500e9, rsi=55)
        score, breakdown = _ai_score(st)
        rating = _rating_from_score(score)
        # Force HOLD-like rating by using mid score stock; if not HOLD, set manually
        idea = _build_trade_idea(st, "HOLD", 100.0, 110.0)
        assert idea is not None
        assert idea["stance"] == "Wait / Range trade"
        assert idea["entry_zone"] is not None
        assert len(idea["targets"]) == 2


class TestProsConsEnrichment:
    def test_sector_discount_in_pros(self):
        st = _stock("DDD", "Tech", 18, 700e9)
        bench = sector_benchmarks(UNIVERSE)
        ctx = build_sector_context(st, UNIVERSE, bench)
        score, breakdown = _ai_score(st)
        news = news_sentiment_summary([{"title": "Earnings beat expectations"}])
        pros, cons = _build_pros_cons(st, breakdown, 10.0, ctx, news)
        assert any("sector avg" in p.lower() for p in pros) or any("P/E" in p for p in pros)


SECTOR_UNIVERSE = [
    _stock("AAPL", "Technology", 28, 3e12, change_pct=2.5, rvol=1.5),
    _stock("MSFT", "Technology", 35, 2.8e12, change_pct=1.0, rvol=1.0),
    _stock("NVDA", "Technology", 60, 2e12, change_pct=-0.5, volume_surge=1.4),
    _stock("JPM", "Financials", 12, 500e9, change_pct=0.8, rvol=0.8),
    _stock("BAC", "Financials", 10, 300e9, change_pct=-1.2, rvol=1.3),
]


class TestSectorRotationVolume:
    def test_volume_growth_and_breadth(self):
        res = aggregate_sector_rotation(SECTOR_UNIVERSE, "US")
        tech = next(s for s in res["sectors"] if s["sector"] == "Technology")
        # rvol growth: (1.5-1)*100=50, (1.0-1)*100=0, surge (1.4-1)*100=40 → avg 30.0
        assert tech["avg_volume_growth_pct"] == pytest.approx(30.0, abs=0.1)
        assert tech["high_volume_count"] == 2  # rvol 1.5 and surge 1.4
        assert tech["volume_breadth_pct"] == pytest.approx(66.7, abs=0.1)
        assert tech["top_gainer"] == "AAPL"
        assert tech["top_loser"] == "NVDA"

    def test_financials_sector(self):
        res = aggregate_sector_rotation(SECTOR_UNIVERSE, "US")
        fin = next(s for s in res["sectors"] if s["sector"] == "Financials")
        assert fin["avg_volume_growth_pct"] == pytest.approx(5.0, abs=0.1)  # (-20 + 30) / 2
        assert fin["high_volume_count"] == 1
        assert fin["top_gainer"] == "JPM"
        assert fin["top_loser"] == "BAC"

    def test_sorted_by_change(self):
        res = aggregate_sector_rotation(SECTOR_UNIVERSE, "US")
        changes = [s["avg_change_pct"] for s in res["sectors"]]
        assert changes == sorted(changes, reverse=True)
