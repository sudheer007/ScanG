"""Tests for Nifty ML helpers (no network)."""
import nifty_ml as nm


def test_deadband_at_least_minimum():
    assert nm.deadband_bps(0.0, 10) >= nm.MIN_DEADBAND_BPS


def test_actual_direction_flat_inside_band():
    assert nm.actual_direction_from_move(0.2, 0.5) == "FLAT"
    assert nm.actual_direction_from_move(-0.2, 0.5) == "FLAT"


def test_actual_direction_up_down_outside_band():
    assert nm.actual_direction_from_move(2.0, 0.5) == "UP"
    assert nm.actual_direction_from_move(-2.0, 0.5) == "DOWN"


def test_outcome_flat_when_actual_flat():
    assert nm.outcome_for_prediction("UP", "FLAT") == "flat"


def test_enrich_vol_normalizes_momentum():
    raw = {"mom_5s": 10.0, "vol": 5.0, "streak": 3.0}
    e = nm.enrich_features(raw, ewma_vol=2.0, session_frac=0.5)
    assert e["mom_5s_n"] == 2.0
    assert e["ewma_vol"] == 2.0


def test_update_ewma_vol_positive():
    v = nm.update_ewma_vol(1.0, 5.0)
    assert v > 0


def test_outcome_predicted_flat_is_flat():
    assert nm.outcome_for_prediction("FLAT", "UP") == "flat"
    assert nm.outcome_for_prediction("FLAT", "DOWN") == "flat"
