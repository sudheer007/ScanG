# ScanG — Radar Stock Screener

Full-stack stock screener/analyzer for US + Indian markets. Originally scaffolded on Emergent.sh, now independently deployed.

## Architecture

- `backend/` — FastAPI + MongoDB (Motor async). Market data scraped from Yahoo Finance endpoints via `curl_cffi` (NOT the yfinance package). Services: `stock_service.py` (quotes/universe/strategies), `discover_service.py` (feed/AI picks), `analyzer_service.py` (per-stock verdict), `news_service.py`. All routes under `/api` prefix in `server.py`.
- `frontend/` — React Native / Expo 54 (TypeScript, expo-router file routing). Runs on web + Expo Go. API client: `frontend/src/api.ts` (reads `EXPO_PUBLIC_BACKEND_URL`, has client-side TTL cache).
- No lockfile committed; `frontend/.npmrc` sets `legacy-peer-deps=true` (required — npm otherwise fails on @react-navigation peer ranges).

## Live deployment (do not break these)

| Piece | Where | Notes |
|---|---|---|
| Frontend | https://scang.pages.dev — Cloudflare Pages, project `scang` | Auto-deploys every push (all branches; non-main = preview URLs). Build: root dir `frontend`, command `npx expo export -p web` (NOT yarn — not installed in CF build image), output `dist`, env `EXPO_PUBLIC_BACKEND_URL=https://scang-api.onrender.com`, `NODE_VERSION=22` |
| Backend | https://scang-api.onrender.com — Render free tier, service `scang-api`, Oregon | Deployed via `render.yaml` blueprint. Auto-deploy: GitHub Action `.github/workflows/deploy-backend.yml` pings Render deploy hook (repo secret `RENDER_DEPLOY_HOOK_URL`) on main-branch pushes touching `backend/**`. Free tier sleeps after ~15 min idle → ~40 s cold start. |
| Database | MongoDB Atlas M0 (free), cluster `Cluster0`, AWS Mumbai ap-south-1 | DB user `scang_api`; `MONGO_URL` is set as a Render env var. Network access open (0.0.0.0/0) because Render free has no static IPs. |

Health check: `GET https://scang-api.onrender.com/api/health`. DB-backed check: `GET /api/watchlist/<any-id>` returns `{"items":[]}`.

Deployment quirks learned the hard way:
- Never re-add the Emergent-internal `litellm` wheel URL or `emergentintegrations` to `backend/requirements.txt` — they don't install outside Emergent. Keep requirements minimal (see current file).
- Cloudflare Pages build has npm but no yarn; keep `npx` commands.
- Render was connected by public repo URL (its GitHub integration is linked to a different GitHub account, @nikhilagastya), so Render does NOT auto-deploy by itself — the GitHub Action does it.

## Current product state

Working prototype: markets overview (indices/movers/sectors/news/calendar), radar strategies, custom screener, discover feed, per-stock analyzer (rating/score/pros/cons), watchlist + saved screens (client-generated anonymous user_id, no auth).

## Agreed roadmap — "institutional-grade" upgrade (user-approved direction)

Planned tracks (user picked A + C to start; work on branch `feature/institutional`, NOT main):

- **Track A — Fundamentals Engine** (priority): pull income statement / balance sheet / cash flow (4y annual + 4q) from Yahoo; compute Piotroski F-Score, Altman Z-Score, earnings quality (accruals vs OCF), margin/ROIC/debt trajectories; DCF intrinsic value with adjustable assumptions; auto peer comparison (5–8 sector peers ranked on valuation/growth/quality); red-flag detector (receivables vs revenue divergence, dilution, interest-coverage deterioration). UI: stock page becomes tabbed research terminal (Quality / Valuation / Growth / Health) with evidence behind each score.
- **Track C — AI Research Analyst**: LLM-generated structured research note per stock (thesis, bull/bear case, risks, catalysts, valuation summary) fed by Track A data; cached daily.
- Track B (later): SEC EDGAR 13F + Form 4 insider tracking (US only).
- Track D (later): universe-wide factor scores (Value/Quality/Momentum/LowVol/Growth percentiles), risk metrics, factor screener filters.

## Known issues / cleanup backlog

- CORS wide open with credentials in `server.py` (tighten to real origins).
- Watchlist/screens endpoints unauthenticated (user_id spoofable).
- Two known-failing backend tests: stock history empty points, batch quotes missing price field.
- Root `backend_test.py` duplicates `backend/tests/`; frontend has zero tests.
- `test_result.md` is Emergent agent-log residue, not real docs.

## Conventions

- Backend tests: `cd backend && pytest tests/ -v` (they hit live Yahoo + a running server; mock new ones instead).
- Commit style: imperative summary + body explaining why; end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- User (sudheer007) prefers: act fast, don't over-ask, report blockers immediately and plainly.
