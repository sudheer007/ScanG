from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime, timezone

import stock_service as ss
import discover_service as ds
import analyzer_service as az
import news_service as news
import fundamentals_service as fs
import research_service as rs
import insider_service as ins
import market_intel_service as mi
import predictions_service as ps
from stock_universe import get_universe, currency

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Radar Stock Screener")
api_router = APIRouter(prefix="/api")


# ---------- Watchlist Models (server-side optional persistence) ----------
class WatchlistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # client-generated anonymous id
    symbol: str
    market: str
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WatchlistAdd(BaseModel):
    user_id: str
    symbol: str
    market: str


class SavedScreen(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    market: str
    filters: Dict[str, Any]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SavedScreenCreate(BaseModel):
    user_id: str
    name: str
    market: str
    filters: Dict[str, Any]


class CustomScreenRequest(BaseModel):
    market: str = "US"
    filters: Dict[str, Any] = {}
    sort_by: Optional[str] = "market_cap"
    sort_desc: bool = True
    limit: int = 50


# ---------- Root ----------
@api_router.get("/")
async def root():
    return {"app": "Radar Stock Screener", "version": "1.0", "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


# ---------- Markets ----------
@api_router.get("/markets/indices")
async def markets_indices(market: str = Query("US")):
    data = await ss.get_market_indices(market)
    return {"market": market.upper(), "currency": currency(market), "indices": data}


@api_router.get("/markets/movers")
async def markets_movers(
    market: str = Query("US"),
    type: str = Query("gainers"),
    limit: int = Query(15, ge=1, le=50),
):
    movers = await ss.get_movers(market, type, limit)
    return {"market": market.upper(), "currency": currency(market), "type": type, "stocks": movers}


@api_router.get("/markets/overview")
async def markets_overview(market: str = Query("US")):
    """Combined call for the Markets screen."""
    indices = await ss.get_market_indices(market)
    gainers = await ss.get_movers(market, "gainers", 10)
    losers = await ss.get_movers(market, "losers", 10)
    return {
        "market": market.upper(),
        "currency": currency(market),
        "indices": indices,
        "gainers": gainers,
        "losers": losers,
    }


# ---------- Stocks ----------
@api_router.get("/stocks/{symbol}")
async def stock_detail(symbol: str):
    bundle = await ss.get_bundle(symbol)
    if bundle.get("error"):
        raise HTTPException(status_code=404, detail=f"Stock {symbol} not found")
    return bundle


@api_router.get("/stocks/{symbol}/history")
async def stock_history(
    symbol: str,
    period: str = Query("1mo"),
    interval: str = Query("1d"),
):
    valid_p = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
    valid_i = {"1m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk", "1mo"}
    if period not in valid_p:
        raise HTTPException(400, f"period must be one of {valid_p}")
    if interval not in valid_i:
        raise HTTPException(400, f"interval must be one of {valid_i}")
    data = await ss.get_history(symbol, period, interval)
    return {"symbol": symbol, "period": period, "interval": interval, "points": data}


@api_router.get("/stocks/{symbol}/events")
async def stock_events(symbol: str):
    """Per-stock events: analyst upgrade/downgrade history, earnings history & surprises, calendar."""
    return await ss.get_stock_events(symbol)


@api_router.get("/stocks/batch/quotes")
async def stock_batch_quotes(symbols: str = Query(...)):
    """Comma-separated symbols. Used for watchlist refresh."""
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return {"quotes": []}
    quotes = await ss.get_quotes(sym_list[:50])
    return {"quotes": quotes}


# ---------- Radar Strategies ----------
@api_router.get("/radar/strategies")
async def radar_strategies():
    return {
        "strategies": [
            {"key": k, **v} for k, v in ss.RADAR_STRATEGIES.items()
        ]
    }


@api_router.get("/radar/{strategy}")
async def radar_run(strategy: str, market: str = Query("US")):
    if strategy not in ss.RADAR_STRATEGIES:
        raise HTTPException(404, f"Unknown strategy: {strategy}")
    return await ss.run_radar(strategy, market)


# ---------- Custom Screener ----------
@api_router.post("/screener/custom")
async def screener_custom(req: CustomScreenRequest):
    universe = await ss.get_market_universe(req.market)
    filtered = ss.custom_screen(universe, req.filters or {})
    if req.sort_by:
        filtered.sort(
            key=lambda x: (x.get(req.sort_by) if x.get(req.sort_by) is not None else (-1e18 if req.sort_desc else 1e18)),
            reverse=req.sort_desc,
        )
    return {
        "market": req.market.upper(),
        "currency": currency(req.market),
        "filters": req.filters,
        "count": len(filtered),
        "stocks": filtered[: req.limit],
    }


@api_router.get("/screener/universe")
async def screener_universe(market: str = Query("US")):
    """Return full bundled universe (cached). Use sparingly in UI."""
    universe = await ss.get_market_universe(market)
    return {"market": market.upper(), "currency": currency(market), "count": len(universe), "stocks": universe}


# ---------- Search ----------
@api_router.get("/search")
async def search_stocks(q: str = Query(..., min_length=1)):
    q_low = q.lower()
    results = []
    # Search across both universes
    for market in ("US", "IN"):
        universe = await ss.get_market_universe(market)
        for st in universe:
            if (q_low in st["symbol"].lower()) or (q_low in (st.get("name") or "").lower()):
                results.append({
                    "symbol": st["symbol"],
                    "name": st.get("name"),
                    "market": market,
                    "price": st.get("price"),
                    "change_pct": st.get("change_pct"),
                    "currency": st.get("currency"),
                })
        if len(results) >= 20:
            break
    return {"query": q, "results": results[:20]}


# ---------- News (Yahoo Finance — real publishers, no API key) ----------
@api_router.get("/news/market")
async def news_market(market: str = Query("US"), limit: int = Query(30, ge=1, le=60)):
    return await news.market_news(market, limit)


@api_router.get("/news/stock/{symbol}")
async def news_stock(symbol: str, limit: int = Query(20, ge=1, le=40)):
    return await news.stock_news(symbol, limit)


# ---------- Discover (combined widgets feed + per-widget details) ----------
@api_router.get("/discover/feed")
async def discover_feed(market: str = Query("US")):
    return await ds.discover_feed(market)


@api_router.get("/discover/ai-picks")
async def discover_ai_picks(market: str = Query("US"), limit: int = Query(20, ge=1, le=50)):
    return await ds.ai_picks(market, limit)


@api_router.get("/discover/events")
async def discover_events(market: str = Query("US"), limit: int = Query(40, ge=1, le=80)):
    return await ds.market_events(market, limit)


@api_router.get("/discover/analyst-ratings")
async def discover_analyst_ratings(market: str = Query("US"), limit: int = Query(30, ge=1, le=80)):
    return await ds.analyst_ratings(market, limit)


@api_router.get("/discover/popular-screeners")
async def discover_popular_screeners(market: str = Query("US")):
    return await ds.popular_screeners(market)


@api_router.get("/discover/valuation")
async def discover_valuation(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    return await ds.valuation(market, limit)


@api_router.get("/discover/investor-picks")
async def discover_investor_picks(market: str = Query("US"), limit: int = Query(12, ge=1, le=30)):
    return await ds.investor_picks(market, limit)


@api_router.get("/discover/most-active")
async def discover_most_active(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    return await ds.most_active(market, limit)


@api_router.get("/discover/winners-losers")
async def discover_winners_losers(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    return await ds.winners_losers(market, limit)


# ---------- Analyzer / new widgets ----------
@api_router.get("/discover/forecast")
async def discover_forecast(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    return await az.forecast_horizons(market, limit)


@api_router.get("/discover/earnings-calendar")
async def discover_earnings_calendar(market: str = Query("US"), limit: int = Query(50, ge=1, le=120), days_ahead: int = Query(45, ge=1, le=90)):
    return await az.earnings_calendar(market, limit, days_ahead)


@api_router.get("/discover/dividend-calendar")
async def discover_dividend_calendar(market: str = Query("US"), limit: int = Query(50, ge=1, le=120), days_ahead: int = Query(60, ge=1, le=90)):
    return await az.dividend_calendar(market, limit, days_ahead)


@api_router.get("/discover/sector-rotation")
async def discover_sector_rotation(market: str = Query("US")):
    return await az.sector_rotation(market)


@api_router.get("/discover/institutional-activity")
async def discover_institutional_activity(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    return await az.institutional_activity(market, limit)


@api_router.get("/analyzer/{symbol}")
async def deep_analyzer(symbol: str):
    return await az.analyzer(symbol)


# ---------- Fundamentals Engine (Track A) ----------
@api_router.get("/fundamentals/{symbol}")
async def fundamentals_detail(symbol: str):
    """Piotroski F-Score, Altman Z-Score, earnings quality, trajectories, red flags, default DCF."""
    result = await fs.get_fundamentals(symbol)
    if not result.get("available"):
        raise HTTPException(status_code=404, detail=result.get("reason", f"Fundamentals for {symbol} not found"))
    return result


@api_router.get("/fundamentals/{symbol}/dcf")
async def fundamentals_dcf(
    symbol: str,
    growth: Optional[float] = Query(None, description="Revenue/FCF growth %, stage 1"),
    discount: float = Query(10.0, ge=1.0, le=30.0, description="Discount rate %"),
    terminal_growth: float = Query(2.5, ge=0.0, le=6.0, description="Terminal growth %"),
    years: int = Query(10, ge=3, le=20),
):
    """DCF intrinsic value with adjustable assumptions."""
    result = await fs.get_dcf(symbol, growth, discount, terminal_growth, years)
    if result.get("reason") == "no financial statements found":
        raise HTTPException(status_code=404, detail=result["reason"])
    return result


@api_router.get("/fundamentals/{symbol}/peers")
async def fundamentals_peers(symbol: str):
    """Sector peer comparison ranked on valuation / growth / quality."""
    result = await fs.get_peers(symbol)
    if not result.get("available"):
        raise HTTPException(status_code=404, detail=result.get("reason", f"Peers for {symbol} not found"))
    return result


# ---------- AI Research Analyst (Track C) ----------
@api_router.get("/research/{symbol}")
async def research_note(symbol: str, force: bool = Query(False)):
    """LLM-generated research note: thesis, bull/bear case, risks, catalysts, valuation summary."""
    result = await rs.get_research_note(symbol, db, force)
    if result.get("error") == "unavailable":
        raise HTTPException(status_code=503, detail=result.get("detail", "AI research analyst not configured"))
    if result.get("error") == "no_data":
        raise HTTPException(status_code=404, detail=f"Not enough data to research {symbol}")
    return result


# ---------- Insider & Institutional Ownership (Track B) ----------
@api_router.get("/ownership/{symbol}")
async def ownership(symbol: str):
    """Real SEC EDGAR Form 4 insider transactions + Yahoo-aggregated institutional holders. US stocks only."""
    return await ins.get_ownership(symbol)


# ---------- Market Intelligence ----------
@api_router.get("/markets/breadth")
async def markets_breadth(market: str = Query("US")):
    """Universe-wide breadth internals + composite regime gauge."""
    return await mi.market_breadth(market)


@api_router.get("/risk/{symbol}")
async def risk_profile(symbol: str):
    """Quant risk profile: volatility, drawdown, Sharpe/Sortino, VaR, beta & relative strength vs benchmark."""
    result = await mi.risk_profile(symbol)
    if not result.get("available"):
        raise HTTPException(status_code=404, detail=result.get("reason", f"Not enough history for {symbol}"))
    return result


@api_router.get("/discover/short-interest")
async def discover_short_interest(market: str = Query("US"), limit: int = Query(25, ge=1, le=80)):
    """Short interest & squeeze radar (US only — Yahoo has no NSE short data)."""
    return await mi.short_interest_radar(market, limit)


@api_router.get("/portfolio/insights")
async def portfolio_insights(symbols: str = Query(..., description="Comma-separated symbols")):
    """Basket-level intelligence for a watchlist: exposure, correlation, risk flags, catalysts."""
    syms = [s for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(status_code=400, detail="No symbols provided")
    return await mi.portfolio_insights(syms)


# ---------- Prediction ledger / accountability ----------
@api_router.get("/track-record")
async def track_record(
    market: Optional[str] = Query(None),
    pred_type: Optional[str] = Query(None, description="rating | forecast | radar"),
    key: Optional[str] = Query(None, description="e.g. STRONG_BUY, 1M, momentum_breakouts"),
    limit: int = Query(50, ge=1, le=200),
):
    """Graded track record of every past call the app has made, benchmark-relative.

    No filters = global scorecard with a per-key breakdown. Filter by
    pred_type/key to stamp a specific strategy/rating/horizon card.
    """
    return await ps.get_track_record(db, market, pred_type, key, limit)


class SinceAddedItem(BaseModel):
    symbol: str
    market: str = "US"
    added_at: float  # epoch seconds


class SinceAddedRequest(BaseModel):
    items: List[SinceAddedItem]


@api_router.post("/portfolio/since-added")
async def portfolio_since_added(req: SinceAddedRequest):
    """Personal accountability: how each watchlist symbol has performed since the user added it, vs benchmark.

    Takes the client's own on-device watchlist (symbol + add timestamp) —
    the watchlist has no server-side source of truth to read from.
    """
    items = [i.dict() for i in req.items]
    return await ps.since_added_performance(items)


@api_router.post("/admin/predictions/capture")
async def admin_capture_predictions(market: str = Query("US")):
    """Daily snapshot job — called by the scheduled GitHub Action, not the app."""
    return await ps.capture_daily_snapshot(db, market)


@api_router.post("/admin/predictions/resolve")
async def admin_resolve_predictions():
    """Grades every prediction whose horizon has elapsed. Called by the scheduled GitHub Action."""
    return await ps.resolve_due(db)



# ---------- Watchlist (server-side mirror, primary store is on-device) ----------
@api_router.post("/watchlist")
async def add_watchlist(item: WatchlistAdd):
    existing = await db.watchlist.find_one({"user_id": item.user_id, "symbol": item.symbol})
    if existing:
        return {"ok": True, "duplicate": True}
    w = WatchlistItem(**item.dict())
    await db.watchlist.insert_one(w.dict())
    return {"ok": True, "item": w.dict()}


@api_router.delete("/watchlist/{user_id}/{symbol}")
async def remove_watchlist(user_id: str, symbol: str):
    res = await db.watchlist.delete_one({"user_id": user_id, "symbol": symbol})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.get("/watchlist/{user_id}")
async def list_watchlist(user_id: str):
    items = await db.watchlist.find({"user_id": user_id}, {"_id": 0}).to_list(200)
    return {"items": items}


# ---------- Saved Screens ----------
@api_router.post("/screens")
async def save_screen(req: SavedScreenCreate):
    s = SavedScreen(**req.dict())
    await db.screens.insert_one(s.dict())
    return {"ok": True, "screen": s.dict()}


@api_router.get("/screens/{user_id}")
async def list_screens(user_id: str):
    items = await db.screens.find({"user_id": user_id}, {"_id": 0}).to_list(100)
    return {"items": items}


@api_router.delete("/screens/{screen_id}")
async def delete_screen(screen_id: str):
    res = await db.screens.delete_one({"id": screen_id})
    return {"ok": True, "deleted": res.deleted_count}


# ---------- Mount ----------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


_prewarm_task = None


@app.on_event("startup")
async def prewarm():
    """Keep the universe cache warm on a timer so real requests never pay the
    full-universe Yahoo fetch cost. UNIVERSE_BUNDLE_CACHE's TTL (10 min) is
    longer than this refresh interval, so as long as this loop is running the
    cache never goes cold — only a backend restart (deploy) causes one cold
    request before the first cycle completes."""
    import asyncio

    async def _loop():
        while True:
            try:
                await ss.get_market_universe("US")
                await ss.get_market_universe("IN")
                logger.info("Universe cache prewarmed for US + IN")
            except Exception as e:
                logger.warning(f"prewarm cycle failed: {e}")
            await asyncio.sleep(5 * 60)

    global _prewarm_task
    _prewarm_task = asyncio.create_task(_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    if _prewarm_task:
        _prewarm_task.cancel()
    client.close()
