#!/usr/bin/env python3
"""Train Nifty pulse primary + meta-label models from Mongo prediction logs.

Usage (from backend-v2, with .env loaded):
  python scripts/train_nifty_pulse_model.py
  python scripts/train_nifty_pulse_model.py --days 30 --out models/nifty_pulse.joblib
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Allow running as script from backend-v2
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

load_dotenv(_ROOT / ".env")

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import joblib
import nifty_ml as nm
from motor.motor_asyncio import AsyncIOMotorClient


def _label_row(doc: dict) -> tuple[str | None, str | None]:
    """Return (direction_label UP/DOWN, meta_label 0/1) or (None, None) if skip."""
    p0 = doc.get("predicted_price") or doc.get("price_at")
    p1 = doc.get("actual_price") or doc.get("price_after")
    if p0 is None or p1 is None:
        return None, None
    try:
        p0, p1 = float(p0), float(p1)
    except (TypeError, ValueError):
        return None, None
    horizon = int(doc.get("horizon_sec") or 60)
    feats = doc.get("features") or {}
    ewma = float(feats.get("ewma_vol") or feats.get("vol") or 1.0)
    band = nm.deadband_bps(ewma, horizon)
    move = nm.move_bps(p0, p1)
    actual = nm.actual_direction_from_move(move, band)
    if actual == "FLAT":
        return None, None
    pred_dir = doc.get("direction")
    if pred_dir not in ("UP", "DOWN"):
        return None, None
    meta = 1 if pred_dir == actual else 0
    return actual, meta


def _enrich_from_doc(doc: dict) -> dict | None:
    feats = doc.get("features")
    if not isinstance(feats, dict) or not feats:
        return None
    ewma = float(feats.get("ewma_vol") or feats.get("vol") or 1.0)
    session_frac = float(feats.get("session_frac") or 0.5)
    return nm.enrich_features(feats, ewma_vol=ewma, session_frac=session_frac)


async def fetch_docs(db_name: str, mongo_url: str, days: int, limit: int):
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    coll = db.nifty_prediction_logs
    cursor = coll.find(
        {"outcome": {"$in": ["hit", "miss", "flat"]}, "features": {"$exists": True}},
        {"_id": 0},
    ).sort("predicted_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


def train(docs: list) -> dict:
    x_rows: list[list[float]] = []
    y_dir: list[str] = []
    y_meta: list[int] = []
    rule_dirs: list[str] = []

    for doc in docs:
        enriched = _enrich_from_doc(doc)
        if enriched is None:
            continue
        label, meta = _label_row(doc)
        if label is None:
            continue
        x_rows.append([float(enriched.get(k, 0.0)) for k in nm.FEATURE_NAMES])
        y_dir.append(label)
        y_meta.append(meta)
        rd = doc.get("direction")
        if rd in ("UP", "DOWN"):
            rule_dirs.append(rd)

    if len(x_rows) < 40:
        raise SystemExit(
            f"Need at least 40 labelled samples with non-flat moves; got {len(x_rows)}. "
            "Run the backend during market hours to accumulate Mongo logs, then retry."
        )

    x = np.array(x_rows, dtype=np.float64)
    y = np.array(y_dir)

    primary = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "clf",
                LogisticRegression(
                    max_iter=500,
                    class_weight="balanced",
                    random_state=42,
                ),
            ),
        ]
    )
    primary.fit(x, y)

    # Meta: predict whether rule direction (from log) would have been correct
    meta_x = []
    meta_y = []
    idx = 0
    for doc in docs:
        enriched = _enrich_from_doc(doc)
        if enriched is None:
            continue
        label, meta = _label_row(doc)
        if label is None:
            continue
        meta_x.append([float(enriched.get(k, 0.0)) for k in nm.FEATURE_NAMES])
        pred = doc.get("direction")
        meta_y.append(1 if pred in ("UP", "DOWN") and pred == label else 0)
        idx += 1

    meta_model = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "clf",
                LogisticRegression(max_iter=500, class_weight="balanced", random_state=43),
            ),
        ]
    )
    meta_model.fit(np.array(meta_x), np.array(meta_y))

    return {"primary": primary, "meta": meta_model, "n_samples": len(x_rows)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(_ROOT / "models" / "nifty_pulse.joblib"))
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()

    mongo_url = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URI")
    db_name = os.environ.get("DB_NAME", "scang")
    if not mongo_url:
        raise SystemExit("Set MONGO_URL in .env")

    docs = asyncio.run(fetch_docs(db_name, mongo_url, 30, args.limit))
    bundle = train(docs)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out)
    print(f"Wrote {out} ({bundle['n_samples']} samples)")


if __name__ == "__main__":
    main()
