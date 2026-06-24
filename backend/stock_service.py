"""Stock data service using Yahoo Finance public API directly with curl_cffi
(yfinance is broken on cloud IPs without browser impersonation)."""
from __future__ import annotations

import asyncio
import math
import time
import logging
import threading
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from cachetools import TTLCache
from curl_cffi import requests as cffi_req

from stock_universe import get_universe, get_indices, currency

log = logging.getLogger(__name__)

# Caches
QUOTE_CACHE = TTLCache(maxsize=2000, ttl=60)
INFO_CACHE = TTLCache(maxsize=2000, ttl=15 * 60)
HISTORY_CACHE = TTLCache(maxsize=2000, ttl=5 * 60)
BUNDLE_CACHE = TTLCache(maxsize=2000, ttl=120)
UNIVERSE_CACHE = TTLCache(maxsize=8, ttl=180)

# Yahoo session with browser impersonation
_session_lock = threading.Lock()
_session: Optional[cffi_req.Session] = None
_crumb: Optional[str] = None
_crumb_at: float = 0


def _get_session() -> cffi_req.Session:
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                _session = cffi_req.Session(impersonate="chrome", timeout=20)
                try:
                    _session.get("https://fc.yahoo.com/")
                except Exception:
                    pass
    return _session


def _get_crumb() -> str:
    global _crumb, _crumb_at
    # Refresh every 25 minutes
    if _crumb and (time.time() - _crumb_at < 25 * 60):
        return _crumb
    with _session_lock:
        if _crumb and (time.time() - _crumb_at < 25 * 60):
            return _crumb
        s = _get_session()
        try:
            s.get("https://fc.yahoo.com/")
            r = s.get("https://query1.finance.yahoo.com/v1/test/getcrumb")
            if r.status_code == 200 and r.text:
                _crumb = r.text.strip()
                _crumb_at = time.time()
        except Exception as e:
            log.warning(f"crumb fetch failed: {e}")
    return _crumb or ""


def _safe(v) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


# ---------- Yahoo HTTP layer ----------
def _yh_chart(symbol: str, rng: str = "1y", interval: str = "1d") -> Optional[Dict[str, Any]]:
    s = _get_session()
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        r = s.get(url, params={"range": rng, "interval": interval, "includePrePost": "false"})
        if r.status_code != 200:
            return None
        data = r.json().get("chart", {}).get("result")
        if not data:
            return None
        return data[0]
    except Exception as e:
        log.debug(f"chart {symbol} err: {e}")
        return None


def _yh_quote_summary(symbol: str) -> Dict[str, Any]:
    s = _get_session()
    crumb = _get_crumb()
    modules = "summaryDetail,defaultKeyStatistics,financialData,quoteType,price"
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
    try:
        r = s.get(url, params={"modules": modules, "crumb": crumb})
        if r.status_code != 200:
            return {}
        result = r.json().get("quoteSummary", {}).get("result", [])
        return result[0] if result else {}
    except Exception as e:
        log.debug(f"quoteSummary {symbol} err: {e}")
        return {}


def _chart_to_df(chart: Dict[str, Any]) -> pd.DataFrame:
    if not chart:
        return pd.DataFrame()
    ts = chart.get("timestamp") or []
    inds = chart.get("indicators", {}).get("quote", [{}])[0]
    opens = inds.get("open") or []
    highs = inds.get("high") or []
    lows = inds.get("low") or []
    closes = inds.get("close") or []
    vols = inds.get("volume") or []
    if not ts or not closes:
        return pd.DataFrame()
    df = pd.DataFrame({
        "ts": pd.to_datetime(ts, unit="s", utc=True),
        "Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": vols,
    }).set_index("ts")
    return df.dropna(subset=["Close"])


# ---------- Technical Indicators ----------
def _compute_technicals(df: pd.DataFrame) -> Dict[str, Optional[float]]:
    out = {
        "rsi": None, "macd": None, "macd_signal": None,
        "ma50": None, "ma200": None, "volume_surge": None,
        "high_52w": None, "low_52w": None, "from_52w_high_pct": None,
    }
    if df is None or df.empty:
        return out
    close = df["Close"].dropna()
    vol = df["Volume"].dropna() if "Volume" in df else pd.Series(dtype=float)

    if len(close) >= 15:
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        out["rsi"] = _safe(rsi.iloc[-1])

    if len(close) >= 26:
        e12 = close.ewm(span=12, adjust=False).mean()
        e26 = close.ewm(span=26, adjust=False).mean()
        macd_line = e12 - e26
        signal = macd_line.ewm(span=9, adjust=False).mean()
        out["macd"] = _safe(macd_line.iloc[-1])
        out["macd_signal"] = _safe(signal.iloc[-1])

    if len(close) >= 50:
        out["ma50"] = _safe(close.rolling(50).mean().iloc[-1])
    if len(close) >= 200:
        out["ma200"] = _safe(close.rolling(200).mean().iloc[-1])

    if len(vol) >= 20:
        avg = vol.rolling(20).mean().iloc[-1]
        last = vol.iloc[-1]
        if avg and avg > 0:
            out["volume_surge"] = _safe(last / avg)

    window = close.tail(252) if len(close) >= 252 else close
    hi = window.max(); lo = window.min(); last = _safe(close.iloc[-1])
    out["high_52w"] = _safe(hi); out["low_52w"] = _safe(lo)
    if last and hi and hi > 0:
        out["from_52w_high_pct"] = _safe((last - hi) / hi * 100)
    return out


# ---------- Bundle (quote + fundamentals + technicals) ----------
def _fetch_bundle(symbol: str) -> Dict[str, Any]:
    if symbol in BUNDLE_CACHE:
        return BUNDLE_CACHE[symbol]

    chart = _yh_chart(symbol, rng="1y", interval="1d")
    if not chart:
        return {"symbol": symbol, "error": "no_data"}

    df = _chart_to_df(chart)
    if df.empty:
        return {"symbol": symbol, "error": "no_data"}

    meta = chart.get("meta", {})
    close = df["Close"].dropna()
    last = _safe(meta.get("regularMarketPrice")) or _safe(close.iloc[-1])
    prev = _safe(meta.get("previousClose"))
    if prev is None and len(close) >= 2:
        prev = _safe(close.iloc[-2])
    change = (last - prev) if (last is not None and prev is not None) else None
    change_pct = (change / prev * 100) if (change is not None and prev) else None
    spark = [round(x, 4) for x in close.tail(30).tolist() if not (isinstance(x, float) and math.isnan(x))]
    tech = _compute_technicals(df)

    summary = _yh_quote_summary(symbol)
    sd = summary.get("summaryDetail", {}) or {}
    ks = summary.get("defaultKeyStatistics", {}) or {}
    fd = summary.get("financialData", {}) or {}
    price_m = summary.get("price", {}) or {}
    qt = summary.get("quoteType", {}) or {}

    roe_raw = _safe(fd.get("returnOnEquity"))
    dy_raw = _safe(sd.get("dividendYield"))
    eg_raw = _safe(fd.get("earningsGrowth"))
    rg_raw = _safe(fd.get("revenueGrowth"))
    pm_raw = _safe(fd.get("profitMargins"))

    bundle = {
        "symbol": symbol,
        "name": qt.get("longName") or qt.get("shortName") or price_m.get("longName") or meta.get("longName") or symbol,
        "sector": (summary.get("assetProfile", {}) or {}).get("sector"),
        "industry": (summary.get("assetProfile", {}) or {}).get("industry"),
        "currency": meta.get("currency") or ("INR" if symbol.endswith(".NS") else "USD"),
        "exchange": meta.get("exchangeName"),
        "price": last,
        "change": _safe(change),
        "change_pct": _safe(change_pct),
        "market_cap": _safe(sd.get("marketCap")) or _safe(price_m.get("marketCap")),
        "pe": _safe(sd.get("trailingPE")),
        "forward_pe": _safe(sd.get("forwardPE")),
        "pb": _safe(ks.get("priceToBook")),
        "roe": (roe_raw * 100) if roe_raw is not None else None,
        "debt_to_equity": _safe(fd.get("debtToEquity")),
        "dividend_yield": (dy_raw if dy_raw and dy_raw > 1 else (dy_raw * 100 if dy_raw is not None else None)),
        "eps": _safe(ks.get("trailingEps")),
        "eps_growth": (eg_raw * 100) if eg_raw is not None else None,
        "revenue_growth": (rg_raw * 100) if rg_raw is not None else None,
        "profit_margin": (pm_raw * 100) if pm_raw is not None else None,
        "beta": _safe(ks.get("beta")),
        "sparkline": spark,
        **tech,
    }
    BUNDLE_CACHE[symbol] = bundle
    return bundle


async def get_bundle(symbol: str) -> Dict[str, Any]:
    return await asyncio.to_thread(_fetch_bundle, symbol)


async def get_bundles(symbols: List[str], concurrency: int = 8) -> List[Dict[str, Any]]:
    sem = asyncio.Semaphore(concurrency)

    async def _one(sym):
        async with sem:
            return await get_bundle(sym)

    res = await asyncio.gather(*[_one(s) for s in symbols])
    return [r for r in res if r and not r.get("error")]


# ---------- Quote-only (fast) ----------
def _fetch_quote(symbol: str) -> Dict[str, Any]:
    if symbol in QUOTE_CACHE:
        return QUOTE_CACHE[symbol]
    chart = _yh_chart(symbol, rng="1mo", interval="1d")
    if not chart:
        return {"symbol": symbol, "error": "no_data"}
    df = _chart_to_df(chart)
    if df.empty:
        return {"symbol": symbol, "error": "no_data"}
    meta = chart.get("meta", {})
    close = df["Close"].dropna()
    last = _safe(meta.get("regularMarketPrice")) or _safe(close.iloc[-1])
    prev = _safe(meta.get("previousClose"))
    if prev is None and len(close) >= 2:
        prev = _safe(close.iloc[-2])
    change = (last - prev) if (last is not None and prev is not None) else None
    change_pct = (change / prev * 100) if (change is not None and prev) else None
    spark = [round(x, 4) for x in close.tail(30).tolist() if not (isinstance(x, float) and math.isnan(x))]
    out = {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "price": last,
        "change": _safe(change),
        "change_pct": _safe(change_pct),
        "sparkline": spark,
        "currency": meta.get("currency") or ("INR" if symbol.endswith(".NS") else "USD"),
    }
    QUOTE_CACHE[symbol] = out
    return out


async def get_quote(symbol: str) -> Dict[str, Any]:
    return await asyncio.to_thread(_fetch_quote, symbol)


async def get_quotes(symbols: List[str], concurrency: int = 8) -> List[Dict[str, Any]]:
    sem = asyncio.Semaphore(concurrency)

    async def _one(sym):
        async with sem:
            return await get_quote(sym)

    res = await asyncio.gather(*[_one(s) for s in symbols])
    return [r for r in res if r and not r.get("error")]


# ---------- Indices / Universe ----------
async def get_market_indices(market: str) -> List[Dict[str, Any]]:
    idx_map = get_indices(market)
    quotes = await get_quotes(list(idx_map.keys()))
    for q in quotes:
        q["name"] = idx_map.get(q["symbol"], q["symbol"])
    return quotes


async def get_market_universe(market: str) -> List[Dict[str, Any]]:
    key = f"universe:{market.upper()}"
    if key in UNIVERSE_CACHE:
        return UNIVERSE_CACHE[key]
    syms = get_universe(market)
    bundles = await get_bundles(syms, concurrency=10)
    UNIVERSE_CACHE[key] = bundles
    return bundles


# ---------- History ----------
def _fetch_history(symbol: str, period: str, interval: str) -> List[Dict[str, Any]]:
    key = f"{symbol}:{period}:{interval}"
    if key in HISTORY_CACHE:
        return HISTORY_CACHE[key]
    chart = _yh_chart(symbol, rng=period, interval=interval)
    if not chart:
        return []
    df = _chart_to_df(chart)
    if df.empty:
        return []
    out = []
    for ts, row in df.iterrows():
        out.append({
            "t": ts.isoformat(),
            "o": _safe(row.get("Open")),
            "h": _safe(row.get("High")),
            "l": _safe(row.get("Low")),
            "c": _safe(row.get("Close")),
            "v": _safe(row.get("Volume")),
        })
    HISTORY_CACHE[key] = out
    return out


async def get_history(symbol: str, period: str = "1mo", interval: str = "1d"):
    return await asyncio.to_thread(_fetch_history, symbol, period, interval)


# ---------- Radar Strategies ----------
RADAR_STRATEGIES = {
    "momentum_breakouts": {
        "title": "Momentum Breakouts",
        "subtitle": "Strong uptrend with volume surge near 52w highs",
        "icon": "trending-up",
    },
    "value_picks": {
        "title": "Value Picks",
        "subtitle": "Low P/E and P/B with healthy ROE",
        "icon": "trophy",
    },
    "high_roce_low_debt": {
        "title": "Quality Compounders",
        "subtitle": "High ROE, low debt, steady margins",
        "icon": "shield-checkmark",
    },
    "oversold_quality": {
        "title": "Oversold Quality",
        "subtitle": "RSI under 40 on fundamentally strong names",
        "icon": "pulse",
    },
    "multibaggers": {
        "title": "Multibagger Radar",
        "subtitle": "High EPS + revenue growth with reasonable PE",
        "icon": "rocket",
    },
    "fifty_two_week_high": {
        "title": "52-Week Breakouts",
        "subtitle": "Trading within 3% of 52-week high",
        "icon": "ribbon",
    },
    "dividend_aristocrats": {
        "title": "Dividend Aristocrats",
        "subtitle": "Healthy yield with stable fundamentals",
        "icon": "cash",
    },
    "golden_cross": {
        "title": "Golden Cross",
        "subtitle": "Price above 50DMA above 200DMA",
        "icon": "git-merge",
    },
}


def _apply_strategy(stocks: List[Dict[str, Any]], strategy: str) -> List[Dict[str, Any]]:
    s = strategy.lower()
    res = []
    for st in stocks:
        ok = False
        if s == "momentum_breakouts":
            ok = (
                55 <= (st.get("rsi") or 0) <= 75
                and (st.get("volume_surge") or 0) >= 1.2
                and (st.get("from_52w_high_pct") or -100) >= -12
            )
        elif s == "value_picks":
            ok = (
                (st.get("pe") or 999) < 22
                and (st.get("pb") or 999) < 4
                and (st.get("roe") or 0) >= 10
            )
        elif s == "high_roce_low_debt":
            de = st.get("debt_to_equity")
            ok = (st.get("roe") or 0) >= 18 and (de is not None and de < 80)
        elif s == "oversold_quality":
            ok = (
                (st.get("rsi") or 100) < 40
                and (st.get("roe") or 0) >= 10
                and (st.get("pe") or 999) < 50
            )
        elif s == "multibaggers":
            ok = (
                (st.get("eps_growth") or -100) >= 15
                and (st.get("revenue_growth") or -100) >= 10
                and (st.get("pe") or 999) < 60
            )
        elif s == "fifty_two_week_high":
            ok = (st.get("from_52w_high_pct") or -100) >= -3
        elif s == "dividend_aristocrats":
            ok = (st.get("dividend_yield") or 0) >= 2 and (st.get("roe") or 0) >= 8
        elif s == "golden_cross":
            p, m50, m200 = st.get("price"), st.get("ma50"), st.get("ma200")
            ok = bool(p and m50 and m200 and p > m50 > m200)
        if ok:
            res.append(st)
    return res


async def run_radar(strategy: str, market: str) -> Dict[str, Any]:
    universe = await get_market_universe(market)
    matches = _apply_strategy(universe, strategy)
    meta = RADAR_STRATEGIES.get(strategy, {"title": strategy, "subtitle": ""})
    if strategy in ("momentum_breakouts", "fifty_two_week_high", "golden_cross"):
        matches.sort(key=lambda x: (x.get("change_pct") or -999), reverse=True)
    elif strategy in ("value_picks", "oversold_quality"):
        matches.sort(key=lambda x: (x.get("pe") or 9999))
    elif strategy == "dividend_aristocrats":
        matches.sort(key=lambda x: (x.get("dividend_yield") or 0), reverse=True)
    else:
        matches.sort(key=lambda x: (x.get("roe") or -999), reverse=True)
    return {
        "strategy": strategy,
        "title": meta["title"],
        "subtitle": meta["subtitle"],
        "icon": meta.get("icon"),
        "count": len(matches),
        "market": market.upper(),
        "currency": currency(market),
        "stocks": matches,
    }


async def get_movers(market: str, mover_type: str = "gainers", limit: int = 15):
    universe = await get_market_universe(market)
    universe = [x for x in universe if x.get("change_pct") is not None]
    if mover_type == "losers":
        universe = sorted(universe, key=lambda x: x.get("change_pct") or 0)
    else:
        universe = sorted(universe, key=lambda x: x.get("change_pct") or 0, reverse=True)
    return universe[:limit]


def custom_screen(stocks: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    res = []
    for st in stocks:
        ok = True
        for metric, rng in (filters or {}).items():
            if metric == "sector":
                if rng and (st.get("sector") or "").lower() != str(rng).lower():
                    ok = False; break
                continue
            val = st.get(metric)
            if val is None:
                ok = False; break
            lo = rng.get("min") if isinstance(rng, dict) else None
            hi = rng.get("max") if isinstance(rng, dict) else None
            if lo is not None and val < lo: ok = False; break
            if hi is not None and val > hi: ok = False; break
        if ok:
            res.append(st)
    return res
