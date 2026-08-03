"""Nifty 50 short-horizon (5–60s) micro-momentum prediction pulse.

Polls a small correlated basket every ~1.5s into an in-memory tick ring
buffer, scores short-term direction with a rule-based multi-signal model, and
tracks hit-rate against realized outcomes. Experimental — not investment
advice.

Basket (single batched Yahoo request per poll):
  - ``^NSEI``        Nifty 50 — the prediction target
  - ``^NSEBANK``      Bank Nifty — ~35% index weight, used as a confirming
                      momentum signal (index quotes report volume=0, so this
                      is a *price* momentum confirmation, not volume)
  - ``^INDIAVIX``     India VIX — rising VIX = bearish pressure on equities
  - ``NIFTYBEES.NS``  Nifty 50 ETF — indices report zero volume/bid/ask on
                      Yahoo, so this liquid ETF proxy supplies the volume
                      surge and bid/ask spread signals

All cross-asset/volume signals only shape *confidence*; only Nifty's own
momentum, Bank Nifty confirmation, and VIX pressure can flip the UP/DOWN/FLAT
call, so noise never silently biases direction.
"""
from __future__ import annotations

import asyncio
import logging
import math
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, time, timezone, timedelta
from typing import Any, Deque, Dict, List, Optional, Tuple
try:
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")
except Exception:  # pragma: no cover — Windows without tzdata
    _IST = timezone(timedelta(hours=5, minutes=30))

import stock_service as ss
from pymongo import ASCENDING

import nifty_ml as nm

log = logging.getLogger(__name__)

SYMBOL = "^NSEI"
BANK_SYMBOL = "^NSEBANK"
VIX_SYMBOL = "^INDIAVIX"
ETF_SYMBOL = "NIFTYBEES.NS"
BASKET_SYMBOLS = [SYMBOL, BANK_SYMBOL, VIX_SYMBOL, ETF_SYMBOL]

HORIZONS = (5, 10, 15, 30, 60)
POLL_INTERVAL_SEC = 5.0  # open session: Yahoo basket poll (was 1.5s — too aggressive on Render)
POLL_INTERVAL_CLOSED_SEC = 300.0  # 5 min when NSE closed — skip hammering Yahoo
BUFFER_MAX_TICKS = 300  # ~7.5 min at 1.5s
HISTORY_MAX = 200
DISCLAIMER = (
    "Experimental micro-momentum pulse using delayed Yahoo quotes (Nifty 50, "
    "Bank Nifty, India VIX, Nifty ETF volume). Not investment advice; "
    "expect near-random accuracy."
)

# NSE regular session (IST): 09:15 – 15:30
_SESSION_OPEN = time(9, 15)
_SESSION_CLOSE = time(15, 30)

# ---- Scorer weights / thresholds ----
# Directional signal (can flip UP/DOWN):
_W_MOM5 = 0.35
_W_MOM10 = 0.25
_W_SLOPE = 0.20
_W_STREAK = 0.10
_W_BANK = 0.20   # Bank Nifty momentum confirmation
_W_VIX = 0.15    # India VIX pressure (inverse)
_BANK_CLAMP = 4.0
_VIX_CLAMP = 4.0

# Magnitude-only dampeners (never flip direction):
_W_NOISE = 0.30   # realized volatility of Nifty ticks
_W_SPREAD = 0.20  # ETF bid/ask spread (liquidity/uncertainty)

_CONF_SCALE = 2.4


@dataclass
class Tick:
    ts: datetime
    price: float
    change_pct: Optional[float] = None
    bank_price: Optional[float] = None
    vix_price: Optional[float] = None
    etf_price: Optional[float] = None
    etf_volume: Optional[float] = None
    etf_bid: Optional[float] = None
    etf_ask: Optional[float] = None
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    day_open: Optional[float] = None


@dataclass
class PendingOutcome:
    id: str
    horizon_sec: int
    direction: str
    price_at: float
    predicted_at: datetime
    resolve_at: datetime


@dataclass
class PredictionRecord:
    id: str
    horizon_sec: int
    direction: str
    confidence: float
    price_at: float
    predicted_at: datetime
    outcome: Optional[str] = None  # "hit" | "miss" | "flat" | None
    price_after: Optional[float] = None
    resolved_at: Optional[datetime] = None
    actual_direction: Optional[str] = None
    trading_date: Optional[str] = None


@dataclass
class EngineState:
    ticks: Deque[Tick] = field(default_factory=lambda: deque(maxlen=BUFFER_MAX_TICKS))
    history: Deque[PredictionRecord] = field(default_factory=lambda: deque(maxlen=HISTORY_MAX))
    pending: List[PendingOutcome] = field(default_factory=list)
    last_quote: Optional[Dict[str, Any]] = None
    last_error: Optional[str] = None
    poll_count: int = 0
    last_minute_prediction_key: Optional[str] = None
    ewma_vol_bps: float = 1.0


_state = EngineState()
_poll_task: Optional[asyncio.Task] = None
_lock = asyncio.Lock()
_history_collection = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _f(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _ist_now(now: Optional[datetime] = None) -> datetime:
    return (now or _utcnow()).astimezone(_IST)


def _trading_date_str(now: Optional[datetime] = None) -> str:
    return _ist_now(now).strftime("%Y-%m-%d")


def _minute_bucket(now: datetime) -> datetime:
    return now.replace(second=0, microsecond=0)


def _minute_key(now: datetime) -> str:
    return _minute_bucket(now).astimezone(_IST).strftime("%Y-%m-%dT%H:%M")


async def configure_persistence(collection: Any) -> None:
    global _history_collection
    _history_collection = collection
    if _history_collection is None:
        return
    await _history_collection.create_index([("minute_key", ASCENDING)], unique=True)
    await _history_collection.create_index([("trading_date", ASCENDING), ("predicted_at", ASCENDING)])
    await _history_collection.create_index([("resolved_at", ASCENDING)])
    await _history_collection.create_index([("status", ASCENDING), ("resolve_at", ASCENDING)])
    # Reload overdue/pending 1m rows into memory so they still resolve after restart.
    await _rehydrate_pending_from_mongo()


async def _rehydrate_pending_from_mongo() -> None:
    """Queue unresolved Mongo 1m logs that still need an actual price."""
    if _history_collection is None:
        return
    now = _utcnow()
    try:
        docs = await _history_collection.find(
            {
                "horizon_sec": 60,
                "status": "pending",
                "resolve_at": {"$lte": now + timedelta(minutes=5)},
            },
            {"_id": 0, "id": 1, "direction": 1, "price_at": 1, "predicted_price": 1,
             "predicted_at": 1, "resolve_at": 1, "horizon_sec": 1},
        ).sort("resolve_at", ASCENDING).limit(200).to_list(length=200)
    except Exception as e:
        log.warning("nifty pending rehydrate failed: %s", e)
        return

    async with _lock:
        existing = {p.id for p in _state.pending}
        for d in docs:
            pid = d.get("id")
            if not pid or pid in existing:
                continue
            price = _f(d.get("price_at") if d.get("price_at") is not None else d.get("predicted_price"))
            if price is None:
                continue
            predicted_at = d.get("predicted_at")
            resolve_at = d.get("resolve_at")
            if not isinstance(predicted_at, datetime) or not isinstance(resolve_at, datetime):
                continue
            if predicted_at.tzinfo is None:
                predicted_at = predicted_at.replace(tzinfo=timezone.utc)
            if resolve_at.tzinfo is None:
                resolve_at = resolve_at.replace(tzinfo=timezone.utc)
            direction = d.get("direction") or "FLAT"
            _state.pending.append(
                PendingOutcome(
                    id=pid,
                    horizon_sec=int(d.get("horizon_sec") or 60),
                    direction=direction,
                    price_at=float(price),
                    predicted_at=predicted_at,
                    resolve_at=resolve_at,
                )
            )
            existing.add(pid)
        if docs:
            log.info("Rehydrated %s pending nifty 1m log(s) from Mongo", len(docs))



def _nse_session_status(now: Optional[datetime] = None) -> str:
    """Return 'open' | 'closed' for NSE cash equity session (IST, Mon–Fri)."""
    now = now or _utcnow()
    local = now.astimezone(_IST)
    if local.weekday() >= 5:
        return "closed"
    t = local.time()
    if _SESSION_OPEN <= t <= _SESSION_CLOSE:
        return "open"
    return "closed"


def _price_at_or_before(ticks: Deque[Tick], target: datetime) -> Optional[float]:
    """Latest tick price at or before target."""
    best: Optional[Tick] = None
    for tick in ticks:
        if tick.ts <= target:
            best = tick
        else:
            break
    return best.price if best else None


def _mom_bps(ticks: Deque[Tick], lookback_sec: float) -> float:
    """Return Nifty momentum in basis points over lookback_sec (positive = up)."""
    if len(ticks) < 2:
        return 0.0
    now_ts = ticks[-1].ts
    cutoff = now_ts - timedelta(seconds=lookback_sec)
    start_price = _price_at_or_before(ticks, cutoff)
    end_price = ticks[-1].price
    if start_price is None or start_price <= 0:
        for tick in ticks:
            if tick.ts >= cutoff:
                start_price = tick.price
                break
    if start_price is None or start_price <= 0:
        return 0.0
    return ((end_price - start_price) / start_price) * 10000.0


def _attr_mom_bps(ticks: Deque[Tick], lookback_sec: float, attr: str) -> float:
    """Momentum in bps for an arbitrary numeric tick attribute (e.g. bank_price)."""
    values = [(t.ts, getattr(t, attr, None)) for t in ticks]
    values = [(ts, v) for ts, v in values if v is not None and v > 0]
    if len(values) < 2:
        return 0.0
    now_ts = values[-1][0]
    cutoff = now_ts - timedelta(seconds=lookback_sec)
    start_price = None
    for ts, v in values:
        if ts <= cutoff:
            start_price = v
        else:
            break
    if start_price is None:
        start_price = values[0][1]
    end_price = values[-1][1]
    if not start_price:
        return 0.0
    return ((end_price - start_price) / start_price) * 10000.0


def _slope_bps(ticks: Deque[Tick], lookback_sec: float = 20.0) -> float:
    """Linear slope of price vs time, expressed as bps per second * 10 for scale."""
    if len(ticks) < 3:
        return 0.0
    now_ts = ticks[-1].ts
    cutoff = now_ts - timedelta(seconds=lookback_sec)
    pts = [(t.ts.timestamp(), t.price) for t in ticks if t.ts >= cutoff]
    if len(pts) < 3:
        pts = [(t.ts.timestamp(), t.price) for t in list(ticks)[-8:]]
    if len(pts) < 3:
        return 0.0
    t0 = pts[0][0]
    xs = [p[0] - t0 for p in pts]
    ys = [p[1] for p in pts]
    n = len(xs)
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xx = sum(x * x for x in xs)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    den = n * sum_xx - sum_x * sum_x
    if abs(den) < 1e-12:
        return 0.0
    slope = (n * sum_xy - sum_x * sum_y) / den  # price per second
    mid = sum_y / n
    if mid <= 0:
        return 0.0
    return (slope / mid) * 10000.0 * 10.0  # scale for scorer


def _realized_vol_bps(ticks: Deque[Tick], lookback_sec: float = 30.0) -> float:
    if len(ticks) < 3:
        return 0.0
    now_ts = ticks[-1].ts
    cutoff = now_ts - timedelta(seconds=lookback_sec)
    prices = [t.price for t in ticks if t.ts >= cutoff]
    if len(prices) < 3:
        prices = [t.price for t in list(ticks)[-10:]]
    rets = []
    for a, b in zip(prices, prices[1:]):
        if a > 0:
            rets.append(((b - a) / a) * 10000.0)
    if len(rets) < 2:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(max(var, 0.0))


def _streak(ticks: Deque[Tick]) -> int:
    """Signed streak of consecutive up (+) / down (-) tick-to-tick moves."""
    if len(ticks) < 2:
        return 0
    prices = [t.price for t in list(ticks)[-21:]]
    streak = 0
    last_dir = 0
    for a, b in zip(prices, prices[1:]):
        if b > a:
            d = 1
        elif b < a:
            d = -1
        else:
            continue
        if d == last_dir:
            streak += d
        else:
            streak = d
            last_dir = d
    return streak


def _volume_surge(ticks: Deque[Tick], recent_sec: float = 20.0) -> float:
    """Ratio of recent ETF trading rate vs its baseline rate over the buffer.

    >1 means the ETF is trading faster than its recent average (more real
    participation behind the current move); <1 means volume is thin.
    """
    vols = [(t.ts, t.etf_volume) for t in ticks if t.etf_volume is not None]
    if len(vols) < 3:
        return 1.0
    span = (vols[-1][0] - vols[0][0]).total_seconds()
    if span <= 0:
        return 1.0
    baseline_rate = (vols[-1][1] - vols[0][1]) / span
    if baseline_rate <= 0:
        return 1.0
    now_ts = vols[-1][0]
    cutoff = now_ts - timedelta(seconds=recent_sec)
    recent_start_v = None
    recent_start_ts = vols[0][0]
    for ts, v in vols:
        if ts <= cutoff:
            recent_start_v = v
            recent_start_ts = ts
        else:
            break
    if recent_start_v is None:
        recent_start_v = vols[0][1]
        recent_start_ts = vols[0][0]
    recent_span = (now_ts - recent_start_ts).total_seconds()
    if recent_span <= 0:
        return 1.0
    recent_rate = (vols[-1][1] - recent_start_v) / recent_span
    return max(0.0, recent_rate / baseline_rate)


def _spread_bps(tick: Optional[Tick]) -> float:
    """ETF bid/ask spread in bps — a proxy for liquidity/uncertainty."""
    if not tick or not tick.etf_bid or not tick.etf_ask or tick.etf_bid <= 0:
        return 0.0
    mid = (tick.etf_bid + tick.etf_ask) / 2.0
    if mid <= 0:
        return 0.0
    return max(0.0, ((tick.etf_ask - tick.etf_bid) / mid) * 10000.0)


def _range_position(tick: Optional[Tick]) -> float:
    """Where price sits within today's high/low range, 0 = low, 1 = high."""
    if not tick or tick.day_high is None or tick.day_low is None:
        return 0.5
    span = tick.day_high - tick.day_low
    if span <= 0:
        return 0.5
    pos = (tick.price - tick.day_low) / span
    return max(0.0, min(1.0, pos))


def _from_open_bps(tick: Optional[Tick]) -> float:
    """Intraday trend strength: distance of current price from today's open."""
    if not tick or not tick.day_open:
        return 0.0
    return ((tick.price - tick.day_open) / tick.day_open) * 10000.0


def _session_fraction(now: Optional[datetime] = None) -> float:
    local = _ist_now(now)
    return nm.session_fraction_ist(local.hour + local.minute / 60.0 + local.second / 3600.0)


def _predict_from_features(
    features: Dict[str, float],
    horizon_sec: int,
) -> Tuple[str, float, float, bool, str, Dict[str, Any]]:
    """Direction, confidence, score, abstain, engine name, ml extras."""
    ewma = _state.ewma_vol_bps
    session_frac = _session_fraction()
    enriched = nm.enrich_features(features, ewma_vol=ewma, session_frac=session_frac)
    band = nm.deadband_bps(ewma, horizon_sec)
    ml_res = nm.get_models().predict_ml(enriched, horizon_sec=horizon_sec, ewma_vol=ewma)
    if ml_res is not None:
        extras = {
            "prob_up": ml_res.prob_up,
            "meta_prob": ml_res.meta_prob,
            "deadband_bps": ml_res.deadband_bps,
            "enriched": {k: enriched.get(k) for k in nm.FEATURE_NAMES},
        }
        return (
            ml_res.direction,
            ml_res.confidence,
            ml_res.score,
            ml_res.abstain,
            ml_res.engine,
            extras,
        )
    direction, confidence, score = _score_direction(features)
    extras = {
        "prob_up": None,
        "meta_prob": None,
        "deadband_bps": round(band, 3),
        "enriched": {k: enriched.get(k) for k in nm.FEATURE_NAMES},
    }
    return direction, confidence, score, False, "rules", extras


def _extract_features(ticks: Deque[Tick]) -> Dict[str, float]:
    latest = ticks[-1] if ticks else None
    return {
        "mom_5s": _mom_bps(ticks, 5.0),
        "mom_10s": _mom_bps(ticks, 10.0),
        "mom_30s": _mom_bps(ticks, 30.0),
        "slope": _slope_bps(ticks, 20.0),
        "vol": _realized_vol_bps(ticks, 30.0),
        "streak": float(_streak(ticks)),
        "bank_mom_bps": _attr_mom_bps(ticks, 10.0, "bank_price"),
        "vix_mom_bps": _attr_mom_bps(ticks, 10.0, "vix_price"),
        "volume_surge": _volume_surge(ticks),
        "spread_bps": _spread_bps(latest),
        "range_position": _range_position(latest),
        "from_open_bps": _from_open_bps(latest),
    }


def _score_direction(features: Dict[str, float]) -> Tuple[str, float, float]:
    """Return (direction, confidence_0_100, raw_score).

    Direction is always UP or DOWN — never FLAT.
    Score > 0 → UP, score <= 0 → DOWN.
    Bank Nifty and India VIX shape the signal; volatility, ETF spread, volume
    surge, and day-range position only scale confidence.
    """
    noise = max(0.0, features.get("vol", 0.0))
    spread = max(0.0, features.get("spread_bps", 0.0))
    streak_term = max(-5.0, min(5.0, features.get("streak", 0.0))) / 5.0
    bank_term = max(-_BANK_CLAMP, min(_BANK_CLAMP, features.get("bank_mom_bps", 0.0)))
    vix_term = max(-_VIX_CLAMP, min(_VIX_CLAMP, features.get("vix_mom_bps", 0.0)))

    signal = (
        _W_MOM5 * features.get("mom_5s", 0.0)
        + _W_MOM10 * features.get("mom_10s", 0.0)
        + _W_SLOPE * features.get("slope", 0.0)
        + _W_STREAK * streak_term
        + _W_BANK * bank_term
        - _W_VIX * vix_term  # rising VIX (positive) => bearish pressure
    )
    damp = 1.0 + _W_NOISE * noise + _W_SPREAD * (spread / 5.0)
    score = signal / damp

    direction = "UP" if score > 0 else "DOWN"

    confidence = max(0.0, min(100.0, (abs(score) / _CONF_SCALE) * 100.0))

    # Confidence-only shaping from volume + range extremes (direction is fixed above).
    vol_surge = features.get("volume_surge", 1.0)
    if vol_surge >= 1.3:
        confidence *= 1.15
    elif vol_surge <= 0.6:
        confidence *= 0.7

    range_pos = features.get("range_position", 0.5)
    if direction == "UP" and range_pos >= 0.92:
        confidence *= 0.75  # chasing a move already near the day high
    elif direction == "DOWN" and range_pos <= 0.08:
        confidence *= 0.75  # chasing a move already near the day low

    confidence = max(0.0, min(100.0, confidence))

    return direction, round(confidence, 1), round(score, 4)


def _build_signals(features: Dict[str, float], tick: Optional[Tick]) -> Dict[str, Any]:
    bank_bps = features.get("bank_mom_bps", 0.0)
    vix_bps = features.get("vix_mom_bps", 0.0)
    surge = features.get("volume_surge", 1.0)
    return {
        "bank_nifty": {
            "price": tick.bank_price if tick else None,
            "mom_bps": round(bank_bps, 2),
            "confirms": "up" if bank_bps > 0.3 else "down" if bank_bps < -0.3 else "neutral",
        },
        "india_vix": {
            "price": tick.vix_price if tick else None,
            "mom_bps": round(vix_bps, 2),
            "pressure": "bearish" if vix_bps > 0.3 else "bullish" if vix_bps < -0.3 else "neutral",
        },
        "volume": {
            "etf_symbol": ETF_SYMBOL,
            "surge_ratio": round(surge, 2),
            "label": "high" if surge >= 1.3 else "low" if surge <= 0.6 else "normal",
        },
        "spread_bps": round(features.get("spread_bps", 0.0), 2),
        "range_position": round(features.get("range_position", 0.5), 3),
        "from_open_bps": round(features.get("from_open_bps", 0.0), 2),
    }


async def _append_snapshot(quotes: Dict[str, Dict[str, Any]]) -> None:
    nifty_q = quotes.get(SYMBOL) or {}
    price = _f(nifty_q.get("regularMarketPrice"))
    if price is None:
        return
    bank_q = quotes.get(BANK_SYMBOL) or {}
    vix_q = quotes.get(VIX_SYMBOL) or {}
    etf_q = quotes.get(ETF_SYMBOL) or {}

    tick = Tick(
        ts=_utcnow(),
        price=price,
        change_pct=_f(nifty_q.get("regularMarketChangePercent")),
        bank_price=_f(bank_q.get("regularMarketPrice")),
        vix_price=_f(vix_q.get("regularMarketPrice")),
        etf_price=_f(etf_q.get("regularMarketPrice")),
        etf_volume=_f(etf_q.get("regularMarketVolume")),
        etf_bid=_f(etf_q.get("bid")),
        etf_ask=_f(etf_q.get("ask")),
        day_high=_f(nifty_q.get("regularMarketDayHigh")),
        day_low=_f(nifty_q.get("regularMarketDayLow")),
        day_open=_f(nifty_q.get("regularMarketOpen")),
    )
    mapped_quote = {
        "symbol": SYMBOL,
        "name": nifty_q.get("longName") or nifty_q.get("shortName") or "NIFTY 50",
        "price": price,
        "change": _f(nifty_q.get("regularMarketChange")),
        "change_pct": _f(nifty_q.get("regularMarketChangePercent")),
        "currency": nifty_q.get("currency") or "INR",
    }
    async with _lock:
        # Dedup identical price within 0.4s to avoid buffer spam when Yahoo stalls
        if _state.ticks:
            last = _state.ticks[-1]
            if abs(last.price - tick.price) < 1e-9 and (tick.ts - last.ts).total_seconds() < 0.4:
                return
            if last.price > 0:
                ret_bps = ((tick.price - last.price) / last.price) * 10000.0
                _state.ewma_vol_bps = nm.update_ewma_vol(_state.ewma_vol_bps, ret_bps)
        _state.ticks.append(tick)
        _state.last_quote = mapped_quote
        _state.poll_count += 1


def _resolve_one_outcome(
    *,
    direction: str,
    price_at: float,
    price_after: float,
    horizon_sec: int,
) -> Tuple[str, str, float]:
    """Return (actual_direction, outcome, price_after)."""
    band = nm.deadband_bps(_state.ewma_vol_bps, horizon_sec)
    move_bps = nm.move_bps(price_at, price_after)
    actual = nm.actual_direction_from_move(move_bps, band)
    outcome = nm.outcome_for_prediction(direction, actual)
    return actual, outcome, price_after


async def _resolve_pending() -> None:
    now = _utcnow()
    resolved_records: List[PredictionRecord] = []
    async with _lock:
        still_pending: List[PendingOutcome] = []
        for p in _state.pending:
            if now < p.resolve_at:
                still_pending.append(p)
                continue
            price_after = _price_at_or_before(_state.ticks, now)
            if price_after is None and _state.ticks:
                # Fall back to latest tick if buffer advanced past resolve time.
                price_after = _state.ticks[-1].price
            if price_after is None:
                still_pending.append(p)
                continue
            actual, outcome, price_after = _resolve_one_outcome(
                direction=p.direction,
                price_at=p.price_at,
                price_after=price_after,
                horizon_sec=p.horizon_sec,
            )

            # Update matching history record
            for rec in reversed(_state.history):
                if rec.id == p.id:
                    rec.outcome = outcome
                    rec.price_after = price_after
                    rec.resolved_at = now
                    rec.actual_direction = actual
                    resolved_records.append(rec)
                    break
            else:
                # Pending came from Mongo rehydrate — still persist outcome below.
                resolved_records.append(
                    PredictionRecord(
                        id=p.id,
                        horizon_sec=p.horizon_sec,
                        direction=p.direction,
                        confidence=0.0,
                        price_at=p.price_at,
                        predicted_at=p.predicted_at,
                        outcome=outcome,
                        price_after=price_after,
                        resolved_at=now,
                        actual_direction=actual,
                    )
                )
        _state.pending = still_pending

    if _history_collection is not None:
        for rec in resolved_records:
            await _history_collection.update_one(
                {"id": rec.id},
                {
                    "$set": {
                        "outcome": rec.outcome,
                        "actual_price": rec.price_after,
                        "price_after": rec.price_after,
                        "resolved_at": rec.resolved_at,
                        "actual_direction": rec.actual_direction,
                        "status": "resolved",
                        "verdict": _verdict_label(rec.outcome),
                        "updated_at": _utcnow(),
                    }
                },
            )


async def _resolve_stale_mongo_logs() -> None:
    """Backfill pending Mongo rows whose resolve_at has passed (survives restarts)."""
    if _history_collection is None or len(_state.ticks) < 1:
        return
    now = _utcnow()
    try:
        docs = await _history_collection.find(
            {
                "status": "pending",
                "horizon_sec": 60,
                "resolve_at": {"$lte": now},
            },
            {"_id": 0, "id": 1, "direction": 1, "price_at": 1, "predicted_price": 1,
             "horizon_sec": 1},
        ).limit(80).to_list(length=80)
    except Exception as e:
        log.warning("nifty stale mongo scan failed: %s", e)
        return

    if not docs:
        return

    price_after = _state.ticks[-1].price
    for d in docs:
        pid = d.get("id")
        price_at = _f(d.get("price_at") if d.get("price_at") is not None else d.get("predicted_price"))
        if not pid or price_at is None:
            continue
        direction = d.get("direction") or "FLAT"
        horizon = int(d.get("horizon_sec") or 60)
        actual, outcome, pa = _resolve_one_outcome(
            direction=direction,
            price_at=float(price_at),
            price_after=float(price_after),
            horizon_sec=horizon,
        )
        try:
            await _history_collection.update_one(
                {"id": pid, "status": "pending"},
                {
                    "$set": {
                        "outcome": outcome,
                        "actual_price": pa,
                        "price_after": pa,
                        "resolved_at": now,
                        "actual_direction": actual,
                        "status": "resolved",
                        "verdict": _verdict_label(outcome),
                        "updated_at": now,
                    }
                },
            )
        except Exception as e:
            log.warning("nifty stale resolve failed id=%s: %s", pid, e)


def _maybe_record_prediction(
    horizon: int,
    direction: str,
    confidence: float,
    price: float,
) -> None:
    """Record a prediction if none pending for this horizon recently."""
    now = _utcnow()
    # Avoid stacking identical horizon predictions more often than ~horizon/2
    for p in _state.pending:
        if p.horizon_sec == horizon and (now - p.predicted_at).total_seconds() < max(2.0, horizon / 2):
            return

    pid = str(uuid.uuid4())
    rec = PredictionRecord(
        id=pid,
        horizon_sec=horizon,
        direction=direction,
        confidence=confidence,
        price_at=price,
        predicted_at=now,
    )
    _state.history.append(rec)
    _state.pending.append(
        PendingOutcome(
            id=pid,
            horizon_sec=horizon,
            direction=direction,
            price_at=price,
            predicted_at=now,
            resolve_at=now + timedelta(seconds=horizon),
        )
    )


def _verdict_label(outcome: Optional[str]) -> str:
    if outcome == "hit":
        return "correct"
    if outcome == "miss":
        return "wrong"
    if outcome == "flat":
        return "neutral"
    return "pending"


async def _persist_minute_prediction_if_due() -> None:
    """Upsert one Mongo row per IST minute during the open session.

    Always writes a row (including FLAT / abstain) so the 1m log table has no gaps.
    Every row is queued for actual-price resolution after 60s (FLAT → neutral verdict).
    """
    if _history_collection is None or len(_state.ticks) < 1:
        return
    now = _utcnow()
    minute_start = _minute_bucket(now)
    minute_key = _minute_key(now)

    async with _lock:
        if _state.last_minute_prediction_key == minute_key:
            return
        latest_tick = _state.ticks[-1] if _state.ticks else None
        if latest_tick is None:
            return

        features = _extract_features(_state.ticks) if len(_state.ticks) >= 2 else {
            "mom_5s": 0.0,
            "mom_10s": 0.0,
            "mom_30s": 0.0,
            "slope": 0.0,
            "vol": 0.0,
            "streak": 0.0,
            "bank_mom_bps": 0.0,
            "vix_mom_bps": 0.0,
            "volume_surge": 1.0,
            "spread_bps": _spread_bps(latest_tick),
            "range_position": _range_position(latest_tick),
            "from_open_bps": _from_open_bps(latest_tick),
        }
        direction, confidence, raw_score, abstain, engine, ml_extra = _predict_from_features(
            features, 60
        )
        if abstain or direction == "FLAT":
            direction = "FLAT"
            abstain = True

        signals = _build_signals(features, latest_tick)
        price = float(latest_tick.price)
        trading_date = _trading_date_str(minute_start)

        # Always create a dedicated log record (do not use _maybe_record_prediction —
        # its rate-limit can skip and leave gaps / wrong history[-1] linkage).
        pid = str(uuid.uuid4())
        predicted_at = now
        rec = PredictionRecord(
            id=pid,
            horizon_sec=60,
            direction=direction,
            confidence=confidence,
            price_at=price,
            predicted_at=predicted_at,
            trading_date=trading_date,
        )
        _state.history.append(rec)
        # Always queue for resolution (including FLAT) so actual_price is filled.
        _state.pending.append(
            PendingOutcome(
                id=pid,
                horizon_sec=60,
                direction=direction,
                price_at=price,
                predicted_at=predicted_at,
                resolve_at=predicted_at + timedelta(seconds=60),
            )
        )
        # Mark key only after we have a doc ready; cleared below if Mongo write fails.
        _state.last_minute_prediction_key = minute_key

        doc = {
            "id": pid,
            "symbol": SYMBOL,
            "name": "Nifty 50",
            "minute_key": minute_key,
            "trading_date": trading_date,
            "horizon_sec": 60,
            "direction": direction,
            "confidence": confidence,
            "score": raw_score,
            "abstain": abstain,
            "predicted_price": price,
            "price_at": price,
            "predicted_at": predicted_at,
            "resolve_at": predicted_at + timedelta(seconds=60),
            "actual_price": None,
            "price_after": None,
            "actual_direction": None,
            "outcome": None,
            "verdict": "pending",
            "status": "pending",
            "signals": signals,
            "features": {
                **features,
                "ewma_vol": _state.ewma_vol_bps,
                "session_frac": _session_fraction(now),
            },
            "engine": engine,
            "deadband_bps": ml_extra.get("deadband_bps"),
            "created_at": _utcnow(),
        }

    try:
        await _history_collection.update_one(
            {"minute_key": minute_key},
            {"$setOnInsert": doc, "$set": {"updated_at": _utcnow()}},
            upsert=True,
        )
        log.info(
            "nifty 1m log upserted minute_key=%s direction=%s engine=%s",
            minute_key,
            direction,
            engine,
        )
    except Exception as e:
        # Allow a retry later this same minute if Mongo was briefly unavailable.
        async with _lock:
            if _state.last_minute_prediction_key == minute_key:
                _state.last_minute_prediction_key = None
        log.warning("nifty 1m log persist failed (%s): %s", minute_key, e)


async def _poll_once() -> None:
    try:
        quotes = await ss.get_raw_quotes(BASKET_SYMBOLS)
        if quotes and quotes.get(SYMBOL):
            await _append_snapshot(quotes)
            _state.last_error = None
        else:
            _state.last_error = "no_quote"
    except Exception as e:
        _state.last_error = str(e)
        log.warning("nifty poll failed: %s", e)
    if _nse_session_status() == "open":
        await _persist_minute_prediction_if_due()
    await _resolve_pending()
    await _resolve_stale_mongo_logs()


async def _poll_loop() -> None:
    log.info(
        "Nifty prediction poller started (open=%ss, closed=%ss, basket=%s)",
        POLL_INTERVAL_SEC,
        POLL_INTERVAL_CLOSED_SEC,
        BASKET_SYMBOLS,
    )
    while True:
        sleep_sec = POLL_INTERVAL_SEC
        try:
            if _nse_session_status() == "open":
                await _poll_once()
            else:
                sleep_sec = POLL_INTERVAL_CLOSED_SEC
                # Still resolve overdue Mongo rows after the bell / on wake.
                await _resolve_pending()
                await _resolve_stale_mongo_logs()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("nifty poll loop error: %s", e)
        await asyncio.sleep(sleep_sec)


def start_poller() -> None:
    global _poll_task
    if _poll_task is not None and not _poll_task.done():
        return
    nm.try_load_models()
    _poll_task = asyncio.create_task(_poll_loop())


async def stop_poller() -> None:
    global _poll_task
    if _poll_task is None:
        return
    _poll_task.cancel()
    try:
        await _poll_task
    except asyncio.CancelledError:
        pass
    _poll_task = None


def _hit_stats(horizon: Optional[int] = None) -> Dict[str, Any]:
    scoped = [
        r for r in _state.history
        if (horizon is None or r.horizon_sec == horizon)
    ]
    scored = [r for r in scoped if r.outcome in ("hit", "miss")]
    flats = [r for r in scoped if r.outcome == "flat"]
    if not scored:
        return {
            "n": 0,
            "hits": 0,
            "misses": 0,
            "flats": len(flats),
            "hit_rate": None,
        }
    hits = sum(1 for r in scored if r.outcome == "hit")
    misses = sum(1 for r in scored if r.outcome == "miss")
    return {
        "n": len(scored),
        "hits": hits,
        "misses": misses,
        "flats": len(flats),
        "hit_rate": round(hits / len(scored), 4) if scored else None,
    }


def get_stats() -> Dict[str, Any]:
    by_horizon = {str(h): _hit_stats(h) for h in HORIZONS}
    baselines = nm.baseline_hit_rates(list(_state.history))
    return {
        "symbol": SYMBOL,
        "overall": _hit_stats(),
        "by_horizon": by_horizon,
        "baselines": baselines,
        "model_loaded": nm.get_models().is_ready(),
        "model_path": nm.get_models().loaded_path,
        "poll_count": _state.poll_count,
        "tick_count": len(_state.ticks),
        "ewma_vol_bps": round(_state.ewma_vol_bps, 4),
        "session": _nse_session_status(),
        "disclaimer": DISCLAIMER,
    }


async def get_history(limit: int = 50) -> Dict[str, Any]:
    limit = max(1, min(200, limit))
    if _history_collection is not None:
        docs = await _history_collection.find(
            {},
            {"_id": 0},
            sort=[("predicted_at", -1)],
            limit=limit,
        ).to_list(length=limit)
        return {
            "symbol": SYMBOL,
            "count": len(docs),
            "predictions": [
                {
                    "id": d["id"],
                    "horizon_sec": d.get("horizon_sec", 60),
                    "direction": d.get("direction"),
                    "confidence": d.get("confidence"),
                    "price_at": d.get("predicted_price", d.get("price_at")),
                    "predicted_at": d["predicted_at"].isoformat() if isinstance(d.get("predicted_at"), datetime) else d.get("predicted_at"),
                    "outcome": d.get("outcome"),
                    "price_after": d.get("actual_price", d.get("price_after")),
                    "resolved_at": d["resolved_at"].isoformat() if isinstance(d.get("resolved_at"), datetime) else d.get("resolved_at"),
                }
                for d in docs
            ],
            "disclaimer": DISCLAIMER,
        }
    items = list(_state.history)[-limit:]
    items.reverse()
    return {
        "symbol": SYMBOL,
        "count": len(items),
        "predictions": [
            {
                "id": r.id,
                "horizon_sec": r.horizon_sec,
                "direction": r.direction,
                "confidence": r.confidence,
                "price_at": r.price_at,
                "predicted_at": r.predicted_at.isoformat(),
                "outcome": r.outcome,
                "price_after": r.price_after,
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
            }
            for r in items
        ],
        "disclaimer": DISCLAIMER,
    }


async def list_log_dates(limit: int = 31) -> Dict[str, Any]:
    limit = max(1, min(180, limit))
    if _history_collection is None:
        dates = sorted({r.trading_date for r in _state.history if r.trading_date}, reverse=True)[:limit]
        return {"symbol": SYMBOL, "dates": dates}
    pipeline = [
        {"$group": {"_id": "$trading_date", "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}},
        {"$limit": limit},
    ]
    rows = await _history_collection.aggregate(pipeline).to_list(length=limit)
    return {
        "symbol": SYMBOL,
        "dates": [{"date": row["_id"], "count": row["count"]} for row in rows if row.get("_id")],
    }


async def get_logs_for_date(trading_date: str, limit: int = 500) -> Dict[str, Any]:
    limit = max(1, min(1000, limit))
    if _history_collection is None:
        items = [
            r for r in _state.history
            if r.trading_date == trading_date and r.horizon_sec == 60
        ]
        items.sort(key=lambda r: r.predicted_at)
        items = items[:limit]
        return {
            "symbol": SYMBOL,
            "date": trading_date,
            "count": len(items),
            "logs": [
                {
                    "id": r.id,
                    "predicted_at": r.predicted_at.isoformat(),
                    "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                    "predicted_price": r.price_at,
                    "actual_price": r.price_after,
                    "direction": r.direction,
                    "actual_direction": r.actual_direction,
                    "status": "resolved" if r.outcome else "pending",
                    "verdict": _verdict_label(r.outcome),
                    "outcome": r.outcome,
                }
                for r in items
            ],
            "disclaimer": DISCLAIMER,
        }

    docs = await _history_collection.find(
        {"trading_date": trading_date, "horizon_sec": 60},
        {"_id": 0},
        sort=[("predicted_at", ASCENDING)],
        limit=limit,
    ).to_list(length=limit)
    return {
        "symbol": SYMBOL,
        "date": trading_date,
        "count": len(docs),
        "logs": [
            {
                "id": d["id"],
                "predicted_at": d["predicted_at"].isoformat() if isinstance(d.get("predicted_at"), datetime) else d.get("predicted_at"),
                "resolved_at": d["resolved_at"].isoformat() if isinstance(d.get("resolved_at"), datetime) else d.get("resolved_at"),
                "predicted_price": d.get("predicted_price", d.get("price_at")),
                "actual_price": d.get("actual_price", d.get("price_after")),
                "direction": d.get("direction"),
                "actual_direction": d.get("actual_direction"),
                "status": d.get("status", "pending"),
                "verdict": d.get("verdict", "pending"),
                "outcome": d.get("outcome"),
            }
            for d in docs
        ],
        "disclaimer": DISCLAIMER,
    }


async def get_prediction(horizon: int = 10) -> Dict[str, Any]:
    if horizon not in HORIZONS:
        raise ValueError(f"horizon must be one of {HORIZONS}")

    # Ensure we have at least one fresh tick if buffer is empty
    if len(_state.ticks) < 2:
        await _poll_once()

    session = _nse_session_status()
    quote = _state.last_quote or {}
    price = quote.get("price")
    if price is None and _state.ticks:
        price = _state.ticks[-1].price

    features = _extract_features(_state.ticks) if _state.ticks else {}
    abstain = False
    engine = "rules"
    ml_extra: Dict[str, Any] = {}
    if features:
        features = {
            **features,
            "ewma_vol": _state.ewma_vol_bps,
            "session_frac": _session_fraction(),
        }
        direction, confidence, raw_score, abstain, engine, ml_extra = _predict_from_features(
            features, horizon
        )
    else:
        direction, confidence, raw_score = "FLAT", 0.0, 0.0
    latest_tick = _state.ticks[-1] if _state.ticks else None
    signals = _build_signals(features, latest_tick)

    if (
        session == "open"
        and price is not None
        and len(_state.ticks) >= 3
        and not abstain
        and direction in ("UP", "DOWN")
    ):
        async with _lock:
            _maybe_record_prediction(horizon, direction, confidence, float(price))

    ticks_out = [
        {"t": t.ts.isoformat(), "p": t.price}
        for t in list(_state.ticks)[-80:]
    ]

    horizon_stats = _hit_stats(horizon)
    band = ml_extra.get("deadband_bps") or nm.deadband_bps(_state.ewma_vol_bps, horizon)
    return {
        "symbol": SYMBOL,
        "name": "Nifty 50",
        "currency": "INR",
        "price": price,
        "change": quote.get("change"),
        "change_pct": quote.get("change_pct"),
        "horizon_sec": horizon,
        "direction": direction,
        "confidence": confidence,
        "score": raw_score,
        "abstain": abstain,
        "engine": engine,
        "deadband_bps": band,
        "prob_up": ml_extra.get("prob_up"),
        "meta_prob": ml_extra.get("meta_prob"),
        "features": features,
        "signals": signals,
        "as_of": _utcnow().isoformat(),
        "session": session,
        "ticks": ticks_out,
        "stats": {
            f"hit_rate_{horizon}s": horizon_stats.get("hit_rate"),
            "n": horizon_stats.get("n"),
            "hits": horizon_stats.get("hits"),
            "misses": horizon_stats.get("misses"),
            "flats": horizon_stats.get("flats"),
        },
        "poll_count": _state.poll_count,
        "last_error": _state.last_error,
        "disclaimer": DISCLAIMER,
    }
