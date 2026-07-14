"""Resolve app symbols to Investing.com instruments."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ingestion.client import InvestingClient
from ingestion.normalizer import infer_market
from ingestion.parsers import slug_from_url

US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "NYSE MKT", "BATS", "CBOE"}
IN_EXCHANGES = {"NSE", "BSE"}


def _search_query(symbol: str, market: str) -> str:
    sym = symbol.upper()
    if market == "IN" and sym.endswith(".NS"):
        return sym[:-3]
    if market == "US":
        return sym.replace("-", ".")
    return sym


def _score_quote(quote: Dict[str, Any], *, symbol: str, market: str) -> float:
    url = quote.get("url") or ""
    if not url.startswith("/equities/"):
        return -1.0

    exchange = (quote.get("exchange") or "").upper()
    qsym = (quote.get("symbol") or "").upper()
    target = symbol.upper().replace("-", ".")
    if market == "IN" and target.endswith(".NS"):
        target = target[:-3]

    score = 0.0
    if market == "US" and exchange in US_EXCHANGES:
        score += 50
    if market == "IN" and exchange in IN_EXCHANGES:
        score += 50
    if market == "IN" and exchange == "NSE":
        score += 10

    # direct symbol match (AAPL, RELI, etc.)
    if qsym == target:
        score += 40
    elif target in qsym or qsym in target:
        score += 10

    desc = (quote.get("description") or "").lower()
    if market == "IN" and "reliance industries" in desc:
        score += 5

    if "etf" in (quote.get("type") or "").lower():
        score -= 30
    if "future" in url.lower() or "cfd" in (quote.get("type") or "").lower():
        score -= 40
    # prefer primary listing without cid query param
    if "?cid=" not in url:
        score += 5
    return score


def pick_best_quote(quotes: List[Dict[str, Any]], *, symbol: str, market: str) -> Optional[Dict[str, Any]]:
    ranked = []
    for q in quotes:
        s = _score_quote(q, symbol=symbol, market=market)
        if s >= 0:
            ranked.append((s, q))
    if not ranked:
        return None
    ranked.sort(key=lambda x: x[0], reverse=True)
    return ranked[0][1]


class InstrumentResolver:
    def __init__(self, client: InvestingClient):
        self.client = client

    def resolve(self, symbol: str, market: Optional[str] = None) -> Dict[str, Any]:
        market = (market or infer_market(symbol)).upper()
        query = _search_query(symbol, market)
        quotes = self.client.search_quotes(query)
        best = pick_best_quote(quotes, symbol=symbol, market=market)
        if not best:
            raise LookupError(f"No Investing.com match for {symbol} ({market})")

        slug = slug_from_url(best.get("url") or "")
        if not slug:
            raise LookupError(f"Invalid Investing URL for {symbol}")

        return {
            "symbol": symbol.upper(),
            "market": market,
            "investing_pair_id": str(best.get("id") or ""),
            "slug": slug,
            "name": best.get("description"),
            "investing_symbol": best.get("symbol"),
            "exchange": best.get("exchange"),
            "currency": None,
            "source_url": best.get("url"),
            "resolver_query": query,
        }
