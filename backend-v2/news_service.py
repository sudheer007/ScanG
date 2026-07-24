"""News service — real financial news from Yahoo Finance's public search endpoint.

No API key required. Returns real publishers (Reuters, Bloomberg, Motley Fool,
GuruFocus, MT Newswires, etc.). Reuses the impersonated curl_cffi session from
stock_service so Yahoo accepts the request.

Caching: 15 minutes per query (news doesn't change second-to-second).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from cachetools import TTLCache

from stock_service import _get_session
from stock_universe import currency

log = logging.getLogger(__name__)

NEWS_CACHE = TTLCache(maxsize=1024, ttl=10 * 60)  # 10 min

SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"

# Broad queries used to assemble a market-wide headline feed.
MARKET_QUERIES = {
    "US": ["^GSPC", "^IXIC", "^DJI", "stock market", "Federal Reserve", "earnings"],
    "IN": ["^NSEI", "^BSESN", "Nifty 50", "Sensex", "Indian stock market", "RBI"],
}


def _pick_thumb(thumbnail: Optional[Dict[str, Any]]) -> Optional[str]:
    res = (thumbnail or {}).get("resolutions") or []
    if not res:
        return None
    # Prefer a mid-size tagged resolution for list performance.
    for r in res:
        w = r.get("width") or 0
        if 100 <= w <= 360:
            return r.get("url")
    # else smallest available (last entry is usually the smallest tagged one)
    return res[-1].get("url") or res[0].get("url")


def _normalize(n: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "uuid": n.get("uuid"),
        "title": n.get("title"),
        "publisher": n.get("publisher"),
        "link": n.get("link"),
        "published_epoch": n.get("providerPublishTime"),
        "type": n.get("type"),
        "thumbnail": _pick_thumb(n.get("thumbnail")),
        "related_tickers": n.get("relatedTickers") or [],
    }


def _yh_news(query: str, count: int = 15) -> List[Dict[str, Any]]:
    s = _get_session()
    try:
        r = s.get(
            SEARCH_URL,
            params={
                "q": query,
                "newsCount": str(count),
                "quotesCount": "0",
                "enableFuzzyQuery": "false",
            },
        )
        if r.status_code != 200:
            log.debug(f"news {query} status {r.status_code}")
            return []
        return [_normalize(n) for n in (r.json().get("news") or [])]
    except Exception as e:
        log.debug(f"news {query} err: {e}")
        return []


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for it in items:
        key = it.get("uuid") or it.get("link")
        if not it.get("title") or not key or key in seen:
            continue
        seen.add(key)
        out.append(it)
    out.sort(key=lambda x: x.get("published_epoch") or 0, reverse=True)
    return out


async def stock_news(symbol: str, limit: int = 20) -> Dict[str, Any]:
    key = f"stock:{symbol}:{limit}"
    if key in NEWS_CACHE:
        return NEWS_CACHE[key]
    items = await asyncio.to_thread(_yh_news, symbol, max(limit, 12))
    out = _dedupe(items)[:limit]
    res = {"symbol": symbol, "count": len(out), "news": out}
    NEWS_CACHE[key] = res
    return res


BULLISH_KEYWORDS = (
    "beat", "surge", "upgrade", "record", "growth", "profit", "buyback",
    "dividend", "outperform", "raises", "soar", "jump", "rally", "bullish",
)
BEARISH_KEYWORDS = (
    "miss", "downgrade", "lawsuit", "probe", "decline", "cut", "warning",
    "layoff", "underperform", "falls", "drop", "plunge", "bearish", "slump",
)


def score_headline_sentiment(title: str) -> str:
    """Return bullish, bearish, or neutral for a single headline."""
    t = (title or "").lower()
    bull = sum(1 for kw in BULLISH_KEYWORDS if kw in t)
    bear = sum(1 for kw in BEARISH_KEYWORDS if kw in t)
    if bull > bear:
        return "bullish"
    if bear > bull:
        return "bearish"
    return "neutral"


def news_sentiment_summary(news_items: List[Dict[str, Any]], max_headlines: int = 5) -> Dict[str, Any]:
    """Rule-based sentiment from recent headline titles."""
    tagged = []
    bull_total = bear_total = 0
    for item in news_items[:max_headlines]:
        title = item.get("title") or ""
        tag = score_headline_sentiment(title)
        if tag == "bullish":
            bull_total += 1
        elif tag == "bearish":
            bear_total += 1
        tagged.append({
            "title": title,
            "publisher": item.get("publisher"),
            "link": item.get("link"),
            "published_epoch": item.get("published_epoch"),
            "sentiment": tag,
        })

    total_matches = bull_total + bear_total
    if total_matches > 0:
        raw = (bull_total - bear_total) / total_matches * 100
    else:
        raw = 0.0
    score = round(max(-100.0, min(100.0, raw)), 1)

    if score >= 25:
        label = "Bullish"
    elif score <= -25:
        label = "Bearish"
    else:
        label = "Neutral"

    return {
        "score": score,
        "label": label,
        "bullish_count": bull_total,
        "bearish_count": bear_total,
        "headlines": tagged,
    }


async def market_news(market: str, limit: int = 30) -> Dict[str, Any]:
    mkt = market.upper()
    key = f"market:{mkt}:{limit}"
    if key in NEWS_CACHE:
        return NEWS_CACHE[key]
    queries = MARKET_QUERIES.get(mkt, MARKET_QUERIES["US"])
    results = await asyncio.gather(*[asyncio.to_thread(_yh_news, q, 12) for q in queries])
    merged: List[Dict[str, Any]] = []
    for lst in results:
        merged.extend(lst)
    out = _dedupe(merged)[:limit]
    res = {"market": mkt, "currency": currency(market), "count": len(out), "news": out}
    NEWS_CACHE[key] = res
    return res
