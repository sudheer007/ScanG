"""Insider & institutional ownership tracking (Track B).

Insider transactions are real SEC EDGAR Form 4 data: ticker -> CIK lookup via
SEC's company_tickers.json, recent Form 4 filings via the submissions API,
then the raw ownership XML for each filing is fetched and parsed directly
(NOT the `primaryDocument` path from the submissions JSON, which points at
SEC's XSLT-rendered HTML view — the raw XML sits at the same filename
directly in the accession folder).

Institutional holders are NOT literal SEC 13F aggregation: 13F filings are
submitted per-institution (their whole portfolio), not per-security, so
"who holds stock X" requires cross-referencing every 13F filer's holdings
table by CUSIP — infeasible without a pre-built database refreshed each
quarter. Instead this reuses Yahoo Finance's already-aggregated
institutional-ownership data (via stock_service's existing Yahoo session),
clearly labeled by source in the response.

US-listed stocks only — SEC EDGAR has no coverage for NSE-listed (.NS) symbols.
"""
from __future__ import annotations

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from cachetools import TTLCache
from curl_cffi import requests as cffi_req

import stock_service as ss
from stock_service import _safe

log = logging.getLogger(__name__)

SEC_HEADERS = {"User-Agent": "ScanG contact:sudheer.sandu@gmail.com"}

TICKER_MAP_CACHE = TTLCache(maxsize=1, ttl=24 * 60 * 60)          # ticker -> CIK, refreshed daily
SUBMISSIONS_CACHE = TTLCache(maxsize=500, ttl=6 * 60 * 60)        # per-CIK filing list
FILING_XML_CACHE = TTLCache(maxsize=4000, ttl=7 * 24 * 60 * 60)   # filings are immutable once filed
OWNERSHIP_CACHE = TTLCache(maxsize=500, ttl=6 * 60 * 60)          # assembled insider-transaction payload

_session: Optional[cffi_req.Session] = None

# Form 4 transaction codes -> (human label, buy/sell/neutral sentiment)
TRANSACTION_CODES = {
    "P": ("Open Market Purchase", "buy"),
    "S": ("Open Market Sale", "sell"),
    "A": ("Grant / Award", "neutral"),
    "M": ("Option Exercise", "neutral"),
    "F": ("Tax Withholding", "neutral"),
    "G": ("Gift", "neutral"),
    "C": ("Conversion", "neutral"),
    "D": ("Disposition to Issuer", "sell"),
    "X": ("Option Exercise (Cash)", "neutral"),
    "I": ("Discretionary Transaction", "neutral"),
}


def _sec_session() -> cffi_req.Session:
    global _session
    if _session is None:
        _session = cffi_req.Session(impersonate="chrome", timeout=20, headers=SEC_HEADERS)
    return _session


# ---------------------------------------------------------------------------
# Ticker -> CIK
# ---------------------------------------------------------------------------

def _get_ticker_cik_map() -> Dict[str, str]:
    key = "map"
    if key in TICKER_MAP_CACHE:
        return TICKER_MAP_CACHE[key]
    out: Dict[str, str] = {}
    try:
        r = _sec_session().get("https://www.sec.gov/files/company_tickers.json")
        if r.status_code == 200:
            for entry in r.json().values():
                ticker = (entry.get("ticker") or "").upper()
                cik = entry.get("cik_str")
                if ticker and cik:
                    out[ticker] = str(cik).zfill(10)
    except Exception as e:
        log.warning(f"SEC ticker map fetch failed: {e}")
    if out:
        TICKER_MAP_CACHE[key] = out
    return out


def _get_cik(symbol: str) -> Optional[str]:
    return _get_ticker_cik_map().get(symbol.upper())


# ---------------------------------------------------------------------------
# SEC EDGAR submissions + Form 4 XML fetch/parse
# ---------------------------------------------------------------------------

def _get_submissions(cik: str) -> Dict[str, Any]:
    if cik in SUBMISSIONS_CACHE:
        return SUBMISSIONS_CACHE[cik]
    out: Dict[str, Any] = {}
    try:
        r = _sec_session().get(f"https://data.sec.gov/submissions/CIK{cik}.json")
        if r.status_code == 200:
            out = r.json()
    except Exception as e:
        log.warning(f"SEC submissions fetch failed for CIK {cik}: {e}")
    SUBMISSIONS_CACHE[cik] = out
    return out


def _tag_value(el: Optional[ET.Element], path: str) -> Optional[str]:
    """Get text from a nested <tag><value>X</value></tag>, or plain <tag>X</tag>."""
    if el is None:
        return None
    found = el.find(path)
    if found is None:
        return None
    value_el = found.find("value")
    text = value_el.text if value_el is not None else found.text
    return text.strip() if text else None


def _fetch_form4_xml(cik: str, accession: str, primary_document: str) -> Optional[ET.Element]:
    cache_key = f"{cik}:{accession}"
    if cache_key in FILING_XML_CACHE:
        return FILING_XML_CACHE[cache_key]
    accession_nodash = accession.replace("-", "")
    cik_int = str(int(cik))
    # primary_document from the submissions JSON points at SEC's XSLT-rendered
    # HTML view (e.g. "xslF345X06/form4.xml") — the raw XML sits under the
    # same filename directly in the accession root.
    filename = primary_document.rsplit("/", 1)[-1]
    url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_nodash}/{filename}"
    try:
        r = _sec_session().get(url)
        if r.status_code != 200:
            return None
        root = ET.fromstring(r.text)
        FILING_XML_CACHE[cache_key] = root
        return root
    except Exception as e:
        log.debug(f"Form 4 XML fetch/parse failed {url}: {e}")
        return None


def _parse_form4(root: ET.Element, filing_date: str, accession: str) -> List[Dict[str, Any]]:
    owner_el = root.find("reportingOwner")
    owner_name = _tag_value(owner_el, "reportingOwnerId/rptOwnerName") or "Unknown"
    rel = owner_el.find("reportingOwnerRelationship") if owner_el is not None else None
    title = None
    role_bits: List[str] = []
    if rel is not None:
        title = (rel.findtext("officerTitle") or "").strip() or None
        if (rel.findtext("isDirector") or "").strip().lower() in ("1", "true"):
            role_bits.append("Director")
        if (rel.findtext("isOfficer") or "").strip().lower() in ("1", "true") and not title:
            role_bits.append("Officer")
        if (rel.findtext("isTenPercentOwner") or "").strip().lower() in ("1", "true"):
            role_bits.append("10% Owner")
    role = title or (", ".join(role_bits) if role_bits else "Insider")

    out: List[Dict[str, Any]] = []
    table = root.find("nonDerivativeTable")
    if table is None:
        return out
    for txn in table.findall("nonDerivativeTransaction"):
        code = _tag_value(txn, "transactionCoding/transactionCode")
        label, sentiment = TRANSACTION_CODES.get(code or "", (code or "Unknown", "neutral"))
        shares = _safe(_tag_value(txn, "transactionAmounts/transactionShares"))
        price = _safe(_tag_value(txn, "transactionAmounts/transactionPricePerShare"))
        acq_disp = _tag_value(txn, "transactionAmounts/transactionAcquiredDisposedCode")
        shares_after = _safe(_tag_value(txn, "postTransactionAmounts/sharesOwnedFollowingTransaction"))
        txn_date = _tag_value(txn, "transactionDate") or filing_date
        out.append({
            "owner_name": owner_name,
            "owner_role": role,
            "transaction_date": txn_date,
            "filing_date": filing_date,
            "transaction_code": code,
            "transaction_label": label,
            "sentiment": sentiment,
            "acquired_disposed": acq_disp,
            "shares": shares,
            "price": price,
            "value": round(shares * price, 2) if (shares is not None and price is not None) else None,
            "shares_owned_after": shares_after,
            "accession": accession,
        })
    return out


def _empty_summary() -> Dict[str, Any]:
    return {"buy_count": 0, "sell_count": 0, "buy_value": 0, "sell_value": 0, "net_sentiment": "neutral", "window_days": 90}


def _compute_summary(transactions: List[Dict[str, Any]]) -> Dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    recent = [t for t in transactions if (t.get("transaction_date") or "") >= cutoff]
    buys = [t for t in recent if t["sentiment"] == "buy"]
    sells = [t for t in recent if t["sentiment"] == "sell"]
    buy_value = sum(t["value"] or 0 for t in buys)
    sell_value = sum(t["value"] or 0 for t in sells)
    if buy_value > sell_value * 1.2 and buy_value > 0:
        sentiment = "bullish"
    elif sell_value > buy_value * 1.2 and sell_value > 0:
        sentiment = "bearish"
    else:
        sentiment = "neutral"
    return {
        "buy_count": len(buys),
        "sell_count": len(sells),
        "buy_value": round(buy_value, 2),
        "sell_value": round(sell_value, 2),
        "net_sentiment": sentiment,
        "window_days": 90,
    }


async def get_insider_transactions(cik: str, limit: int = 15) -> Dict[str, Any]:
    cache_key = f"{cik}:{limit}"
    if cache_key in OWNERSHIP_CACHE:
        return OWNERSHIP_CACHE[cache_key]

    submissions = await asyncio.to_thread(_get_submissions, cik)
    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accessions = recent.get("accessionNumber") or []
    docs = recent.get("primaryDocument") or []

    form4_indices = [i for i, f in enumerate(forms) if f == "4"][:limit]
    if not form4_indices:
        out = {"available": True, "transactions": [], "summary": _empty_summary()}
        OWNERSHIP_CACHE[cache_key] = out
        return out

    async def _one(i: int) -> List[Dict[str, Any]]:
        root = await asyncio.to_thread(_fetch_form4_xml, cik, accessions[i], docs[i])
        if root is None:
            return []
        try:
            return _parse_form4(root, dates[i], accessions[i])
        except Exception as e:
            log.debug(f"parse form4 failed for {accessions[i]}: {e}")
            return []

    results = await asyncio.gather(*[_one(i) for i in form4_indices])
    transactions = [t for group in results for t in group]
    transactions.sort(key=lambda t: t.get("transaction_date") or "", reverse=True)

    out = {"available": True, "transactions": transactions, "summary": _compute_summary(transactions)}
    OWNERSHIP_CACHE[cache_key] = out
    return out


# ---------------------------------------------------------------------------
# Institutional holders (Yahoo-aggregated, labeled as such)
# ---------------------------------------------------------------------------

def _get_institutional_holders(symbol: str, limit: int = 10) -> Dict[str, Any]:
    summary = ss._yh_quote_summary(symbol)
    iho = (summary.get("institutionOwnership") or {}).get("ownershipList") or []
    holders = []
    for h in iho[:limit]:
        report_date = h.get("reportDate")
        holders.append({
            "organization": h.get("organization"),
            "pct_held": (lambda v: v * 100 if v is not None else None)(_safe(h.get("pctHeld"))),
            "shares": _safe(h.get("position")),
            "value": _safe(h.get("value")),
            "pct_change": (lambda v: v * 100 if v is not None else None)(_safe(h.get("pctChange"))),
            "report_date": report_date.get("fmt") if isinstance(report_date, dict) else report_date,
        })
    ks = summary.get("defaultKeyStatistics", {}) or {}
    pct_inst = _safe(ks.get("heldPercentInstitutions"))
    pct_insiders = _safe(ks.get("heldPercentInsiders"))
    return {
        "holders": holders,
        "pct_institutions": (pct_inst * 100) if pct_inst is not None else None,
        "pct_insiders": (pct_insiders * 100) if pct_insiders is not None else None,
        "source": "yahoo_aggregated",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_ownership(symbol: str) -> Dict[str, Any]:
    if symbol.upper().endswith(".NS"):
        return {
            "symbol": symbol,
            "available": False,
            "reason": "SEC EDGAR insider tracking covers US-listed securities only",
        }

    cik = _get_cik(symbol)
    institutional_task = asyncio.to_thread(_get_institutional_holders, symbol)

    if cik:
        insider_task = get_insider_transactions(cik)
    else:
        insider_task = asyncio.sleep(0, result={
            "available": False,
            "reason": "symbol not found in SEC EDGAR company records",
            "transactions": [],
            "summary": _empty_summary(),
        })

    insider_result, institutional_result = await asyncio.gather(insider_task, institutional_task)

    return {
        "symbol": symbol,
        "available": True,
        "insider": insider_result,
        "institutional": institutional_result,
    }
