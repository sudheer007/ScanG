"""Unit tests for market_intel_service pure compute functions.

No network, no live server — synthetic bundles and price series only. Run:
    cd backend && pytest tests/test_market_intel.py -v
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import market_intel_service as mi  # noqa: E402


def bundle(symbol="AAA", **kw):
    base = {
        "symbol": symbol, "name": symbol, "price": 100.0, "currency": "USD",
        "change_pct": 1.0, "sector": "Technology", "market_cap": 1e9,
        "sparkline": [], "rsi": 55.0, "ma50": 95.0, "ma200": 90.0,
        "from_52w_high_pct": -10.0, "from_52w_low_pct": 20.0, "volume": 1e6,
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Breadth & regime
# ---------------------------------------------------------------------------

class TestBreadth:
    def test_all_bullish_universe_is_risk_on(self):
        stocks = [bundle(f"S{i}", change_pct=2.0, from_52w_high_pct=-0.5) for i in range(20)]
        out = mi.compute_breadth(stocks)
        assert out["advancers"] == 20
        assert out["decliners"] == 0
        assert out["pct_above_ma50"] == 100.0
        assert out["new_52w_highs"] == 20
        assert out["composite"] >= 90
        assert out["regime"] == "Risk-On"

    def test_all_bearish_universe_is_risk_off(self):
        stocks = [
            bundle(f"S{i}", change_pct=-2.0, price=80.0, ma50=95.0, ma200=100.0,
                   from_52w_high_pct=-40.0, from_52w_low_pct=0.5, rsi=25.0)
            for i in range(20)
        ]
        out = mi.compute_breadth(stocks)
        assert out["advancers"] == 0
        assert out["decliners"] == 20
        assert out["new_52w_lows"] == 20
        assert out["oversold_count"] == 20
        assert out["composite"] <= 10
        assert out["regime"] == "Risk-Off"

    def test_mixed_universe_is_neutral(self):
        ups = [bundle(f"U{i}", change_pct=1.0) for i in range(10)]
        downs = [
            bundle(f"D{i}", change_pct=-1.0, price=80.0, ma50=95.0, ma200=100.0,
                   from_52w_high_pct=-30.0, from_52w_low_pct=25.0)
            for i in range(10)
        ]
        out = mi.compute_breadth(ups + downs)
        assert out["advancers"] == 10 and out["decliners"] == 10
        assert 40 <= out["composite"] <= 60
        assert out["regime"] == "Neutral"

    def test_empty_universe_is_unknown(self):
        out = mi.compute_breadth([])
        assert out["composite"] is None
        assert out["regime"] == "Unknown"

    def test_up_volume_share(self):
        stocks = [
            bundle("UP", change_pct=2.0, volume=3e6),
            bundle("DN", change_pct=-2.0, volume=1e6),
        ]
        out = mi.compute_breadth(stocks)
        assert out["up_volume_pct"] == 75.0


# ---------------------------------------------------------------------------
# Risk metrics
# ---------------------------------------------------------------------------

def geometric_series(start=100.0, daily=0.001, n=260, wobble=0.0):
    """Deterministic price path with optional alternating wobble."""
    out, p = [], start
    for i in range(n):
        r = daily + (wobble if i % 2 == 0 else -wobble)
        p *= (1 + r)
        out.append(p)
    return out


class TestRiskMetrics:
    def test_insufficient_history(self):
        out = mi.compute_risk_metrics([100, 101, 102])
        assert out["available"] is False

    def test_steady_uptrend_has_low_vol_and_no_drawdown(self):
        closes = geometric_series(daily=0.001, wobble=0.0)
        out = mi.compute_risk_metrics(closes)
        assert out["available"] is True
        assert out["annualized_volatility_pct"] < 1
        assert out["max_drawdown_pct"] == 0
        assert out["annualized_return_pct"] > 20
        assert out["risk_grade"] == "Low"

    def test_volatile_series_grades_higher(self):
        closes = geometric_series(daily=0.0, wobble=0.04)  # ±4% daily swings
        out = mi.compute_risk_metrics(closes)
        assert out["annualized_volatility_pct"] > 45
        assert out["risk_grade"] in ("Elevated", "High")

    def test_max_drawdown_matches_constructed_crash(self):
        closes = [100.0] * 50 + [60.0] * 50 + [80.0] * 100  # -40% crash then partial recovery
        out = mi.compute_risk_metrics(closes)
        assert math.isclose(out["max_drawdown_pct"], -40.0, abs_tol=0.1)

    def test_var_is_negative_tail(self):
        closes = geometric_series(daily=0.0, wobble=0.02)
        out = mi.compute_risk_metrics(closes)
        assert out["var_95_daily_pct"] <= 0
        assert out["cvar_95_daily_pct"] <= out["var_95_daily_pct"]

    def test_beta_one_when_stock_mirrors_benchmark(self):
        bench = geometric_series(daily=0.0005, wobble=0.01)
        out = mi.compute_risk_metrics(bench, bench)
        assert math.isclose(out["beta"], 1.0, abs_tol=0.01)
        assert math.isclose(out["correlation"], 1.0, abs_tol=0.01)
        assert out["relative_strength"]["1M"]["excess_pct"] == 0.0

    def test_leveraged_stock_has_beta_two(self):
        n = 260
        bench, stock = [], []
        pb, ps = 100.0, 100.0
        for i in range(n):
            r = 0.01 if i % 2 == 0 else -0.009
            pb *= (1 + r)
            ps *= (1 + 2 * r)
            bench.append(pb)
            stock.append(ps)
        out = mi.compute_risk_metrics(stock, bench)
        assert 1.9 <= out["beta"] <= 2.1
        assert out["up_capture_pct"] >= 190

    def test_relative_strength_outperformer(self):
        bench = geometric_series(daily=0.0002)
        stock = geometric_series(daily=0.002)
        out = mi.compute_risk_metrics(stock, bench)
        rs = out["relative_strength"]
        assert rs["1Y"]["excess_pct"] > 0
        assert rs["1M"]["stock_pct"] > rs["1M"]["benchmark_pct"]


# ---------------------------------------------------------------------------
# Short interest / squeeze rank
# ---------------------------------------------------------------------------

class TestSqueezeRank:
    def test_stocks_without_short_data_are_excluded(self):
        out = mi.compute_squeeze_rank([bundle("NOSI", short_pct_float=None)])
        assert out == []

    def test_heavy_short_with_momentum_ranks_first(self):
        heavy = bundle("HEAVY", short_pct_float=25.0, short_ratio=9.0, change_pct=4.0,
                       rsi=62.0, volume_surge=2.5, short_interest_change_pct=-8.0)
        light = bundle("LIGHT", short_pct_float=2.0, short_ratio=1.0, change_pct=0.5,
                       rsi=50.0, volume_surge=1.0, short_interest_change_pct=3.0)
        out = mi.compute_squeeze_rank([light, heavy])
        assert out[0]["symbol"] == "HEAVY"
        assert out[0]["squeeze_score"] > out[1]["squeeze_score"]
        assert out[0]["squeeze_score"] <= 100

    def test_score_components_capped(self):
        extreme = bundle("X", short_pct_float=90.0, short_ratio=50.0, change_pct=50.0,
                         rsi=90.0, volume_surge=10.0, short_interest_change_pct=-50.0)
        out = mi.compute_squeeze_rank([extreme])
        assert out[0]["squeeze_score"] == 100.0


# ---------------------------------------------------------------------------
# Portfolio insights
# ---------------------------------------------------------------------------

class TestPortfolioInsights:
    def test_empty_basket(self):
        out = mi.compute_portfolio_insights([])
        assert out["available"] is False

    def test_concentrated_sector_flagged(self):
        basket = [bundle(f"T{i}", sector="Technology") for i in range(4)] + [bundle("F", sector="Financials")]
        out = mi.compute_portfolio_insights(basket)
        assert out["available"] is True
        assert out["sector_exposure"][0]["sector"] == "Technology"
        assert out["sector_exposure"][0]["weight_pct"] == 80.0
        assert out["diversification"] == "Concentrated"
        assert any("Technology" in f["title"] for f in out["risk_flags"])

    def test_diversified_basket_not_flagged(self):
        sectors = ["Technology", "Financials", "Healthcare", "Energy", "Utilities", "Industrials"]
        basket = [bundle(f"S{i}", sector=s, beta=0.9) for i, s in enumerate(sectors)]
        out = mi.compute_portfolio_insights(basket)
        assert out["diversification"] == "Diversified"
        assert not any("%" in f["title"] and "in " in f["title"] for f in out["risk_flags"])

    def test_high_beta_and_leverage_flags(self):
        basket = [
            bundle("A", beta=1.6, debt_to_equity=200.0),
            bundle("B", beta=1.5, debt_to_equity=40.0),
            bundle("C", beta=1.4, sector="Energy"),
        ]
        out = mi.compute_portfolio_insights(basket)
        titles = " | ".join(f["title"] for f in out["risk_flags"])
        assert "High average beta" in titles
        assert "High leverage" in titles and "A" in titles

    def test_best_and_worst_today(self):
        basket = [
            bundle("WIN", change_pct=5.0),
            bundle("MID", change_pct=1.0, sector="Energy"),
            bundle("LOSE", change_pct=-3.0, sector="Financials"),
        ]
        out = mi.compute_portfolio_insights(basket)
        assert out["best_today"]["symbol"] == "WIN"
        assert out["worst_today"]["symbol"] == "LOSE"

    def test_correlated_sparklines_flagged(self):
        spark = [100 + i + (2 if i % 2 == 0 else -2) for i in range(30)]
        basket = [
            bundle("A", sector="Technology", sparkline=spark),
            bundle("B", sector="Financials", sparkline=[x * 2 for x in spark]),
            bundle("C", sector="Energy", sparkline=[x * 3 for x in spark]),
        ]
        out = mi.compute_portfolio_insights(basket)
        assert out["avg_pairwise_correlation"] is not None
        assert out["avg_pairwise_correlation"] > 0.9
        assert any("correlated" in f["title"].lower() for f in out["risk_flags"])

    def test_errored_bundles_skipped(self):
        out = mi.compute_portfolio_insights([{"symbol": "BAD", "error": "no_data"}, bundle("OK")])
        assert out["count"] == 1
