"""Nifty pulse ML: feature enrichment, vol-scaled deadband, optional sklearn models.

Primary direction classifier + meta-label (trade vs abstain). Falls back to rule
scorer in prediction_service when no model file is loaded.
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

# Base deadband (bps); scaled up with EWMA vol and horizon.
MIN_DEADBAND_BPS = 0.5
DEADBAND_VOL_MULT = 0.35
# Meta P(hit) below this → abstain from the ML primary and let the caller
# fall back to the rules scorer (see prediction_service._predict_from_features).
META_ABSTAIN_THRESHOLD = 0.45

FEATURE_NAMES: List[str] = [
    "mom_5s_n",
    "mom_10s_n",
    "mom_30s_n",
    "slope_n",
    "streak_n",
    "bank_mom_n",
    "vix_mom_n",
    "volume_surge",
    "spread_bps",
    "range_position",
    "from_open_n",
    "vol",
    "ewma_vol",
    "session_frac",
]

_MODEL_ENV = "NIFTY_MODEL_PATH"
_DEFAULT_MODEL = Path(__file__).resolve().parent / "models" / "nifty_pulse.joblib"


def _vol_scale(vol: float) -> float:
    return max(1.0, vol)


def enrich_features(
    features: Dict[str, float],
    *,
    ewma_vol: float,
    session_frac: float,
) -> Dict[str, float]:
    """Add vol-normalized momentum and session context."""
    vol = max(0.0, features.get("vol", 0.0))
    scale = _vol_scale(vol)
    out = dict(features)
    out["ewma_vol"] = ewma_vol
    out["session_frac"] = session_frac
    out["mom_5s_n"] = features.get("mom_5s", 0.0) / scale
    out["mom_10s_n"] = features.get("mom_10s", 0.0) / scale
    out["mom_30s_n"] = features.get("mom_30s", 0.0) / scale
    out["slope_n"] = features.get("slope", 0.0) / scale
    out["streak_n"] = max(-5.0, min(5.0, features.get("streak", 0.0))) / 5.0
    out["bank_mom_n"] = features.get("bank_mom_bps", 0.0) / scale
    out["vix_mom_n"] = features.get("vix_mom_bps", 0.0) / scale
    out["from_open_n"] = features.get("from_open_bps", 0.0) / scale
    return out


def session_fraction_ist(local_hour: float) -> float:
    """0 at 09:15 IST, 1 at 15:30 IST (linear)."""
    open_m = 9 * 60 + 15
    close_m = 15 * 60 + 30
    now_m = local_hour * 60.0
    if now_m <= open_m:
        return 0.0
    if now_m >= close_m:
        return 1.0
    return (now_m - open_m) / (close_m - open_m)


def deadband_bps(ewma_vol: float, horizon_sec: int) -> float:
    """Vol-scaled minimum move to count as UP/DOWN (not FLAT)."""
    h = max(1, horizon_sec)
    vol_term = DEADBAND_VOL_MULT * max(ewma_vol, 0.0) * math.sqrt(h / 10.0)
    return max(MIN_DEADBAND_BPS, vol_term)


def move_bps(price_before: float, price_after: float) -> float:
    if price_before <= 0:
        return 0.0
    return ((price_after - price_before) / price_before) * 10000.0


def actual_direction_from_move(move: float, band_bps: float) -> str:
    if abs(move) < band_bps:
        return "FLAT"
    return "UP" if move > 0 else "DOWN"


def outcome_for_prediction(predicted: str, actual: str) -> str:
    if actual == "FLAT":
        return "flat"
    if predicted == "FLAT":
        return "flat"
    return "hit" if predicted == actual else "miss"


def features_vector(enriched: Dict[str, float]) -> np.ndarray:
    return np.array([[float(enriched.get(k, 0.0)) for k in FEATURE_NAMES]], dtype=np.float64)


@dataclass
class PredictResult:
    direction: str
    confidence: float
    score: float
    abstain: bool
    engine: str
    prob_up: Optional[float] = None
    meta_prob: Optional[float] = None
    deadband_bps: float = MIN_DEADBAND_BPS


class NiftyPulseModels:
    def __init__(self) -> None:
        self.primary = None
        self.meta = None
        self.loaded_path: Optional[str] = None

    def is_ready(self) -> bool:
        return self.primary is not None

    def load(self, path: Optional[str] = None) -> bool:
        p = Path(path or os.environ.get(_MODEL_ENV) or _DEFAULT_MODEL)
        if not p.is_file():
            return False
        try:
            import joblib

            bundle = joblib.load(p)
            self.primary = bundle.get("primary")
            self.meta = bundle.get("meta")
            self.loaded_path = str(p)
            log.info("Loaded Nifty pulse model from %s", p)
            return self.primary is not None
        except Exception as e:
            log.warning("Failed to load Nifty model %s: %s", p, e)
            return False

    def predict_ml(
        self,
        enriched: Dict[str, float],
        *,
        horizon_sec: int,
        ewma_vol: float,
    ) -> Optional[PredictResult]:
        if not self.is_ready():
            return None
        x = features_vector(enriched)
        band = deadband_bps(ewma_vol, horizon_sec)
        try:
            proba = self.primary.predict_proba(x)[0]
            classes = list(self.primary.classes_)
            p_up = float(proba[classes.index("UP")]) if "UP" in classes else 0.5
            p_down = float(proba[classes.index("DOWN")]) if "DOWN" in classes else 0.5
            direction = "UP" if p_up >= p_down else "DOWN"
            confidence = max(p_up, p_down) * 100.0
            score = (p_up - p_down) * 10.0

            meta_prob = None
            abstain = False
            if self.meta is not None:
                meta_prob = float(self.meta.predict_proba(x)[0][1])
                if meta_prob < META_ABSTAIN_THRESHOLD:
                    # Keep primary UP/DOWN for diagnostics; caller falls back to rules.
                    abstain = True
                    confidence = min(confidence, max(meta_prob, 0.0) * 100.0)

            return PredictResult(
                direction=direction,
                confidence=round(confidence, 1),
                score=round(score, 4),
                abstain=abstain,
                engine="ml",
                prob_up=round(p_up, 4),
                meta_prob=round(meta_prob, 4) if meta_prob is not None else None,
                deadband_bps=round(band, 3),
            )
        except Exception as e:
            log.warning("ML predict failed: %s", e)
            return None


_models = NiftyPulseModels()


def get_models() -> NiftyPulseModels:
    return _models


def try_load_models() -> bool:
    return _models.load()


def update_ewma_vol(prev: float, tick_return_bps: float, alpha: float = 0.15) -> float:
    """EWMA variance proxy in bps (GARCH-lite for deadband scaling)."""
    r2 = tick_return_bps * tick_return_bps
    prev2 = prev * prev
    var = alpha * r2 + (1.0 - alpha) * prev2
    return math.sqrt(max(var, 0.0))


def baseline_hit_rates(records: List[Any]) -> Dict[str, Any]:
    """Always-UP and persistence baselines on resolved directional rows."""
    directional = [
        r
        for r in records
        if getattr(r, "outcome", None) in ("hit", "miss")
        and getattr(r, "actual_direction", None) in ("UP", "DOWN")
    ]
    if not directional:
        return {"always_up": None, "persistence": None, "n": 0}

    n = len(directional)
    up_actual = sum(1 for r in directional if r.actual_direction == "UP")
    always_up = round(up_actual / n, 4)

    persist_hits = 0
    persist_n = 0
    last_actual: Optional[str] = None
    for r in directional:
        act = r.actual_direction
        if last_actual is not None:
            persist_n += 1
            if act == last_actual:
                persist_hits += 1
        last_actual = act
    persistence = round(persist_hits / persist_n, 4) if persist_n else None

    return {"always_up": always_up, "persistence": persistence, "n": n}
