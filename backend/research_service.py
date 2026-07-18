"""AI Research Analyst (Track C) — LLM-generated structured research notes.

Feeds Track A fundamentals (pillar scores, Piotroski/Altman, red flags, DCF,
peer comparison) plus live quote + recent headlines into Google's Gemini API,
and asks for a structured research note (thesis, bull/bear case, risks,
catalysts, valuation summary). Cached once per calendar day per symbol in
MongoDB.

Gracefully unavailable (503 from the route) when GOOGLE_API_KEY is unset —
this is an optional enhancement layer, not a hard dependency.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import stock_service as ss
import fundamentals_service as fs
import news_service as news

log = logging.getLogger(__name__)

MODEL = "gemini-3.5-flash"
COLLECTION = "research_notes"

_client = None
_client_checked = False


def _get_client():
    """Lazily construct the Google Gen AI client. Returns None if no API key configured."""
    global _client, _client_checked
    if _client_checked:
        return _client
    _client_checked = True
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        log.info("GOOGLE_API_KEY not set — AI research analyst disabled")
        return None
    try:
        from google import genai
        _client = genai.Client(api_key=api_key)
    except Exception as e:
        log.warning(f"failed to init Google Gen AI client: {e}")
        _client = None
    return _client


RESEARCH_NOTE_SCHEMA = {
    "type": "object",
    "properties": {
        "rating": {
            "type": "string",
            "enum": ["strong_buy", "buy", "hold", "sell", "strong_sell"],
        },
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "thesis": {
            "type": "string",
            "description": "2-4 sentence investment thesis synthesizing the fundamentals, valuation, and outlook.",
        },
        "bull_case": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 concrete, evidence-backed points supporting the bull case.",
        },
        "bear_case": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 concrete, evidence-backed points supporting the bear case.",
        },
        "risks": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 key risks to the thesis (business, financial, or market risks).",
        },
        "catalysts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "timeframe": {"type": "string", "description": "e.g. 'next quarter', '6-12 months', 'ongoing'"},
                },
                "required": ["title", "timeframe"],
                "additionalProperties": False,
            },
            "description": "2-4 near-term catalysts that could move the stock.",
        },
        "valuation_summary": {
            "type": "string",
            "description": "1-3 sentences on whether the stock looks cheap, fair, or expensive, referencing the DCF and peer multiples.",
        },
    },
    "required": ["rating", "confidence", "thesis", "bull_case", "bear_case", "risks", "catalysts", "valuation_summary"],
    "additionalProperties": False,
}


def _fmt(v, suffix: str = "", digits: int = 1) -> str:
    if v is None:
        return "n/a"
    try:
        return f"{v:.{digits}f}{suffix}"
    except (TypeError, ValueError):
        return str(v)


def _build_context(symbol: str, bundle: Dict[str, Any], fund: Dict[str, Any], peers: Dict[str, Any], headlines: list) -> str:
    lines = []
    ccy = bundle.get("currency", "")
    lines.append(f"## {bundle.get('name') or symbol} ({symbol}) — {bundle.get('sector') or 'n/a'} / {bundle.get('industry') or 'n/a'}")
    lines.append(
        f"Price: {_fmt(bundle.get('price'))} {ccy} ({_fmt(bundle.get('change_pct'), '%')} today) | "
        f"Market cap: {_fmt((bundle.get('market_cap') or 0) / 1e9, 'B')} | "
        f"P/E: {_fmt(bundle.get('pe'))} | Fwd P/E: {_fmt(bundle.get('forward_pe'))} | P/B: {_fmt(bundle.get('pb'))} | "
        f"ROE: {_fmt(bundle.get('roe'), '%')} | Debt/Equity: {_fmt(bundle.get('debt_to_equity'))} | "
        f"Rev growth: {_fmt(bundle.get('revenue_growth'), '%')} | EPS growth: {_fmt(bundle.get('eps_growth'), '%')}"
    )

    if fund.get("available"):
        pillars = fund.get("pillar_scores", {})
        pio = fund.get("piotroski", {})
        alt = fund.get("altman", {})
        eq = fund.get("earnings_quality", {})
        lines.append(
            f"\n## Fundamentals engine\nPillar scores (0-100) — Quality: {pillars.get('quality')}, "
            f"Health: {pillars.get('health')}, Growth: {pillars.get('growth')}"
        )
        lines.append(f"Piotroski F-Score: {pio.get('score')}/9 ({pio.get('label')})")
        if alt.get("score") is not None:
            lines.append(f"Altman Z-Score: {alt.get('score')} ({alt.get('zone')} zone)")
        lines.append(f"Earnings quality: {eq.get('label')} (accruals ratio {_fmt(eq.get('accruals_ratio'), digits=3)})")

        flags = fund.get("red_flags", [])
        if flags:
            lines.append("\nRed flags:")
            for f in flags[:6]:
                lines.append(f"- [{f['severity']}] {f['title']}: {f['detail']}")
        else:
            lines.append("\nNo red flags detected by the automated screen.")

        dcf = fund.get("dcf", {})
        if dcf.get("available"):
            lines.append(
                f"\nDCF (default assumptions: {dcf['assumptions']['growth_pct']}% growth, "
                f"{dcf['assumptions']['discount_pct']}% discount rate): intrinsic value "
                f"{_fmt(dcf.get('intrinsic_value_per_share'), digits=2)} {ccy}/share vs price "
                f"{_fmt(dcf.get('price'), digits=2)} {ccy} → {_fmt(dcf.get('upside_pct'), '%')} "
                f"({dcf.get('verdict')})"
            )
        else:
            lines.append(f"\nDCF not computable: {dcf.get('reason')}")

    if peers.get("available") and peers.get("peers"):
        target_row = next((p for p in peers["peers"] if p.get("is_target")), None)
        lines.append(f"\n## Peer comparison ({peers.get('sector')}, {peers.get('count')} names)")
        if target_row:
            lines.append(
                f"This stock ranks #{target_row['rank']} of {peers['count']} on composite score "
                f"(valuation {target_row.get('valuation_score')}, growth {target_row.get('growth_score')}, "
                f"quality {target_row.get('quality_score')})"
            )
        for p in peers["peers"][:6]:
            marker = " <- this stock" if p.get("is_target") else ""
            lines.append(f"- {p['symbol']}: P/E {_fmt(p.get('pe'))}, ROE {_fmt(p.get('roe'), '%')}, composite {p.get('composite_score')}{marker}")

    if headlines:
        lines.append("\n## Recent headlines")
        for h in headlines[:6]:
            lines.append(f"- ({h.get('publisher')}) {h.get('title')}")

    return "\n".join(lines)


async def generate_note(symbol: str) -> Optional[Dict[str, Any]]:
    """Call Gemini to generate a fresh research note. Returns None if the client is unavailable."""
    client = _get_client()
    if client is None:
        return None

    bundle, fund, peers, news_result = await _gather(symbol)
    if not isinstance(bundle, dict) or bundle.get("error") or bundle.get("price") is None:
        return {"__no_data__": True}

    headlines = (news_result or {}).get("news", []) if isinstance(news_result, dict) else []
    context = _build_context(symbol, bundle, fund if isinstance(fund, dict) else {}, peers if isinstance(peers, dict) else {}, headlines)

    system_prompt = (
        "You are an equity research analyst writing an internal research note for a retail stock "
        "screener product. You are given live market data, computed fundamental scores (Piotroski "
        "F-Score, Altman Z-Score, a DCF valuation, and peer comparisons), and recent headlines. "
        "Write a balanced, evidence-based note. Ground every claim in the data provided — do not "
        "invent facts, financial figures, or events not present in the context. If the data is "
        "thin or conflicting, say so and lower your confidence rather than overstating certainty. "
        "This is not personalized investment advice; write as objective research, not a recommendation "
        "to any specific individual."
    )

    try:
        from google.genai import types
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=f"Write a research note for this stock based on the data below.\n\n{context}",
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                response_json_schema=RESEARCH_NOTE_SCHEMA,
            ),
        )
    except Exception as e:
        log.warning(f"research note generation failed for {symbol}: {e}")
        return {"__error__": str(e)}

    if not response.candidates:
        block_reason = getattr(getattr(response, "prompt_feedback", None), "block_reason", None)
        return {"__error__": f"generation blocked ({block_reason or 'no candidates'})"}

    finish_reason = str(response.candidates[0].finish_reason or "")
    if finish_reason and finish_reason not in ("STOP", "FinishReason.STOP"):
        return {"__error__": f"generation blocked ({finish_reason})"}

    text = response.text
    if not text:
        return {"__error__": "empty response"}

    try:
        note = json.loads(text)
    except Exception:
        return {"__error__": "malformed response"}

    note["symbol"] = symbol
    note["generated_at"] = datetime.now(timezone.utc).isoformat()
    note["model"] = MODEL
    note["as_of_price"] = bundle.get("price")
    return note


async def _gather(symbol: str):
    return await asyncio.gather(
        ss.get_bundle(symbol),
        fs.get_fundamentals(symbol),
        fs.get_peers(symbol),
        news.stock_news(symbol, 8),
        return_exceptions=False,
    )


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def get_research_note(symbol: str, db, force: bool = False) -> Dict[str, Any]:
    """Cached-per-day research note. `db` is the Motor database handle from server.py."""
    if _get_client() is None:
        return {
            "error": "unavailable",
            "detail": "AI research analyst is not configured (GOOGLE_API_KEY not set on the server).",
        }

    today = _today_key()
    if not force:
        existing = await db[COLLECTION].find_one({"symbol": symbol, "date": today}, {"_id": 0})
        if existing:
            return existing["note"]

    note = await generate_note(symbol)
    if note is None:
        return {"error": "unavailable", "detail": "AI research analyst is not configured."}
    if note.get("__no_data__"):
        return {"error": "no_data"}
    if note.get("__error__"):
        # Fall back to the most recent cached note (any date) if generation fails
        stale = await db[COLLECTION].find_one({"symbol": symbol}, {"_id": 0}, sort=[("date", -1)])
        if stale:
            stale["note"]["stale"] = True
            return stale["note"]
        return {"error": "unavailable", "detail": f"Research generation failed: {note['__error__']}"}

    await db[COLLECTION].update_one(
        {"symbol": symbol, "date": today},
        {"$set": {"symbol": symbol, "date": today, "note": note}},
        upsert=True,
    )
    return note
