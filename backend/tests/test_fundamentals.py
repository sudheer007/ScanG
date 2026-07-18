"""Unit tests for the Track A fundamentals engine (backend/fundamentals_service.py).

These exercise the pure compute functions directly with hand-built Yahoo-shaped
statement series — no network calls, no live server, no DB. Run with:
    cd backend && pytest tests/test_fundamentals.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fundamentals_service as fs  # noqa: E402


def series(**metrics):
    """Build a Series dict: {metric: [{"date": ..., "value": ...}, ...]}."""
    out = {}
    for name, values in metrics.items():
        out[name] = [{"date": f"20{20 + i}-12-31", "value": v} for i, v in enumerate(values)]
    return out


# ---------------------------------------------------------------------------
# Piotroski F-Score
# ---------------------------------------------------------------------------

class TestPiotroski:
    def test_strong_company_scores_high(self):
        annual = series(
            NetIncome=[80, 100],
            TotalAssets=[900, 1000],
            OperatingCashFlow=[90, 130],
            LongTermDebt=[200, 150],
            CurrentAssets=[300, 340],
            CurrentLiabilities=[200, 200],
            OrdinarySharesNumber=[100, 100],
            GrossProfit=[400, 460],
            TotalRevenue=[1000, 1100],
        )
        result = fs.compute_piotroski(annual)
        assert result["max"] == 9
        assert result["evaluated"] == 9
        # Every check here is constructed to pass
        assert result["score"] == 9
        assert result["label"] == "strong"
        names = {c["name"] for c in result["checks"]}
        assert "Positive ROA" in names
        assert "No share dilution" in names

    def test_diluting_lossmaking_company_scores_low(self):
        annual = series(
            NetIncome=[10, -20],
            TotalAssets=[1000, 1000],
            OperatingCashFlow=[5, -10],
            LongTermDebt=[100, 200],
            CurrentAssets=[300, 250],
            CurrentLiabilities=[150, 200],
            OrdinarySharesNumber=[100, 130],
            GrossProfit=[300, 260],
            TotalRevenue=[1000, 950],
        )
        result = fs.compute_piotroski(annual)
        assert result["score"] <= 3
        assert result["label"] == "weak"
        dilution_check = next(c for c in result["checks"] if c["name"] == "No share dilution")
        assert dilution_check["passed"] is False

    def test_no_long_term_debt_counts_as_pass(self):
        annual = series(
            NetIncome=[10, 20], TotalAssets=[100, 120],
            OperatingCashFlow=[15, 25],
            CurrentAssets=[50, 60], CurrentLiabilities=[30, 30],
            OrdinarySharesNumber=[10, 10], GrossProfit=[40, 50], TotalRevenue=[100, 120],
        )
        result = fs.compute_piotroski(annual)
        lev_check = next(c for c in result["checks"] if c["name"] == "Leverage decreasing")
        assert lev_check["passed"] is True
        assert "no long-term debt" in lev_check["detail"]

    def test_missing_data_evaluates_as_none_not_failure(self):
        annual = series(NetIncome=[50], TotalAssets=[500])  # only one year, most checks need 2
        result = fs.compute_piotroski(annual)
        assert result["evaluated"] < result["max"]
        na_checks = [c for c in result["checks"] if c["passed"] is None]
        assert len(na_checks) > 0


# ---------------------------------------------------------------------------
# Altman Z-Score
# ---------------------------------------------------------------------------

class TestAltman:
    def test_healthy_balance_sheet_is_safe_zone(self):
        annual = series(
            TotalAssets=[1000], TotalLiabilitiesNetMinorityInterest=[300],
            WorkingCapital=[200], RetainedEarnings=[400],
            EBIT=[250], TotalRevenue=[1200],
        )
        result = fs.compute_altman(annual, market_cap=5000)
        assert result["score"] is not None
        assert result["zone"] == "safe"

    def test_distressed_balance_sheet_is_distress_zone(self):
        annual = series(
            TotalAssets=[1000], TotalLiabilitiesNetMinorityInterest=[950],
            WorkingCapital=[-100], RetainedEarnings=[-300],
            EBIT=[5], TotalRevenue=[200],
        )
        result = fs.compute_altman(annual, market_cap=50)
        assert result["score"] is not None
        assert result["zone"] == "distress"

    def test_missing_total_assets_returns_none(self):
        annual = series(TotalLiabilitiesNetMinorityInterest=[100])
        result = fs.compute_altman(annual, market_cap=1000)
        assert result["score"] is None
        assert result["zone"] is None


# ---------------------------------------------------------------------------
# Earnings quality
# ---------------------------------------------------------------------------

class TestEarningsQuality:
    def test_cash_exceeding_earnings_is_high_quality(self):
        annual = series(NetIncome=[80], OperatingCashFlow=[120], TotalAssets=[1000])
        result = fs.compute_earnings_quality(annual)
        assert result["label"] == "high"
        assert result["accruals_ratio"] < 0

    def test_earnings_far_ahead_of_cash_is_low_quality(self):
        annual = series(NetIncome=[200], OperatingCashFlow=[20], TotalAssets=[1000])
        result = fs.compute_earnings_quality(annual)
        assert result["label"] == "low"
        assert result["accruals_ratio"] > 0.05


# ---------------------------------------------------------------------------
# DCF
# ---------------------------------------------------------------------------

class TestDCF:
    def test_positive_fcf_produces_valuation(self):
        annual = series(FreeCashFlow=[900, 1000], TotalRevenue=[9000, 10000])
        result = fs.compute_dcf(annual, price=50, shares_outstanding=1000, growth_pct=8, discount_pct=10, terminal_growth_pct=2.5)
        assert result["available"] is True
        assert result["intrinsic_value_per_share"] > 0
        assert result["upside_pct"] is not None
        assert len(result["projections"]) == 10
        assert result["verdict"] in ("undervalued", "overvalued", "fairly valued")

    def test_negative_fcf_is_unavailable(self):
        annual = series(FreeCashFlow=[-50, -80])
        result = fs.compute_dcf(annual, price=50, shares_outstanding=1000)
        assert result["available"] is False
        assert "free cash flow" in result["reason"]

    def test_discount_below_terminal_growth_is_unavailable(self):
        annual = series(FreeCashFlow=[900, 1000])
        result = fs.compute_dcf(annual, price=50, shares_outstanding=1000, discount_pct=2, terminal_growth_pct=3)
        assert result["available"] is False
        assert "discount rate" in result["reason"]

    def test_missing_shares_is_unavailable(self):
        annual = series(FreeCashFlow=[900, 1000])
        result = fs.compute_dcf(annual, price=50, shares_outstanding=None)
        assert result["available"] is False
        assert "share count" in result["reason"]

    def test_default_growth_assumption_is_clamped(self):
        # huge historical growth should clamp to 20%
        annual = series(TotalRevenue=[100, 1000])
        assert fs.default_growth_assumption(annual) == 20.0
        # shrinking revenue should clamp to 2%
        annual2 = series(TotalRevenue=[1000, 100])
        assert fs.default_growth_assumption(annual2) == 2.0


# ---------------------------------------------------------------------------
# Red flags
# ---------------------------------------------------------------------------

class TestRedFlags:
    def test_receivables_outpacing_revenue_flagged(self):
        annual = series(
            AccountsReceivable=[100, 180], TotalRevenue=[1000, 1050],
        )
        flags = fs.detect_red_flags(annual, {})
        titles = [f["title"] for f in flags]
        assert "Receivables outpacing revenue" in titles

    def test_clean_company_has_no_flags(self):
        annual = series(
            AccountsReceivable=[100, 108], TotalRevenue=[1000, 1080],
            OrdinarySharesNumber=[100, 100],
            EBIT=[300, 320], InterestExpense=[10, 10],
            NetIncome=[200, 220], OperatingCashFlow=[220, 240],
            TotalDebt=[100, 100], StockholdersEquity=[500, 550],
            GrossProfit=[500, 540],
        )
        flags = fs.detect_red_flags(annual, {})
        assert flags == []

    def test_negative_equity_flagged_high_severity(self):
        annual = series(StockholdersEquity=[-50, -100])
        flags = fs.detect_red_flags(annual, {})
        neg_eq = next((f for f in flags if f["title"] == "Negative shareholder equity"), None)
        assert neg_eq is not None
        assert neg_eq["severity"] == "high"

    def test_weak_interest_coverage_flagged(self):
        annual = series(EBIT=[100], InterestExpense=[80])
        flags = fs.detect_red_flags(annual, {})
        cov_flag = next((f for f in flags if f["title"] == "Weak interest coverage"), None)
        assert cov_flag is not None
        assert cov_flag["severity"] == "high"  # coverage 1.25x < 1.5


# ---------------------------------------------------------------------------
# Peer comparison
# ---------------------------------------------------------------------------

class TestPeerComparison:
    def test_percentile_rank_higher_is_better(self):
        values = [10, 20, 30, 40, 50]
        assert fs._percentile_rank(values, 50) == 100
        assert fs._percentile_rank(values, 10) == 20

    def test_percentile_rank_lower_is_better(self):
        values = [10, 20, 30, 40, 50]
        assert fs._percentile_rank(values, 10, lower_is_better=True) == 100
        assert fs._percentile_rank(values, 50, lower_is_better=True) == 20

    def test_build_peer_table_ranks_and_includes_target(self):
        target = {"symbol": "AAA", "sector": "Tech", "market_cap": 1000, "pe": 20, "roe": 25, "profit_margin": 20, "debt_to_equity": 0.5}
        candidates = [
            target,
            {"symbol": "BBB", "sector": "Tech", "market_cap": 900, "pe": 15, "roe": 30, "profit_margin": 25, "debt_to_equity": 0.3},
            {"symbol": "CCC", "sector": "Tech", "market_cap": 1100, "pe": 40, "roe": 10, "profit_margin": 8, "debt_to_equity": 1.5},
            {"symbol": "DDD", "sector": "Healthcare", "market_cap": 1000, "pe": 18, "roe": 22, "profit_margin": 18, "debt_to_equity": 0.4},
        ]
        result = fs.build_peer_table(target, candidates)
        symbols = [p["symbol"] for p in result["peers"]]
        assert "AAA" in symbols
        assert "DDD" not in symbols  # different sector, excluded
        assert result["sector"] == "Tech"
        target_row = next(p for p in result["peers"] if p["symbol"] == "AAA")
        assert target_row["is_target"] is True
        ranks = [p["rank"] for p in result["peers"]]
        assert ranks == sorted(ranks)


# ---------------------------------------------------------------------------
# Pillar scores
# ---------------------------------------------------------------------------

class TestPillarScores:
    def test_scores_are_bounded_0_100(self):
        piotroski = {"score": 7, "max": 9}
        altman = {"zone": "safe"}
        eq = {"label": "high"}
        traj = {
            "roic_pct": [{"date": "2024", "value": 20}],
            "interest_coverage": [{"date": "2024", "value": 10}],
            "revenue_growth_pct": [{"date": "2022", "value": 10}, {"date": "2023", "value": 15}, {"date": "2024", "value": 20}],
            "fcf": [{"date": "2022", "value": 100}, {"date": "2024", "value": 200}],
        }
        flags = []
        result = fs.compute_pillar_scores(piotroski, altman, eq, traj, flags)
        for key in ("quality", "health", "growth"):
            assert 0 <= result[key] <= 100

    def test_red_flags_penalize_health_score(self):
        piotroski = {"score": 7, "max": 9}
        altman = {"zone": "safe"}
        eq = {"label": "high"}
        traj = {"roic_pct": [], "interest_coverage": [], "revenue_growth_pct": [], "fcf": []}
        no_flags = fs.compute_pillar_scores(piotroski, altman, eq, traj, [])
        with_flags = fs.compute_pillar_scores(
            piotroski, altman, eq, traj,
            [{"severity": "high", "title": "x", "detail": "y"}, {"severity": "high", "title": "z", "detail": "w"}],
        )
        assert with_flags["health"] < no_flags["health"]
