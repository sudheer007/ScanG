"""Unit tests for Nifty micro-momentum prediction helpers (no network)."""
from collections import deque
from datetime import datetime, timedelta, timezone

import prediction_service as pred


def _mk_tick(price, ts, **kwargs):
    return pred.Tick(ts=ts, price=float(price), **kwargs)


def _ticks(prices, start=None, step_sec=1.0, **kwargs):
    start = start or datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc)
    buf = deque(maxlen=pred.BUFFER_MAX_TICKS)
    for i, p in enumerate(prices):
        buf.append(_mk_tick(p, start + timedelta(seconds=i * step_sec), **kwargs))
    return buf


def test_score_up_on_rising_momentum():
    feats = {"mom_5s": 2.0, "mom_10s": 1.5, "slope": 1.0, "vol": 0.1, "streak": 4}
    direction, conf, score = pred._score_direction(feats)
    assert direction == "UP"
    assert conf > 0
    assert score > 0


def test_score_down_on_falling_momentum():
    feats = {"mom_5s": -2.0, "mom_10s": -1.5, "slope": -1.0, "vol": 0.1, "streak": -4}
    direction, conf, score = pred._score_direction(feats)
    assert direction == "DOWN"
    assert conf > 0
    assert score < 0


def test_noise_does_not_flip_direction():
    base = {"mom_5s": 2.0, "mom_10s": 1.5, "slope": 1.0, "vol": 0.0, "streak": 2}
    noisy = {**base, "vol": 5.0}
    d1, _, s1 = pred._score_direction(base)
    d2, _, s2 = pred._score_direction(noisy)
    assert d1 == d2 == "UP"
    assert abs(s2) < abs(s1)


def test_mom_bps_rising():
    ticks = _ticks([100, 100.1, 100.2, 100.3, 100.4], step_sec=1.0)
    mom = pred._mom_bps(ticks, 5.0)
    assert mom > 0


def test_session_weekend_closed():
    # Saturday
    sat = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    assert pred._nse_session_status(sat) == "closed"


def test_hit_stats_empty():
    # Isolate state
    pred._state.history.clear()
    stats = pred._hit_stats(10)
    assert stats["n"] == 0
    assert stats["hit_rate"] is None


# ---- New cross-asset / volume / spread / range indicators ----

def test_bank_nifty_confirmation_boosts_up_score():
    base = {"mom_5s": 0.5, "mom_10s": 0.4, "slope": 0.2, "vol": 0.1, "streak": 1}
    confirmed = {**base, "bank_mom_bps": 3.0}
    d1, c1, s1 = pred._score_direction(base)
    d2, c2, s2 = pred._score_direction(confirmed)
    assert s2 > s1  # bank confirmation adds to the UP-leaning score


def test_bank_nifty_divergence_can_flip_to_flat():
    # Weak Nifty momentum, Bank Nifty pulling the other way.
    feats_no_bank = {"mom_5s": 0.6, "mom_10s": 0.5, "slope": 0.3, "vol": 0.0, "streak": 1}
    feats_diverging = {**feats_no_bank, "bank_mom_bps": -4.0}
    d1, _, s1 = pred._score_direction(feats_no_bank)
    d2, _, s2 = pred._score_direction(feats_diverging)
    assert d1 == "UP"
    assert s2 < s1


def test_rising_vix_adds_bearish_pressure():
    base = {"mom_5s": -0.2, "mom_10s": -0.1, "slope": -0.1, "vol": 0.0, "streak": -1}
    with_vix_spike = {**base, "vix_mom_bps": 4.0}
    _, _, s1 = pred._score_direction(base)
    _, _, s2 = pred._score_direction(with_vix_spike)
    assert s2 < s1  # rising VIX pushes the score further negative (more bearish)


def test_falling_vix_adds_bullish_pressure():
    base = {"mom_5s": 0.2, "mom_10s": 0.1, "slope": 0.1, "vol": 0.0, "streak": 1}
    with_vix_drop = {**base, "vix_mom_bps": -4.0}
    _, _, s1 = pred._score_direction(base)
    _, _, s2 = pred._score_direction(with_vix_drop)
    assert s2 > s1


def test_volume_surge_boosts_confidence_without_changing_direction():
    base = {"mom_5s": 2.0, "mom_10s": 1.5, "slope": 1.0, "vol": 0.1, "streak": 3, "volume_surge": 1.0}
    surging = {**base, "volume_surge": 1.5}
    d1, c1, _ = pred._score_direction(base)
    d2, c2, _ = pred._score_direction(surging)
    assert d1 == d2 == "UP"
    assert c2 > c1


def test_thin_volume_dampens_confidence():
    base = {"mom_5s": 2.0, "mom_10s": 1.5, "slope": 1.0, "vol": 0.1, "streak": 3, "volume_surge": 1.0}
    thin = {**base, "volume_surge": 0.3}
    d1, c1, _ = pred._score_direction(base)
    d2, c2, _ = pred._score_direction(thin)
    assert d1 == d2 == "UP"
    assert c2 < c1


def test_range_extreme_dampens_confidence_for_continuation():
    base = {"mom_5s": 2.0, "mom_10s": 1.5, "slope": 1.0, "vol": 0.1, "streak": 3, "range_position": 0.5}
    at_high = {**base, "range_position": 0.97}
    d1, c1, _ = pred._score_direction(base)
    d2, c2, _ = pred._score_direction(at_high)
    assert d1 == d2 == "UP"
    assert c2 < c1


def test_attr_mom_bps_uses_bank_price():
    start = datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc)
    ticks = _ticks([100] * 5, start=start, step_sec=1.0, bank_price=200.0)
    # Overwrite last tick's bank_price to simulate a rise
    ticks[-1].bank_price = 202.0
    mom = pred._attr_mom_bps(ticks, 5.0, "bank_price")
    assert mom > 0


def test_volume_surge_ratio_rises_with_recent_activity():
    start = datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc)
    ticks = deque(maxlen=pred.BUFFER_MAX_TICKS)
    # Slow baseline volume growth, then a burst in the most recent ticks.
    vol = 1000.0
    for i in range(20):
        ts = start + timedelta(seconds=i * 1.0)
        if i >= 17:
            vol += 500  # burst in the last few ticks
        else:
            vol += 5
        ticks.append(_mk_tick(100 + i * 0.01, ts, etf_volume=vol))
    surge = pred._volume_surge(ticks, recent_sec=3.0)
    assert surge > 1.0


def test_spread_bps_computed_from_bid_ask():
    tick = _mk_tick(100, datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc), etf_bid=99.9, etf_ask=100.1)
    spread = pred._spread_bps(tick)
    assert spread > 0


def test_spread_bps_zero_when_no_bid_ask():
    tick = _mk_tick(100, datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc))
    assert pred._spread_bps(tick) == 0.0


def test_range_position_bounds():
    tick = _mk_tick(105, datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc), day_high=110.0, day_low=100.0)
    pos = pred._range_position(tick)
    assert 0.0 <= pos <= 1.0
    assert abs(pos - 0.5) < 1e-9


def test_from_open_bps_positive_when_above_open():
    tick = _mk_tick(101, datetime(2026, 7, 16, 5, 0, tzinfo=timezone.utc), day_open=100.0)
    assert pred._from_open_bps(tick) > 0
