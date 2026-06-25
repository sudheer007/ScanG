"""Stock data service using Yahoo Finance public APIs directly with curl_cffi.

Strategy for handling large universes (~500 tickers):
- `_yh_quote_batch`: v7/finance/quote with crumb — fetches up to 100 tickers per call
  (gives price, %change, marketCap, PE, P/B, div yield, 52w high/low, volume, name)
- `_yh_chart`: per-symbol daily history → sparkline + RSI/MACD/MA50/MA200/volume_surge
- `_yh_quote_summary`: per-symbol fundamentals → ROE, D/E, EPS growth, revenue growth
- Bundles merge all three. Caches are layered so radar/screen render fast even mid-fetch.
"""
from __future__ import annotations

import asyncio
import math
import time
import logging
import threading
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from cachetools import TTLCache
from curl_cffi import requests as cffi_req

from stock_universe import get_universe, get_indices, currency

log = logging.getLogger(__name__)

# Caches
QUOTE_BATCH_CACHE = TTLCache(maxsize=4, ttl=120)             # 2 min for full quote batch
CHART_CACHE = TTLCache(maxsize=4000, ttl=300)                # 5 min charts
SUMMARY_CACHE = TTLCache(maxsize=4000, ttl=60 * 60)          # 60 min fundamentals
HISTORY_CACHE = TTLCache(maxsize=2000, ttl=5 * 60)           # 5 min OHLCV history
BUNDLE_CACHE = TTLCache(maxsize=4000, ttl=120)
UNIVERSE_BUNDLE_CACHE = TTLCache(maxsize=4, ttl=120)

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
    modules = "summaryDetail,defaultKeyStatistics,financialData,quoteType,assetProfile,price,recommendationTrend,upgradeDowngradeHistory,calendarEvents,earnings,earningsHistory,earningsTrend,institutionOwnership,insiderHolders"
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


def _yh_quote_batch(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Yahoo v7 quote batch (up to ~100 symbols per call). Returns dict by symbol."""
    if not symbols:
        return {}
    global _crumb, _crumb_at
    s = _get_session()
    crumb = _get_crumb()
    out: Dict[str, Dict[str, Any]] = {}
    chunk = 75
    for i in range(0, len(symbols), chunk):
        batch = symbols[i:i + chunk]
        url = "https://query1.finance.yahoo.com/v7/finance/quote"
        for attempt in range(2):
            try:
                r = s.get(url, params={"symbols": ",".join(batch), "crumb": crumb})
                if r.status_code == 401 and attempt == 0:
                    # Invalidate crumb and retry once
                    with _session_lock:
                        _crumb = None
                        _crumb_at = 0
                    crumb = _get_crumb()
                    continue
                if r.status_code != 200:
                    log.warning(f"quote batch {r.status_code}: {r.text[:120]}")
                    break
                results = r.json().get("quoteResponse", {}).get("result", [])
                for q in results:
                    out[q.get("symbol")] = q
                break
            except Exception as e:
                log.warning(f"quote batch err: {e}")
                break
    return out


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


# ---------- Technicals ----------
def _compute_technicals(df: pd.DataFrame) -> Dict[str, Optional[float]]:
    out = {
        "rsi": None, "macd": None, "macd_signal": None,
        "ma50": None, "ma200": None, "volume_surge": None,
        "high_52w": None, "low_52w": None, "from_52w_high_pct": None,
        "from_52w_low_pct": None, "atr": None,
        "one_year_change_pct": None, "ytd_pct": None,
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
    if last and lo and lo > 0:
        out["from_52w_low_pct"] = _safe((last - lo) / lo * 100)

    # ATR(14) — average true range
    if {"High", "Low"}.issubset(df.columns) and len(close) >= 15:
        try:
            high = df["High"]; low = df["Low"]; prev_close = df["Close"].shift(1)
            tr = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
            out["atr"] = _safe(tr.rolling(14).mean().iloc[-1])
        except Exception:
            pass

    # 1-year change %
    if len(close) >= 2:
        first = _safe(close.iloc[0])
        if first and first > 0 and last:
            out["one_year_change_pct"] = _safe((last - first) / first * 100)

    # YTD %
    try:
        year = pd.Timestamp.utcnow().year
        jan1 = pd.Timestamp(year=year, month=1, day=1, tz="UTC")
        ytd = close[close.index >= jan1]
        if len(ytd) >= 1 and last:
            base = _safe(ytd.iloc[0])
            if base and base > 0:
                out["ytd_pct"] = _safe((last - base) / base * 100)
    except Exception:
        pass

    return out


# ---------- Layered fetchers ----------
def _fetch_chart_layer(symbol: str) -> Dict[str, Any]:
    """Returns sparkline + technicals + last/prev close (from chart only)."""
    if symbol in CHART_CACHE:
        return CHART_CACHE[symbol]
    chart = _yh_chart(symbol, rng="1y", interval="1d")
    if not chart:
        out = {"available": False}
        CHART_CACHE[symbol] = out
        return out
    df = _chart_to_df(chart)
    if df.empty:
        out = {"available": False}
        CHART_CACHE[symbol] = out
        return out
    meta = chart.get("meta", {})
    close = df["Close"].dropna()
    tech = _compute_technicals(df)
    spark = [round(x, 4) for x in close.tail(30).tolist() if not (isinstance(x, float) and math.isnan(x))]
    out = {
        "available": True,
        "exchange": meta.get("exchangeName"),
        "currency_chart": meta.get("currency"),
        "sparkline": spark,
        **tech,
    }
    CHART_CACHE[symbol] = out
    return out


def _fetch_summary_layer(symbol: str) -> Dict[str, Any]:
    if symbol in SUMMARY_CACHE:
        return SUMMARY_CACHE[symbol]
    summary = _yh_quote_summary(symbol)
    if not summary:
        SUMMARY_CACHE[symbol] = {}
        return {}
    sd = summary.get("summaryDetail", {}) or {}
    ks = summary.get("defaultKeyStatistics", {}) or {}
    fd = summary.get("financialData", {}) or {}
    ap = summary.get("assetProfile", {}) or {}
    qt = summary.get("quoteType", {}) or {}
    rt = summary.get("recommendationTrend", {}) or {}
    udh = summary.get("upgradeDowngradeHistory", {}) or {}
    ce = summary.get("calendarEvents", {}) or {}
    eh = summary.get("earningsHistory", {}) or {}
    et = summary.get("earningsTrend", {}) or {}
    iho = summary.get("institutionOwnership", {}) or {}
    ins_h = summary.get("insiderHolders", {}) or {}

    roe_raw = _safe(fd.get("returnOnEquity"))
    dy_raw = _safe(sd.get("dividendYield"))
    eg_raw = _safe(fd.get("earningsGrowth"))
    rg_raw = _safe(fd.get("revenueGrowth"))
    pm_raw = _safe(fd.get("profitMargins"))

    # ---- Real analyst ratings ----
    rt_trend = rt.get("trend") or []
    # latest period (0m = current)
    latest_trend = None
    for entry in rt_trend:
        if entry.get("period") == "0m":
            latest_trend = entry; break
    if not latest_trend and rt_trend:
        latest_trend = rt_trend[0]
    rating_dist = None
    total_analysts_rt = None
    if latest_trend:
        sb = int(latest_trend.get("strongBuy") or 0)
        b = int(latest_trend.get("buy") or 0)
        h = int(latest_trend.get("hold") or 0)
        sl = int(latest_trend.get("sell") or 0)
        ssl = int(latest_trend.get("strongSell") or 0)
        total = sb + b + h + sl + ssl
        if total > 0:
            rating_dist = {
                "strong_buy": round(sb * 100 / total),
                "buy": round(b * 100 / total),
                "hold": round(h * 100 / total),
                "sell": round((sl + ssl) * 100 / total),
                "counts": {"strong_buy": sb, "buy": b, "hold": h, "sell": sl, "strong_sell": ssl, "total": total},
            }
            total_analysts_rt = total

    # ---- Latest upgrade/downgrade ----
    udh_hist = udh.get("history") or []
    latest_ud = None
    if udh_hist:
        # sort by epochGradeDate desc
        try:
            udh_sorted = sorted(udh_hist, key=lambda x: x.get("epochGradeDate") or 0, reverse=True)
            top = udh_sorted[0]
            latest_ud = {
                "date_epoch": top.get("epochGradeDate"),
                "firm": top.get("firm"),
                "from_grade": top.get("fromGrade"),
                "to_grade": top.get("toGrade"),
                "action": top.get("action"),
            }
        except Exception:
            pass

    # ---- Calendar events: earnings + dividends ----
    earnings_cal = ce.get("earnings") or {}
    earnings_dates = earnings_cal.get("earningsDate") or []
    next_earnings_epoch = None
    if earnings_dates:
        ed = earnings_dates[0]
        if isinstance(ed, dict): next_earnings_epoch = ed.get("raw")
        elif isinstance(ed, (int, float)): next_earnings_epoch = ed

    ex_div = ce.get("exDividendDate")
    if isinstance(ex_div, dict): ex_div_epoch = ex_div.get("raw")
    else: ex_div_epoch = ex_div if isinstance(ex_div, (int, float)) else None

    div_date = ce.get("dividendDate")
    if isinstance(div_date, dict): div_date_epoch = div_date.get("raw")
    else: div_date_epoch = div_date if isinstance(div_date, (int, float)) else None

    # ---- Earnings history surprise % (latest) ----
    eh_arr = eh.get("history") or []
    latest_eps_surprise_pct = None
    if eh_arr:
        last = eh_arr[-1]
        latest_eps_surprise_pct = _safe(last.get("surprisePercent"))

    # ---- Earnings trend projections ----
    et_trend = et.get("trend") or []
    eps_growth_next_year = None
    revenue_growth_next_year = None
    for e in et_trend:
        if e.get("period") == "+1y":
            eps_growth_next_year = _safe((e.get("growth") or {}).get("raw"))
            revenue_growth_next_year = _safe((e.get("revenueEstimate", {}) or {}).get("growth"))
            break

    # ---- Ownership ----
    pct_institutions = _safe(ks.get("heldPercentInstitutions"))
    pct_insiders = _safe(ks.get("heldPercentInsiders"))
    top_institution = None
    iho_arr = iho.get("ownershipList") or []
    if iho_arr:
        top = iho_arr[0]
        top_institution = {
            "organization": top.get("organization"),
            "pct_held": _safe(top.get("pctHeld")),
        }

    out = {
        "sector": ap.get("sector"),
        "industry": ap.get("industry"),
        "long_name": qt.get("longName"),
        "description": ap.get("longBusinessSummary"),
        "website": ap.get("website"),
        "country": ap.get("country"),
        "city": ap.get("city"),
        "employees": _safe(ap.get("fullTimeEmployees")),
        "pb": _safe(ks.get("priceToBook")),
        "roe": (roe_raw * 100) if roe_raw is not None else None,
        "debt_to_equity": _safe(fd.get("debtToEquity")),
        "dividend_yield_summary": (dy_raw if dy_raw and dy_raw > 1 else (dy_raw * 100 if dy_raw is not None else None)),
        "eps": _safe(ks.get("trailingEps")),
        "eps_growth": (eg_raw * 100) if eg_raw is not None else None,
        "revenue_growth": (rg_raw * 100) if rg_raw is not None else None,
        "profit_margin": (pm_raw * 100) if pm_raw is not None else None,
        "operating_margin": _safe(fd.get("operatingMargins")),
        "gross_margin": _safe(fd.get("grossMargins")),
        "current_ratio": _safe(fd.get("currentRatio")),
        "quick_ratio": _safe(fd.get("quickRatio")),
        "free_cashflow": _safe(fd.get("freeCashflow")),
        "operating_cashflow": _safe(fd.get("operatingCashflow")),
        "total_cash": _safe(fd.get("totalCash")),
        "total_debt": _safe(fd.get("totalDebt")),
        "total_revenue": _safe(fd.get("totalRevenue")),
        "ebitda": _safe(fd.get("ebitda")),
        "roa": _safe(fd.get("returnOnAssets")) * 100 if _safe(fd.get("returnOnAssets")) is not None else None,
        "beta": _safe(ks.get("beta")),
        "forward_pe": _safe(sd.get("forwardPE")),
        "peg_ratio": _safe(ks.get("pegRatio")),
        "ps_ratio": _safe(sd.get("priceToSalesTrailing12Months")),
        # --- Extra valuation / size (available from Yahoo) ---
        "enterprise_value": _safe(ks.get("enterpriseValue")),
        "ev_ebitda": _safe(ks.get("enterpriseToEbitda")),
        "ev_sales": _safe(ks.get("enterpriseToRevenue")),
        "book_value_per_share": _safe(ks.get("bookValue")),
        "float_shares": _safe(ks.get("floatShares")),
        "shares_outstanding": _safe(ks.get("sharesOutstanding")),
        "payout_ratio": (_safe(sd.get("payoutRatio")) * 100) if _safe(sd.get("payoutRatio")) is not None else None,
        # --- REAL analyst data ---
        "target_mean_price": _safe(fd.get("targetMeanPrice")),
        "target_high_price": _safe(fd.get("targetHighPrice")),
        "target_low_price": _safe(fd.get("targetLowPrice")),
        "target_median_price": _safe(fd.get("targetMedianPrice")),
        "recommendation_mean": _safe(fd.get("recommendationMean")),
        "recommendation_key": fd.get("recommendationKey"),
        "analyst_count": int(_safe(fd.get("numberOfAnalystOpinions")) or total_analysts_rt or 0) or None,
        "rating_distribution": rating_dist,
        "latest_upgrade_downgrade": latest_ud,
        # --- Calendar ---
        "next_earnings_epoch": next_earnings_epoch,
        "ex_dividend_epoch": ex_div_epoch,
        "dividend_date_epoch": div_date_epoch,
        # --- Earnings perf ---
        "latest_eps_surprise_pct": latest_eps_surprise_pct,
        "eps_growth_next_year_pct": (eps_growth_next_year * 100) if (eps_growth_next_year is not None and abs(eps_growth_next_year) < 10) else eps_growth_next_year,
        "revenue_growth_next_year_pct": (revenue_growth_next_year * 100) if (revenue_growth_next_year is not None and abs(revenue_growth_next_year) < 10) else revenue_growth_next_year,
        # --- Ownership ---
        "pct_institutions": (pct_institutions * 100) if pct_institutions is not None else None,
        "pct_insiders": (pct_insiders * 100) if pct_insiders is not None else None,
        "top_institution": top_institution,
    }
    SUMMARY_CACHE[symbol] = out
    return out


def _merge_bundle(symbol: str, quote: Dict[str, Any], chart_layer: Dict[str, Any], summary_layer: Dict[str, Any]) -> Dict[str, Any]:
    """Combine v7 quote + chart_layer + summary_layer into final bundle."""
    price = _safe(quote.get("regularMarketPrice"))
    change_pct = _safe(quote.get("regularMarketChangePercent"))
    change = _safe(quote.get("regularMarketChange"))
    ccy = quote.get("currency") or chart_layer.get("currency_chart") or ("INR" if symbol.endswith(".NS") else "USD")
    bundle = {
        "symbol": symbol,
        "name": summary_layer.get("long_name") or quote.get("longName") or quote.get("shortName") or symbol,
        "sector": summary_layer.get("sector"),
        "industry": summary_layer.get("industry"),
        "currency": ccy,
        "exchange": quote.get("fullExchangeName") or chart_layer.get("exchange"),
        "price": price,
        "change": change,
        "change_pct": change_pct,
        "market_cap": _safe(quote.get("marketCap")),
        "pe": _safe(quote.get("trailingPE")),
        "forward_pe": _safe(quote.get("forwardPE")) or summary_layer.get("forward_pe"),
        "pb": _safe(quote.get("priceToBook")) or summary_layer.get("pb"),
        "ps_ratio": summary_layer.get("ps_ratio"),
        "peg_ratio": summary_layer.get("peg_ratio"),
        "roe": summary_layer.get("roe"),
        "roa": summary_layer.get("roa"),
        "debt_to_equity": summary_layer.get("debt_to_equity"),
        "dividend_yield": _safe(quote.get("dividendYield")) or summary_layer.get("dividend_yield_summary"),
        "eps": _safe(quote.get("epsTrailingTwelveMonths")) or summary_layer.get("eps"),
        "eps_growth": summary_layer.get("eps_growth"),
        "revenue_growth": summary_layer.get("revenue_growth"),
        "profit_margin": summary_layer.get("profit_margin"),
        "operating_margin": summary_layer.get("operating_margin"),
        "gross_margin": summary_layer.get("gross_margin"),
        "current_ratio": summary_layer.get("current_ratio"),
        "quick_ratio": summary_layer.get("quick_ratio"),
        "free_cashflow": summary_layer.get("free_cashflow"),
        "operating_cashflow": summary_layer.get("operating_cashflow"),
        "total_cash": summary_layer.get("total_cash"),
        "total_debt": summary_layer.get("total_debt"),
        "total_revenue": summary_layer.get("total_revenue"),
        "ebitda": summary_layer.get("ebitda"),
        "beta": summary_layer.get("beta"),
        # --- Price/perf extras (from quote, zero extra cost) ---
        "open": _safe(quote.get("regularMarketOpen")),
        "day_high": _safe(quote.get("regularMarketDayHigh")),
        "day_low": _safe(quote.get("regularMarketDayLow")),
        "prev_close": _safe(quote.get("regularMarketPreviousClose")),
        "volume": _safe(quote.get("regularMarketVolume")),
        "avg_volume": _safe(quote.get("averageDailyVolume3Month")) or _safe(quote.get("averageDailyVolume10Day")),
        "shares_outstanding": _safe(quote.get("sharesOutstanding")) or summary_layer.get("shares_outstanding"),
        "float_shares": summary_layer.get("float_shares"),
        # --- Valuation extras ---
        "enterprise_value": summary_layer.get("enterprise_value"),
        "ev_ebitda": summary_layer.get("ev_ebitda"),
        "ev_sales": summary_layer.get("ev_sales"),
        "book_value_per_share": summary_layer.get("book_value_per_share"),
        "payout_ratio": summary_layer.get("payout_ratio"),
        # --- Computed technicals (from chart) ---
        "from_52w_low_pct": chart_layer.get("from_52w_low_pct"),
        "atr": chart_layer.get("atr"),
        "one_year_change_pct": chart_layer.get("one_year_change_pct"),
        "ytd_pct": chart_layer.get("ytd_pct"),
        "sparkline": chart_layer.get("sparkline") or [],
        "rsi": chart_layer.get("rsi"),
        "macd": chart_layer.get("macd"),
        "macd_signal": chart_layer.get("macd_signal"),
        "ma50": chart_layer.get("ma50"),
        "ma200": chart_layer.get("ma200"),
        "volume_surge": chart_layer.get("volume_surge"),
        "high_52w": _safe(quote.get("fiftyTwoWeekHigh")) or chart_layer.get("high_52w"),
        "low_52w": _safe(quote.get("fiftyTwoWeekLow")) or chart_layer.get("low_52w"),
        "from_52w_high_pct": chart_layer.get("from_52w_high_pct"),
        # --- Real analyst data ---
        "target_mean_price": summary_layer.get("target_mean_price"),
        "target_high_price": summary_layer.get("target_high_price"),
        "target_low_price": summary_layer.get("target_low_price"),
        "target_median_price": summary_layer.get("target_median_price"),
        "recommendation_mean": summary_layer.get("recommendation_mean"),
        "recommendation_key": summary_layer.get("recommendation_key"),
        "analyst_count": summary_layer.get("analyst_count"),
        "rating_distribution": summary_layer.get("rating_distribution"),
        "latest_upgrade_downgrade": summary_layer.get("latest_upgrade_downgrade"),
        # --- Calendar ---
        "next_earnings_epoch": summary_layer.get("next_earnings_epoch"),
        "ex_dividend_epoch": summary_layer.get("ex_dividend_epoch"),
        "dividend_date_epoch": summary_layer.get("dividend_date_epoch"),
        # --- Earnings perf ---
        "latest_eps_surprise_pct": summary_layer.get("latest_eps_surprise_pct"),
        "eps_growth_next_year_pct": summary_layer.get("eps_growth_next_year_pct"),
        "revenue_growth_next_year_pct": summary_layer.get("revenue_growth_next_year_pct"),
        # --- Ownership ---
        "pct_institutions": summary_layer.get("pct_institutions"),
        "pct_insiders": summary_layer.get("pct_insiders"),
        "top_institution": summary_layer.get("top_institution"),
        # --- Profile ---
        "description": summary_layer.get("description"),
        "website": summary_layer.get("website"),
        "country": summary_layer.get("country"),
        "employees": summary_layer.get("employees"),
    }
    # --- Derived ratios ---
    vol = bundle.get("volume"); avg_vol = bundle.get("avg_volume")
    bundle["rvol"] = round(vol / avg_vol, 2) if (vol and avg_vol and avg_vol > 0) else None
    mcap = bundle.get("market_cap"); fcf = bundle.get("free_cashflow")
    bundle["p_fcf"] = round(mcap / fcf, 2) if (mcap and fcf and fcf > 0) else None
    return bundle


# ---------- Async helpers ----------
async def _gather_with_concurrency(symbols: List[str], fn, concurrency: int = 20):
    sem = asyncio.Semaphore(concurrency)

    async def _one(sym):
        async with sem:
            return await asyncio.to_thread(fn, sym)

    return await asyncio.gather(*[_one(s) for s in symbols], return_exceptions=False)


# ---------- Public APIs ----------
async def get_bundle(symbol: str) -> Dict[str, Any]:
    """Single-symbol full bundle. Pulls quote+chart+summary if needed."""
    if symbol in BUNDLE_CACHE:
        return BUNDLE_CACHE[symbol]

    # quote (single symbol via batch endpoint)
    quote_map = await asyncio.to_thread(_yh_quote_batch, [symbol])
    quote = quote_map.get(symbol, {})
    chart_l = await asyncio.to_thread(_fetch_chart_layer, symbol)
    summary_l = await asyncio.to_thread(_fetch_summary_layer, symbol)
    if not chart_l.get("available") and not quote:
        return {"symbol": symbol, "error": "no_data"}
    b = _merge_bundle(symbol, quote, chart_l, summary_l)
    if b["price"] is None and not chart_l.get("available"):
        return {"symbol": symbol, "error": "no_data"}
    BUNDLE_CACHE[symbol] = b
    return b


async def get_market_universe(market: str) -> List[Dict[str, Any]]:
    """Fetch full universe bundles, fast (uses batch quote + parallel chart + summary).

    Universe TTL is short (2 min), but chart_layer/summary_layer caches are reused.
    """
    key = f"universe_full:{market.upper()}"
    if key in UNIVERSE_BUNDLE_CACHE:
        return UNIVERSE_BUNDLE_CACHE[key]

    symbols = get_universe(market)

    # 1) Batch quotes (fast — ~1-3 calls)
    quote_map = await asyncio.to_thread(_yh_quote_batch, symbols)

    # 2) Chart layer in parallel (heavier)
    chart_results = await _gather_with_concurrency(symbols, _fetch_chart_layer, concurrency=24)
    chart_map = {sym: cl for sym, cl in zip(symbols, chart_results)}

    # 3) Summary layer in parallel (slowest; cached 60 min)
    summary_results = await _gather_with_concurrency(symbols, _fetch_summary_layer, concurrency=14)
    summary_map = {sym: sl for sym, sl in zip(symbols, summary_results)}

    bundles: List[Dict[str, Any]] = []
    for sym in symbols:
        q = quote_map.get(sym, {})
        c = chart_map.get(sym, {}) or {}
        s = summary_map.get(sym, {}) or {}
        if not c.get("available") and not q:
            continue
        b = _merge_bundle(sym, q, c, s)
        if b["price"] is None:
            continue
        BUNDLE_CACHE[sym] = b
        bundles.append(b)

    UNIVERSE_BUNDLE_CACHE[key] = bundles
    return bundles


async def get_quote(symbol: str) -> Dict[str, Any]:
    """Lightweight quote (price+sparkline+change). Uses batch + chart layer."""
    quote_map = await asyncio.to_thread(_yh_quote_batch, [symbol])
    quote = quote_map.get(symbol, {})
    chart_l = await asyncio.to_thread(_fetch_chart_layer, symbol)
    if not chart_l.get("available") and not quote:
        return {"symbol": symbol, "error": "no_data"}
    return {
        "symbol": symbol,
        "name": quote.get("longName") or quote.get("shortName") or symbol,
        "price": _safe(quote.get("regularMarketPrice")),
        "change": _safe(quote.get("regularMarketChange")),
        "change_pct": _safe(quote.get("regularMarketChangePercent")),
        "sparkline": chart_l.get("sparkline") or [],
        "currency": quote.get("currency") or chart_l.get("currency_chart") or ("INR" if symbol.endswith(".NS") else "USD"),
    }


async def get_quotes(symbols: List[str]) -> List[Dict[str, Any]]:
    """Multi-symbol lightweight quotes for watchlist / movers."""
    quote_map = await asyncio.to_thread(_yh_quote_batch, symbols)
    chart_results = await _gather_with_concurrency(symbols, _fetch_chart_layer, concurrency=20)
    out: List[Dict[str, Any]] = []
    for sym, cl in zip(symbols, chart_results):
        q = quote_map.get(sym, {})
        if not cl.get("available") and not q:
            continue
        out.append({
            "symbol": sym,
            "name": q.get("longName") or q.get("shortName") or sym,
            "price": _safe(q.get("regularMarketPrice")),
            "change": _safe(q.get("regularMarketChange")),
            "change_pct": _safe(q.get("regularMarketChangePercent")),
            "sparkline": cl.get("sparkline") or [],
            "currency": q.get("currency") or cl.get("currency_chart") or ("INR" if sym.endswith(".NS") else "USD"),
        })
    return out


async def get_market_indices(market: str) -> List[Dict[str, Any]]:
    idx_map = get_indices(market)
    quotes = await get_quotes(list(idx_map.keys()))
    for q in quotes:
        q["name"] = idx_map.get(q["symbol"], q["symbol"])
    return quotes


# ---------- History (OHLCV for charts) ----------
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
    "momentum_breakouts": {"title": "Momentum Breakouts", "subtitle": "Strong uptrend with volume surge near 52w highs", "icon": "trending-up"},
    "value_picks": {"title": "Value Picks", "subtitle": "Low P/E and P/B with healthy ROE", "icon": "trophy"},
    "high_roce_low_debt": {"title": "Quality Compounders", "subtitle": "High ROE, low debt, steady margins", "icon": "shield-checkmark"},
    "oversold_quality": {"title": "Oversold Quality", "subtitle": "RSI under 40 on fundamentally strong names", "icon": "pulse"},
    "multibaggers": {"title": "Multibagger Radar", "subtitle": "High EPS + revenue growth with reasonable PE", "icon": "rocket"},
    "fifty_two_week_high": {"title": "52-Week Breakouts", "subtitle": "Trading within 3% of 52-week high", "icon": "ribbon"},
    "dividend_aristocrats": {"title": "Dividend Aristocrats", "subtitle": "Healthy yield with stable fundamentals", "icon": "cash"},
    "golden_cross": {"title": "Golden Cross", "subtitle": "Price above 50DMA above 200DMA", "icon": "git-merge"},
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
        "universe_size": len(universe),
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
