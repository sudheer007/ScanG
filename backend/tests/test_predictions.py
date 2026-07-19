"""Unit tests for predictions_service pure grading/scorecard functions.

No network, no database, no live server. Run:
    cd backend && pytest tests/test_predictions.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import predictions_service as ps  # noqa: E402


def resolved(pred_type="rating", key="BUY", direction="up", alpha=5.0,
             predicted_return=None, actual_return=None):
    grade = ps.grade_outcome(direction, alpha, predicted_return, actual_return)
    return {
        "pred_type": pred_type, "key": key, "predicted_direction": direction,
        "alpha_pct": alpha, "predicted_return_pct": predicted_return,
        "actual_return_pct": actual_return, "outcome": grade["outcome"],
        "magnitude_error_pct": grade["magnitude_error_pct"],
    }


# ---------------------------------------------------------------------------
# normalize_direction
# ---------------------------------------------------------------------------

class TestNormalizeDirection:
    def test_bullish_ratings_map_up(self):
        assert ps.normalize_direction("rating", "STRONG_BUY") == "up"
        assert ps.normalize_direction("rating", "BUY") == "up"

    def test_bearish_ratings_map_down(self):
        assert ps.normalize_direction("rating", "SELL") == "down"
        assert ps.normalize_direction("rating", "REDUCE") == "down"
        assert ps.normalize_direction("rating", "STRONG_SELL") == "down"

    def test_hold_maps_flat(self):
        assert ps.normalize_direction("rating", "HOLD") == "flat"

    def test_radar_is_always_bullish(self):
        assert ps.normalize_direction("radar", "momentum_breakouts") == "up"
        assert ps.normalize_direction("radar", "oversold_quality") == "up"

    def test_forecast_direction_from_sign(self):
        assert ps.normalize_direction("forecast", "1M", predicted_return_pct=3.0) == "up"
        assert ps.normalize_direction("forecast", "1M", predicted_return_pct=-3.0) == "down"
        assert ps.normalize_direction("forecast", "1M", predicted_return_pct=0.1) == "flat"
        assert ps.normalize_direction("forecast", "1M", predicted_return_pct=None) == "flat"


# ---------------------------------------------------------------------------
# grade_outcome
# ---------------------------------------------------------------------------

class TestGradeOutcome:
    def test_up_call_beating_benchmark_is_hit(self):
        g = ps.grade_outcome("up", alpha_pct=4.0)
        assert g["outcome"] == "hit"

    def test_up_call_lagging_benchmark_is_miss(self):
        g = ps.grade_outcome("up", alpha_pct=-2.0)
        assert g["outcome"] == "miss"

    def test_down_call_underperforming_is_hit(self):
        g = ps.grade_outcome("down", alpha_pct=-3.0)
        assert g["outcome"] == "hit"

    def test_down_call_outperforming_is_miss(self):
        g = ps.grade_outcome("down", alpha_pct=1.0)
        assert g["outcome"] == "miss"

    def test_flat_call_within_tolerance_is_hit(self):
        g = ps.grade_outcome("flat", alpha_pct=2.0)
        assert g["outcome"] == "hit"

    def test_flat_call_outside_tolerance_is_miss(self):
        g = ps.grade_outcome("flat", alpha_pct=9.0)
        assert g["outcome"] == "miss"

    def test_magnitude_error_computed_when_both_present(self):
        g = ps.grade_outcome("up", alpha_pct=1.0, predicted_return_pct=8.0, actual_return_pct=5.0)
        assert g["magnitude_error_pct"] == -3.0

    def test_magnitude_error_none_without_prediction(self):
        g = ps.grade_outcome("up", alpha_pct=1.0)
        assert g["magnitude_error_pct"] is None


# ---------------------------------------------------------------------------
# compute_scorecard
# ---------------------------------------------------------------------------

class TestComputeScorecard:
    def test_empty_ledger(self):
        out = ps.compute_scorecard([])
        assert out["overall"]["n"] == 0
        assert out["overall"]["maturity"] == "no_data"

    def test_hit_rate_and_averages(self):
        docs = [
            resolved(alpha=5.0, predicted_return=6.0, actual_return=7.0),
            resolved(alpha=-3.0, predicted_return=6.0, actual_return=-1.0),
            resolved(alpha=2.0, predicted_return=6.0, actual_return=4.0),
        ]
        out = ps.compute_scorecard(docs)
        assert out["overall"]["n"] == 3
        # 2 hits (positive alpha) out of 3
        assert out["overall"]["hit_rate_pct"] == round(2 / 3 * 100, 1)
        assert out["overall"]["avg_alpha_pct"] == round((5 - 3 + 2) / 3, 2)

    def test_maturity_labels_scale_with_sample_size(self):
        few = [resolved() for _ in range(5)]
        mid = [resolved() for _ in range(30)]
        many = [resolved() for _ in range(100)]
        assert ps.compute_scorecard(few)["overall"]["maturity"] == "building"
        assert ps.compute_scorecard(mid)["overall"]["maturity"] == "early"
        assert ps.compute_scorecard(many)["overall"]["maturity"] == "established"

    def test_group_by_key_breakdown(self):
        docs = [
            resolved(key="momentum_breakouts", alpha=5.0),
            resolved(key="momentum_breakouts", alpha=-5.0),
            resolved(key="value_picks", alpha=3.0),
        ]
        out = ps.compute_scorecard(docs, group_by_key=True)
        assert set(out["by_key"].keys()) == {"momentum_breakouts", "value_picks"}
        assert out["by_key"]["momentum_breakouts"]["n"] == 2
        assert out["by_key"]["value_picks"]["n"] == 1
        assert out["by_key"]["value_picks"]["hit_rate_pct"] == 100.0

    def test_no_group_by_key_omits_breakdown(self):
        out = ps.compute_scorecard([resolved()], group_by_key=False)
        assert "by_key" not in out

    def test_never_hides_losses_from_the_average(self):
        # A strategy that's mostly wrong should show a low hit rate, not be
        # silently excluded — this is the "show losses too" trust principle.
        docs = [resolved(alpha=-4.0) for _ in range(7)] + [resolved(alpha=1.0) for _ in range(3)]
        out = ps.compute_scorecard(docs)
        assert out["overall"]["n"] == 10
        assert out["overall"]["hit_rate_pct"] == 30.0
