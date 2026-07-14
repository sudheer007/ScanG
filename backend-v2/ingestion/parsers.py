"""Parsing helpers for Investing.com NEXT_DATA payloads."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def content_fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


def payload_fingerprint(payload: Any) -> str:
    """Stable hash for change detection on parsed store payloads."""
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def latest_period_end(rows: List[Dict[str, Any]]) -> Optional[str]:
    """Return the most recent period_end from financial statement rows."""
    dates = [r.get("period_end") for r in rows if r.get("period_end")]
    if not dates:
        return None
    return max(dates)


def latest_action_date(rows: List[Dict[str, Any]]) -> Optional[str]:
    """Return the most recent action_date from corporate action rows."""
    dates = [r.get("action_date") for r in rows if r.get("action_date")]
    if not dates:
        return None
    return max(dates)


def extract_next_data(html: str) -> Dict[str, Any]:
    match = NEXT_DATA_RE.search(html or "")
    if not match:
        raise ValueError("NEXT_DATA script tag not found")
    return json.loads(match.group(1))


def page_state(html: str) -> Dict[str, Any]:
    data = extract_next_data(html)
    return data.get("props", {}).get("pageProps", {}).get("state", {}) or {}


def store_payload(state: Dict[str, Any], store_name: str) -> Dict[str, Any]:
    payload = state.get(store_name)
    if payload is None:
        raise ValueError(f"store not found: {store_name}")
    return payload


def slug_from_url(url: str) -> str:
    path = (url or "").split("?")[0].strip("/")
    if path.startswith("equities/"):
        path = path[len("equities/"):]
    return path


def flatten_statement_reports(
    reports: List[Dict[str, Any]],
    *,
    statement_type: str,
    period_type: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for report in reports or []:
        period_end = report.get("period_end_date") or report.get("period_end")
        indicators = report.get("indicators") or {}
        line_items = {}
        for key, item in indicators.items():
            if not isinstance(item, dict):
                continue
            line_items[key] = {
                "name": item.get("name"),
                "value": item.get("value"),
                "define": item.get("define"),
                "non_currency": bool(item.get("non_currency_indicator")),
            }
        rows.append({
            "statement_type": statement_type,
            "period_type": period_type,
            "period_end": period_end,
            "year": report.get("year"),
            "calendar_quarter": report.get("calendar_quarter"),
            "currency_id": report.get("currency_id"),
            "line_items": line_items,
        })
    return rows


def parse_financial_store(
    store: Dict[str, Any],
    *,
    annual_key: str,
    quarterly_key: str,
    statement_type: str,
) -> List[Dict[str, Any]]:
    annual = flatten_statement_reports(
        (store.get(annual_key) or {}).get("reports") or [],
        statement_type=statement_type,
        period_type="annual",
    )
    quarterly = flatten_statement_reports(
        (store.get(quarterly_key) or {}).get("reports") or [],
        statement_type=statement_type,
        period_type="quarterly",
    )
    return annual + quarterly


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _normalize_holder(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "owner_name": row.get("owner_name") or row.get("investment_company_name"),
        "holder_type": row.get("holder_type") or row.get("company_type_name"),
        "holding_date": row.get("holding_date"),
        "shares_held": row.get("number_of_shares") or row.get("shares_held"),
        "market_value": row.get("market_value"),
        "pct_outstanding": row.get("percent_of_shares_outstanding") or row.get("percent"),
        "instrument_id": row.get("instrument_id"),
        "latest_flag": row.get("latest_flag"),
    }


def parse_ratios(store: Dict[str, Any]) -> Dict[str, Any]:
    data = store.get("ratiosData") or {}
    indicators = data.get("indicators") or {}
    ratios: Dict[str, Any] = {}
    ratio_details: Dict[str, Any] = {}
    benchmarks: Dict[str, Any] = {}
    roce_roic: Dict[str, Any] = {"roce_available": False, "roic_available": False}

    for key, item in indicators.items():
        if not isinstance(item, dict):
            continue
        ratios[key] = item.get("value")
        ratio_details[key] = {
            "name": item.get("name"),
            "value": item.get("value"),
            "industry_value": item.get("industry_value"),
            "define": item.get("define"),
            "non_currency": bool(item.get("non_currency_indicator")),
        }
        if item.get("industry_value") is not None:
            benchmarks[key] = item.get("industry_value")
        key_l = key.lower()
        if "roce" in key_l and item.get("value") is not None:
            roce_roic["roce_available"] = True
            roce_roic["roce"] = item.get("value")
        if "roic" in key_l and item.get("value") is not None:
            roce_roic["roic_available"] = True
            roce_roic["roic"] = item.get("value")

    return {
        "company_name": data.get("company_name"),
        "currency_id": data.get("currency_id"),
        "ratios": ratios,
        "ratio_details": ratio_details,
        "industry_benchmarks": benchmarks,
        "roce_roic": roce_roic,
    }


def parse_ownership(store: Dict[str, Any]) -> Dict[str, Any]:
    institutional = [_normalize_holder(r) for r in (store.get("institutionalOwners") or [])]
    mutual_funds = [_normalize_holder(r) for r in (store.get("mutualFundOwners") or [])]
    insider_transactions = [
        h for h in institutional
        if any(x in (h.get("holder_type") or "").lower() for x in ("insider", "individual", "officer", "director"))
    ]
    pct = store.get("percentOfSharesOutstanding")
    holdings_breakdown = pct if isinstance(pct, dict) else None
    return {
        "institutional": institutional,
        "mutual_funds": mutual_funds,
        "insider_transactions": insider_transactions,
        "pct_shares_outstanding": pct,
        "holdings_breakdown": holdings_breakdown,
    }


def parse_dividends(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for item in store.get("equityDividends") or []:
        rows.append({
            "action_type": "dividend",
            "action_date": item.get("div_date"),
            "payment_date": item.get("pay_date"),
            "amount": item.get("div_amount"),
            "split_adj_amount": item.get("split_adj_div_amount"),
            "payment_type": item.get("div_payment_type"),
            "yield_pct": item.get("yield"),
        })
    return rows


def parse_splits(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for item in store.get("splits") or []:
        rows.append({
            "action_type": "split",
            "action_date": item.get("date"),
            "ratio": item.get("ratio"),
        })
    return rows


def parse_profile(store: Dict[str, Any]) -> Dict[str, Any]:
    profile = store.get("profile") or {}
    sector = profile.get("sector") or {}
    industry = profile.get("industry") or {}
    market = profile.get("market") or {}
    contact = profile.get("contactInformation") or {}
    executives = profile.get("executives") or []
    return {
        "sector": sector.get("name"),
        "sector_link": sector.get("link"),
        "industry": industry.get("name"),
        "industry_link": industry.get("link"),
        "market_name": market.get("name"),
        "market_link": market.get("link"),
        "employees": profile.get("employees"),
        "description": profile.get("description"),
        "equity_type": profile.get("equityType"),
        "website": contact.get("website") or contact.get("webSite"),
        "address": contact.get("address"),
        "phone": contact.get("phone"),
        "ipo_date": profile.get("ipoDate") or profile.get("ipo_date"),
        "shares_outstanding": profile.get("sharesOutstanding") or profile.get("shares_outstanding"),
        "executives": [
            {
                "name": e.get("name"),
                "title": e.get("title"),
                "age": e.get("age"),
                "since": e.get("since"),
            }
            for e in executives
            if isinstance(e, dict)
        ],
    }


def parse_equity_instrument(state: Dict[str, Any]) -> Dict[str, Any]:
    eq = state.get("equityStore") or {}
    instrument = eq.get("instrument") or {}
    base = instrument.get("base") or {}
    price = instrument.get("price") or {}
    exchange = instrument.get("exchange") or {}
    fundamental = instrument.get("fundamental") or {}
    volume = instrument.get("volume") or {}
    performance = instrument.get("performance") or {}
    relatives = ((instrument.get("relatives") or {}).get("relatives") or [])
    primary = relatives[0] if relatives else {}
    underlying = instrument.get("underlying") or {}
    return {
        "investing_pair_id": str(base.get("id") or eq.get("instrumentId") or ""),
        "slug": slug_from_url(base.get("path") or ""),
        "name": price.get("long_name") or instrument.get("englishName", {}).get("shortName"),
        "investing_symbol": primary.get("symbol"),
        "exchange": exchange.get("exchange") or primary.get("exchangeName"),
        "exchange_full_name": exchange.get("exchangeFullName"),
        "currency": price.get("currency") or primary.get("currency"),
        "country_flag": exchange.get("flag") or primary.get("flag"),
        "isin": underlying.get("isin"),
        "website": underlying.get("website"),
        "ipo_date": underlying.get("ipoDate"),
        "shares_outstanding": fundamental.get("sharesOutstanding"),
        "employees": None,
        "description": None,
        "quote": {
            "last": price.get("last"),
            "open": price.get("open"),
            "high": price.get("high") or price.get("day_high"),
            "low": price.get("low") or price.get("day_low"),
            "prev_close": price.get("prev_close") or price.get("previousClose"),
            "change": price.get("change"),
            "change_pct": price.get("change_percent") or price.get("changePercent"),
            "volume": volume.get("volume") if isinstance(volume, dict) else volume,
            "avg_volume": volume.get("average") if isinstance(volume, dict) else None,
            "turnover": volume.get("_turnover") if isinstance(volume, dict) else None,
            "market_cap": fundamental.get("marketCapRaw") or price.get("market_cap"),
        },
        "fundamental": {
            "eps": fundamental.get("eps"),
            "pe_ratio": fundamental.get("ratio"),
            "dividend_yield": fundamental.get("yield"),
            "revenue": fundamental.get("revenueRaw"),
            "one_year_return": fundamental.get("oneYearReturn"),
        },
        "performance": performance,
    }


def parse_analyst_consensus(state: Dict[str, Any]) -> Dict[str, Any]:
    consensus_store = state.get("consensusEstimatesStore") or {}
    forecast_store = state.get("forecastStore") or {}
    summary = consensus_store.get("forecastSummary") or forecast_store.get("forecast") or {}
    return {
        "consensus": {
            "recommendation": summary.get("consensus_recommendation"),
            "target_mean": summary.get("target_price_consensus_mean"),
            "target_high": summary.get("target_price_consensus_high"),
            "target_low": summary.get("target_price_consensus_low"),
            "upside_pct": summary.get("upside_percent"),
            "num_estimates": summary.get("number_of_estimates"),
            "last_rating_date": summary.get("last_rating_date"),
        },
        "rating_counts": {
            "buy": summary.get("number_of_analysts_buy"),
            "hold": summary.get("number_of_analysts_hold"),
            "sell": summary.get("number_of_analysts_sell"),
        },
        "price_history": {
            "actual": consensus_store.get("actualHistoryPrices") or [],
            "forecast": consensus_store.get("forecastHistoryPrices") or [],
        },
    }


def parse_earnings_history(store: Dict[str, Any]) -> Dict[str, Any]:
    quarters = []
    for item in store.get("earnings") or []:
        quarters.append({
            "date": item.get("date"),
            "report_year": item.get("reportYear"),
            "report_month": item.get("reportMonth"),
            "eps_actual": item.get("epsActual"),
            "eps_forecast": item.get("epsForecast"),
            "eps_surprise_pct": item.get("epsSurprisePercent"),
            "revenue_actual": item.get("revenueActual"),
            "revenue_forecast": item.get("revenueForecast"),
            "revenue_surprise_pct": item.get("revenueSurprisePercent"),
        })
    forecasts = store.get("forecasts") or []
    key_metrics = store.get("keyMetrics") or {}
    return {"quarters": quarters, "forecasts": forecasts, "key_metrics": key_metrics}


def parse_technical_indicators(store: Dict[str, Any]) -> Dict[str, Any]:
    details = store.get("analysisDetails") or {}
    timeframes: Dict[str, Any] = {}
    for tf, block in details.items():
        if not isinstance(block, dict):
            continue
        timeframes[tf] = {
            "summary": block.get("summary"),
            "timeframe": block.get("timeframe"),
            "last_update": block.get("lastUpdateTime"),
            "indicators": block.get("indicators"),
            "moving_averages": block.get("movingAverages"),
            "pivot_points": block.get("pivotPoints"),
        }
    daily = store.get("technicalDaily") or {}
    return {
        "timeframes": timeframes,
        "summary": daily.get("summary") or (store.get("technicalData") or {}).get("summary"),
        "active_timeframe": store.get("timeframe"),
    }


def parse_price_history(store: Dict[str, Any]) -> Dict[str, Any]:
    hist = store.get("historicalData") or {}
    bars = hist.get("data") if isinstance(hist, dict) else hist
    if not isinstance(bars, list):
        bars = []
    normalized = []
    for bar in bars:
        if not isinstance(bar, dict):
            continue
        normalized.append({
            "date": bar.get("date") or bar.get("rowDate"),
            "open": bar.get("open") or bar.get("price_open"),
            "high": bar.get("high") or bar.get("price_max"),
            "low": bar.get("low") or bar.get("price_min"),
            "close": bar.get("close") or bar.get("last_close") or bar.get("price"),
            "volume": bar.get("volume"),
        })
    return {
        "bars": normalized,
        "summary": hist.get("summary") if isinstance(hist, dict) else None,
        "date_range": store.get("dateRange"),
        "time_frame": store.get("timeFrame"),
    }


def parse_quote_snapshot(state: Dict[str, Any]) -> Dict[str, Any]:
    eq = parse_equity_instrument(state)
    key_metrics = (state.get("equityStore") or {}).get("keyMetrics") or {}
    return {
        "price": eq.get("quote"),
        "fundamental": eq.get("fundamental"),
        "performance": eq.get("performance"),
        "key_metrics": key_metrics,
        "investing_symbol": eq.get("investing_symbol"),
        "exchange": eq.get("exchange"),
        "currency": eq.get("currency"),
    }


def _normalize_news_article(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "article_id": str(item.get("id") or item.get("article_id") or item.get("ID") or ""),
        "title": item.get("title") or item.get("headline"),
        "body": item.get("body") or item.get("snippet"),
        "url": item.get("link") or item.get("url"),
        "published_at": item.get("published_at") or item.get("date") or item.get("created_at"),
        "source": item.get("source") or item.get("provider"),
        "article_type": item.get("article_type"),
    }


def parse_stock_news(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    articles: List[Dict[str, Any]] = []
    for key in ("_news", "_breakingNews", "_topArticles", "_mostPopularNews", "_analysis"):
        for item in store.get(key) or []:
            if not isinstance(item, dict):
                continue
            norm = _normalize_news_article(item)
            aid = norm.get("article_id") or payload_fingerprint(norm)[:16]
            if aid in seen:
                continue
            seen.add(aid)
            norm["article_id"] = aid
            articles.append(norm)
    return articles


def parse_analyst_actions(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions = []
    for item in store.get("ratings") or []:
        if not isinstance(item, dict):
            continue
        actions.append({
            "action_date": item.get("date"),
            "firm_name": item.get("firm_name"),
            "analyst_name": item.get("analyst_name"),
            "action": item.get("action") or item.get("action_translated"),
            "rating": item.get("rating") or item.get("rating_translated"),
            "past_rating": item.get("past_rating") or item.get("past_rating_translated"),
            "price_target": item.get("price_target"),
            "past_price_target": item.get("past_price_target"),
            "instrument_id": item.get("instrument_id"),
        })
    return actions


def parse_earnings_calendar(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    assets = store.get("earningsAssets") or {}
    for event_date, block in assets.items():
        collection = (block or {}).get("_collection") or []
        for item in collection:
            if not isinstance(item, dict):
                continue
            events.append({
                "event_date": event_date,
                "symbol": item.get("symbol"),
                "name": item.get("name") or item.get("shortName"),
                "instrument_id": item.get("id"),
                "market_cap": item.get("marketCap"),
                "exchange_id": item.get("exchangeId"),
            })
    return events


DIVIDEND_ROW_RE = re.compile(
    r"<tr[^>]*>(.*?)</tr>",
    re.S | re.I,
)
DIVIDEND_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)


def parse_dividend_calendar_html(html: str) -> List[Dict[str, Any]]:
    """Parse legacy dividends calendar HTML table rows."""
    events: List[Dict[str, Any]] = []
    for row in DIVIDEND_ROW_RE.findall(html or ""):
        if "ex-dividend" in row.lower() and "<th" in row.lower():
            continue
        cells = [_strip_html(c) for c in DIVIDEND_CELL_RE.findall(row)]
        cells = [c for c in cells if c]
        if len(cells) < 4:
            continue
        company = cells[0]
        symbol_match = re.search(r"\(([A-Z0-9.\-]+)\)", company)
        events.append({
            "symbol": symbol_match.group(1) if symbol_match else None,
            "company": re.sub(r"\s*\([^)]+\)\s*", "", company).strip(),
            "ex_date": cells[1] if len(cells) > 1 else None,
            "dividend": cells[2] if len(cells) > 2 else None,
            "payment_type": cells[3] if len(cells) > 3 else None,
            "payment_date": cells[4] if len(cells) > 4 else None,
        })
    return events


def parse_macro_events(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    by_date = store.get("calendarEventsByDate") or {}
    for event_date, day_events in by_date.items():
        for item in day_events or []:
            if not isinstance(item, dict):
                continue
            events.append({
                "event_id": item.get("eventId") or item.get("id"),
                "event_date": event_date,
                "time": item.get("time"),
                "event": item.get("event") or item.get("eventName"),
                "currency": item.get("currency"),
                "importance": item.get("importance"),
                "actual": item.get("actual"),
                "forecast": item.get("forecast"),
                "previous": item.get("previous"),
                "country": item.get("country") or item.get("countryName"),
            })
    return events


def parse_index_sector_performance(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    coll = store.get("assetsCollection") or {}
    items = coll.get("_collection") if isinstance(coll, dict) else coll
    if not isinstance(items, list):
        return []
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append({
            "index_id": item.get("id"),
            "name": item.get("name"),
            "symbol": item.get("symbol"),
            "change_1m_pct": item.get("changeOneMonth"),
            "change_1y_pct": item.get("changeOneYear"),
            "market_cap": item.get("marketCap"),
            "volume_3m": item.get("volumeThreeMonths"),
            "beta": item.get("beta"),
            "pe_ratio": item.get("peRatio"),
        })
    return out


def parse_india_ownership_breakdown(store: Dict[str, Any], *, market: str) -> Dict[str, Any]:
    pct = store.get("percentOfSharesOutstanding") or {}
    if market != "IN" or not isinstance(pct, dict):
        return {
            "market": market,
            "available": False,
            "breakdown": pct if isinstance(pct, dict) else {},
            "promoter_pct": None,
            "fii_pct": None,
            "dii_pct": None,
            "mf_pct": None,
        }

    inst = (pct.get("total_institutional_holdings") or {}).get("percent")
    public = (pct.get("public_companies_and_individuals_holdings") or {}).get("percent")
    mf = (pct.get("total_mutual_funds_and_etf_holdings") or {}).get("percent")
    other_inst = (pct.get("other_institutional_holdings") or {}).get("percent")

    return {
        "market": market,
        "available": bool(pct),
        "breakdown": pct,
        "promoter_pct": public,
        "fii_pct": other_inst,
        "dii_pct": inst,
        "mf_pct": mf,
        "institutional_count": pct.get("number_of_institutional_holdings"),
    }


def parse_delivery_turnover(state: Dict[str, Any], *, market: str) -> Dict[str, Any]:
    eq = parse_equity_instrument(state)
    quote = eq.get("quote") or {}
    turnover = quote.get("turnover")
    volume = quote.get("volume")
    delivery_pct = None
    vol_block = ((state.get("equityStore") or {}).get("instrument") or {}).get("volume") or {}
    if isinstance(vol_block, dict):
        delivery_pct = vol_block.get("deliveryPercent") or vol_block.get("delivery_percent")

    return {
        "market": market,
        "available": turnover is not None or delivery_pct is not None,
        "turnover": turnover,
        "volume": volume,
        "delivery_pct": delivery_pct,
        "traded_value": turnover,
    }


def latest_earnings_date(doc: Dict[str, Any]) -> Optional[str]:
    dates = [q.get("date") for q in (doc.get("quarters") or []) if q.get("date")]
    return max(dates) if dates else None


def latest_news_fingerprint(articles: List[Dict[str, Any]]) -> Optional[str]:
    if not articles:
        return None
    top = articles[0]
    return payload_fingerprint({"id": top.get("article_id"), "published_at": top.get("published_at")})
