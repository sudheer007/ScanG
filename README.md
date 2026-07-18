# ScanG — Radar Stock Screener

Full-stack stock screener and analyzer for US and Indian markets.

- **Backend**: FastAPI + MongoDB (Motor), market data via Yahoo Finance endpoints (`backend/`)
- **Frontend**: React Native / Expo (TypeScript, expo-router) — runs on web, iOS, and Android (`frontend/`)

## Features

- Live market indices, movers, and overview (US + India)
- Radar screener strategies + fully custom screener
- Per-stock analyzer with rating, score, pros/cons verdict
- Discover feed: AI picks, analyst ratings, forecasts, earnings & dividend calendars, sector rotation, institutional activity
- News (market + per stock), watchlist, saved screens

## Local development

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # then edit MONGO_URL if needed
uvicorn server:app --reload --port 8000
```

API docs: http://localhost:8000/docs — health check: `GET /api/health`

### Frontend

```bash
cd frontend
yarn install
cp .env.example .env        # points at http://localhost:8000 by default
yarn web                    # web browser
yarn start                  # QR code for Expo Go on a phone
```

## Deployment

| Piece | Host | Config |
|---|---|---|
| Backend API | Render (free) | `render.yaml` blueprint at repo root |
| Database | MongoDB Atlas (free M0) | set `MONGO_URL` env var on Render |
| Frontend (web) | Cloudflare Pages (free) | settings below |

### 1. MongoDB Atlas

1. Create a free M0 cluster at https://www.mongodb.com/cloud/atlas
2. Create a database user (username + password)
3. Network Access → allow `0.0.0.0/0` (Render's IPs are dynamic)
4. Copy the connection string (`mongodb+srv://...`)

### 2. Render (backend)

1. https://render.com → New → **Blueprint** → connect this GitHub repo
2. Render reads `render.yaml` automatically
3. When prompted, paste the Atlas connection string as `MONGO_URL`
4. Deploy → note the service URL (e.g. `https://scang-api.onrender.com`)

Every push to `main` auto-deploys.

> Free tier sleeps after ~15 min idle; first request after that takes ~30–50 s.

### 3. Cloudflare Pages (frontend)

1. https://dash.cloudflare.com → Workers & Pages → Create → Pages → connect this repo
2. Build settings:
   - **Root directory**: `frontend`
   - **Build command**: `yarn install && yarn expo export -p web`
   - **Build output directory**: `dist`
3. Environment variables (build time):
   - `EXPO_PUBLIC_BACKEND_URL` = your Render URL (no trailing slash)
   - `NODE_VERSION` = `22`
4. Deploy → app is live at `https://<project>.pages.dev`

Every push to `main` auto-deploys the frontend too.

## Tests

```bash
cd backend
pytest tests/ -v
```
