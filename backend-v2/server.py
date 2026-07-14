from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
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
import ingestion_service as ing
import auth_service as auth
from auth_service import FirebaseUser
from stock_universe import get_universe, currency
from watchlist_import import (
    resolve_symbols,
)
from portfolio_document import (
    OcrUnavailableError,
    UnsupportedPortfolioFileError,
    extract_raw_symbols_from_upload,
    is_supported_extension,
    max_bytes_for_filename,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Radar Stock Screener")
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
api_router = APIRouter(prefix="/api")


# ---------- Watchlist Models (server-side optional persistence) ----------
class WatchlistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # Firebase UID
    symbol: str
    market: str
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WatchlistAdd(BaseModel):
    user_id: Optional[str] = None
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
    user_id: Optional[str] = None
    name: str
    market: str
    filters: Dict[str, Any]


class UserProfile(BaseModel):
    uid: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    onboarding_completed: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CompleteOnboardingRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=50)


class CustomScreenRequest(BaseModel):
    market: str = "US"
    filters: Dict[str, Any] = {}
    sort_by: Optional[str] = "market_cap"
    sort_desc: bool = True
    limit: int = 50


class IngestionRefreshSymbol(BaseModel):
    market: Optional[str] = None
    datasets: Optional[List[str]] = None
    sync: bool = False
    force: bool = False


class IngestionRefreshMarket(BaseModel):
    market: str
    datasets: Optional[List[str]] = None
    batch_size: int = 25
    dry_run: bool = False
    sync: bool = False
    offset: int = 0
    limit: Optional[int] = None
    force: bool = False


class IngestionRefreshDataset(BaseModel):
    dataset: str
    symbol: Optional[str] = None
    market: Optional[str] = None
    batch_size: int = 25
    dry_run: bool = False
    sync: bool = False
    offset: int = 0
    limit: Optional[int] = None
    force: bool = False


class IngestionNightlyRequest(BaseModel):
    partitions: Optional[List[str]] = None
    datasets: Optional[List[str]] = None
    batch_size: int = 25
    dry_run: bool = False
    sync: bool = False
    offset: int = 0
    limit: Optional[int] = None
    force: bool = False


class IngestionPreviewSymbol(BaseModel):
    market: Optional[str] = None
    datasets: Optional[List[str]] = None
    force: bool = False


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
    """Combined call for the Markets screen (fast path — no full-universe wait)."""
    import asyncio

    overview = await ss.get_markets_overview_fast(market, limit=10)

    # Warm the full universe in the background for Radar / Screener / sectors.
    key = f"universe_full:{market.upper()}"
    if key not in ss.UNIVERSE_BUNDLE_CACHE:
        asyncio.create_task(ss.get_market_universe(market))

    return overview


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


# ---------- Ingestion (Investing.com batch + on-demand refresh) ----------
@api_router.get("/ingestion/status")
async def ingestion_status():
    return await ing.ingestion_status()


@api_router.get("/ingestion/partitions")
async def ingestion_partitions():
    return {"partitions": ing.partition_info()}


@api_router.get("/ingestion/runs")
async def ingestion_runs(limit: int = Query(25, ge=1, le=100), run_type: Optional[str] = Query(None)):
    return await ing.list_runs(limit=limit, run_type=run_type)


@api_router.get("/ingestion/runs/{run_id}")
async def ingestion_run_detail(run_id: str):
    return await ing.get_run(run_id)


@api_router.post("/ingestion/preview/symbol/{symbol}")
async def ingestion_preview_symbol(
    symbol: str,
    req: IngestionPreviewSymbol = IngestionPreviewSymbol(),
    _: None = Depends(ing.check_ingestion_auth),
):
    return await ing.preview_symbol(
        symbol,
        market=req.market,
        datasets=req.datasets,
        force=req.force,
    )


@api_router.post("/ingestion/refresh/symbol/{symbol}")
async def ingestion_refresh_symbol(
    symbol: str,
    req: IngestionRefreshSymbol = IngestionRefreshSymbol(),
    _: None = Depends(ing.check_ingestion_auth),
):
    return await ing.refresh_symbol(
        symbol,
        market=req.market,
        datasets=req.datasets,
        sync=req.sync,
        force=req.force,
    )


@api_router.post("/ingestion/refresh/market")
async def ingestion_refresh_market(
    req: IngestionRefreshMarket,
    _: None = Depends(ing.check_ingestion_auth),
):
    return await ing.refresh_market(
        req.market,
        datasets=req.datasets,
        batch_size=req.batch_size,
        dry_run=req.dry_run,
        sync=req.sync,
        offset=req.offset,
        limit=req.limit,
        force=req.force,
    )


@api_router.post("/ingestion/refresh/dataset")
async def ingestion_refresh_dataset(
    req: IngestionRefreshDataset,
    _: None = Depends(ing.check_ingestion_auth),
):
    return await ing.refresh_dataset(
        req.dataset,
        symbol=req.symbol,
        market=req.market,
        batch_size=req.batch_size,
        dry_run=req.dry_run,
        sync=req.sync,
        offset=req.offset,
        limit=req.limit,
        force=req.force,
    )


@api_router.post("/ingestion/refresh/nightly")
async def ingestion_refresh_nightly(
    req: IngestionNightlyRequest = IngestionNightlyRequest(),
    _: None = Depends(ing.check_ingestion_auth),
):
    return await ing.refresh_nightly(
        partitions=req.partitions,
        datasets=req.datasets,
        batch_size=req.batch_size,
        dry_run=req.dry_run,
        sync=req.sync,
        offset=req.offset,
        limit=req.limit,
        force=req.force,
    )


# ---------- User profile / onboarding ----------
def _token_display_name(user: FirebaseUser) -> Optional[str]:
    claims = user.claims or {}
    name = claims.get("name") or claims.get("display_name")
    if isinstance(name, str):
        name = name.strip()
        return name[:50] if name else None
    return None


async def _get_or_create_user_profile(user: FirebaseUser) -> Dict[str, Any]:
    existing = await db.users.find_one({"uid": user.uid}, {"_id": 0})
    if existing:
        # Repair rows auto-marked complete by the old Firebase-metadata heuristic
        # (those never received onboarding_completed_at from POST /me/onboarding).
        if existing.get("onboarding_completed") and not existing.get("onboarding_completed_at"):
            await db.users.update_one(
                {"uid": user.uid},
                {"$set": {"onboarding_completed": False}},
            )
            existing = {**existing, "onboarding_completed": False}
        return existing

    # No profile yet => app-level new user; require the name onboarding screen.
    profile = UserProfile(
        uid=user.uid,
        email=user.email,
        display_name=_token_display_name(user),
        onboarding_completed=False,
    )
    doc = profile.dict()
    await db.users.insert_one(doc)
    return doc


@api_router.get("/me")
@limiter.limit("60/minute")
async def get_me(
    request: Request,
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    profile = await _get_or_create_user_profile(user)
    # Prefer Google name from the token until the user finishes onboarding.
    if not profile.get("onboarding_completed") and not profile.get("display_name"):
        suggested = _token_display_name(user)
        if suggested:
            profile = {**profile, "display_name": suggested}
    return profile


@api_router.post("/me/onboarding")
@limiter.limit("20/minute")
async def complete_onboarding(
    request: Request,
    body: CompleteOnboardingRequest,
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    display_name = body.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    now = datetime.now(timezone.utc)
    await _get_or_create_user_profile(user)
    await db.users.update_one(
        {"uid": user.uid},
        {
            "$set": {
                "display_name": display_name[:50],
                "email": user.email,
                "onboarding_completed": True,
                "onboarding_completed_at": now,
                "updated_at": now,
            }
        },
    )
    profile = await db.users.find_one({"uid": user.uid}, {"_id": 0})
    return profile


# ---------- Watchlist (server-side mirror, primary store is on-device) ----------
@api_router.post("/watchlist")
@limiter.limit("30/minute")
async def add_watchlist(
    request: Request,
    item: WatchlistAdd,
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    if item.user_id and item.user_id != user.uid:
        raise HTTPException(status_code=403, detail="Forbidden")
    existing = await db.watchlist.find_one({"user_id": user.uid, "symbol": item.symbol})
    if existing:
        return {"ok": True, "duplicate": True}
    w = WatchlistItem(user_id=user.uid, symbol=item.symbol, market=item.market)
    await db.watchlist.insert_one(w.dict())
    return {"ok": True, "item": w.dict()}


@api_router.delete("/watchlist/{user_id}/{symbol}")
@limiter.limit("30/minute")
async def remove_watchlist(
    request: Request,
    user_id: str,
    symbol: str,
    user: FirebaseUser = Depends(auth.require_self_user),
):
    res = await db.watchlist.delete_one({"user_id": user.uid, "symbol": symbol})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.get("/watchlist/{user_id}")
@limiter.limit("30/minute")
async def list_watchlist(
    request: Request,
    user_id: str,
    user: FirebaseUser = Depends(auth.require_self_user),
):
    items = await db.watchlist.find({"user_id": user.uid}, {"_id": 0}).to_list(200)
    return {"items": items}


@api_router.post("/watchlist/import")
@limiter.limit("10/minute")
async def import_watchlist_portfolio(
    request: Request,
    file: UploadFile = File(...),
    market: Optional[str] = Form(None),
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    """Parse a portfolio file (CSV/TSV/TXT/PDF/image) and bulk-add valid symbols to the user's watchlist."""
    filename = (file.filename or "").lower()
    if filename and not is_supported_extension(filename):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload CSV, TSV, TXT, PDF, or an image (JPEG/PNG/WebP).",
        )

    market_override = None
    if market:
        market_override = market.strip().upper()
        if market_override not in ("US", "IN"):
            raise HTTPException(status_code=400, detail="market must be US or IN")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    size_limit = max_bytes_for_filename(filename)
    if len(raw_bytes) > size_limit:
        mb = size_limit // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"File too large (max {mb} MB)")

    try:
        raw_symbols, source = extract_raw_symbols_from_upload(
            raw_bytes,
            filename,
            file.content_type,
            market=market_override,
        )
    except UnsupportedPortfolioFileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OcrUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Unable to decode file as text") from exc

    if not raw_symbols:
        raise HTTPException(status_code=400, detail="No symbols found in file")

    resolved = resolve_symbols(raw_symbols, market=market_override)
    valid = resolved["valid"]
    invalid = resolved["invalid"]

    added: List[Dict[str, str]] = []
    duplicates = 0

    if valid:
        existing_docs = await db.watchlist.find(
            {"user_id": user.uid, "symbol": {"$in": [v["symbol"] for v in valid]}},
            {"_id": 0, "symbol": 1},
        ).to_list(len(valid))
        existing_symbols = {doc["symbol"] for doc in existing_docs}

        ops = []
        now = datetime.now(timezone.utc)
        for entry in valid:
            if entry["symbol"] in existing_symbols:
                duplicates += 1
                continue
            item = WatchlistItem(
                user_id=user.uid,
                symbol=entry["symbol"],
                market=entry["market"],
                added_at=now,
            )
            doc = item.dict()
            ops.append(
                UpdateOne(
                    {"user_id": user.uid, "symbol": entry["symbol"]},
                    {"$setOnInsert": doc},
                    upsert=True,
                )
            )
            added.append({"symbol": entry["symbol"], "market": entry["market"]})

        if ops:
            await db.watchlist.bulk_write(ops, ordered=False)

    return {
        "ok": True,
        "summary": {
            "parsed": resolved["parsed"],
            "added": len(added),
            "duplicates": duplicates,
            "invalid": len(invalid),
            "truncated": resolved["truncated"],
            "source": source,
        },
        "added": added,
        "invalid": invalid,
    }


# ---------- Saved Screens ----------
@api_router.post("/screens")
@limiter.limit("30/minute")
async def save_screen(
    request: Request,
    req: SavedScreenCreate,
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    if req.user_id and req.user_id != user.uid:
        raise HTTPException(status_code=403, detail="Forbidden")
    s = SavedScreen(
        user_id=user.uid,
        name=req.name,
        market=req.market,
        filters=req.filters,
    )
    await db.screens.insert_one(s.dict())
    return {"ok": True, "screen": s.dict()}


@api_router.get("/screens/{user_id}")
@limiter.limit("30/minute")
async def list_screens(
    request: Request,
    user_id: str,
    user: FirebaseUser = Depends(auth.require_self_user),
):
    items = await db.screens.find({"user_id": user.uid}, {"_id": 0}).to_list(100)
    return {"items": items}


@api_router.delete("/screens/{screen_id}")
@limiter.limit("30/minute")
async def delete_screen(
    request: Request,
    screen_id: str,
    user: FirebaseUser = Depends(auth.require_firebase_user),
):
    screen = await db.screens.find_one({"id": screen_id})
    if not screen:
        return {"ok": True, "deleted": 0}
    if screen.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Forbidden")
    res = await db.screens.delete_one({"id": screen_id, "user_id": user.uid})
    return {"ok": True, "deleted": res.deleted_count}


# ---------- Mount ----------
app.include_router(api_router)

cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
cors_origins = [origin.strip() for origin in cors_origins if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def prewarm():
    """Pre-warm caches so the first Markets screen load is fast."""
    import asyncio

    async def _warm():
        try:
            # Quote+index path first (what /markets/overview needs), then full universe.
            await ss.get_markets_overview_fast("US", limit=10)
            logger.info("Markets overview cache prewarmed for US")
            await ss.get_market_universe("US")
            await ss.get_market_universe("IN")
            logger.info("Universe cache prewarmed for US + IN")
        except Exception as e:
            logger.warning(f"prewarm failed: {e}")

    asyncio.create_task(_warm())


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
