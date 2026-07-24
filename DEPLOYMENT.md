# Deploying ScanG (Render + MongoDB Atlas)

Host the API and static web UI on [Render](https://render.com) and the database on [MongoDB Atlas](https://www.mongodb.com/atlas). You get free `*.onrender.com` URLs; a custom domain later only needs env + DNS changes.

Features and UI are unchanged. Backend URL, CORS, and Firebase are env-driven.

> **SPA deep links:** Expo web is a single-page app. On a Render Static Site you must add a rewrite `/*` → `/index.html` (Blueprint already does this). Missing that rewrite causes a black “Not Found” page when opening `/stock/...` in a new tab.

---

## Architecture

| Piece | Stack | Host |
|-------|--------|------|
| API | FastAPI (`backend-v2`) + Docker | Render Web Service |
| Database | MongoDB | MongoDB Atlas (free M0) |
| Web UI | Expo Router static export (`frontend-v2`) | Render Static Site (SPA rewrite required) |
| Auth | Firebase Auth | Same Firebase project |

```
Browser  -->  scang-web (dist/)  -->  EXPO_PUBLIC_BACKEND_URL  -->  scang-api  -->  Atlas
                      |                                                    |
                      +---- Firebase Auth (authorized domains) ------------+
```

Config in this repo:

- [`render.yaml`](render.yaml) — Blueprint for both services
- [`backend-v2/Dockerfile`](backend-v2/Dockerfile) — API image + Tesseract OCR
- [`frontend-v2`](frontend-v2) — `yarn build:web` → `dist/`

---

## 0. GitHub repo

Render deploys from Git. Push this project (root containing `backend-v2` / `frontend-v2` / `render.yaml`) to a dedicated GitHub repo. Do not use a parent Documents folder as the deploy root.

---

## 1. MongoDB Atlas

Local `mongodb://localhost:27017` is not reachable from Render.

1. Create a free **M0** cluster at [MongoDB Atlas](https://www.mongodb.com/atlas).
2. **Database Access** → create a DB user with a strong password (URL-encode special characters in the URI).
3. **Network Access** → allow `0.0.0.0/0` to start (tighten later if desired).
4. **Connect** → Drivers → copy the `mongodb+srv://...` URI.
5. Use that as `MONGO_URL` and set `DB_NAME` to `scang`.

---

## 2. Deploy with Render Blueprint (recommended)

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the GitHub repo that contains `render.yaml`.
3. When prompted, fill secrets (`sync: false` vars):

### Backend (`scang-api`)

| Variable | Value |
|----------|--------|
| `MONGO_URL` | Atlas `mongodb+srv://...` URI |
| `FIREBASE_CREDENTIALS_JSON` | Full service-account JSON as **one line** |
| `INGESTION_ADMIN_KEY` | Optional; leave empty or set a secret |

`DB_NAME` defaults to `scang`. `CORS_ORIGINS` starts as `*` (tighten after the frontend URL exists).

### Frontend (`scang-web`) — build-time

| Variable | Value |
|----------|--------|
| `EXPO_PUBLIC_BACKEND_URL` | Auto-wired from API `RENDER_EXTERNAL_URL` in the Blueprint |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase web config |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | e.g. `fintech-58166.firebaseapp.com` |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | e.g. `fintech-58166` |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase web app id |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth web client ID |

Copy values from local [`frontend-v2/.env`](frontend-v2/.env.example) / Firebase Console.

4. Deploy. Note URLs:
   - API: `https://scang-api-xxxx.onrender.com`
   - Web: `https://scang-web-xxxx.onrender.com`
5. Health check: `GET https://scang-api-xxxx.onrender.com/api/health`

**Free tier:** the API may sleep when idle; the first request can take ~30–60s.

### Keep the API awake (strongly recommended)

Render free web services sleep after ~15 minutes with no traffic. That cold start is the main reason live users see a blank/slow Markets screen.

1. After deploy, copy your API health URL: `https://scang-api-xxxx.onrender.com/api/health`
2. Create a free job at [cron-job.org](https://cron-job.org) (or UptimeRobot):
   - Method: `GET`
   - URL: the health URL above
   - Interval: every **10–14 minutes**
3. Optional: enable the GitHub Action [`.github/workflows/keep-api-warm.yml`](.github/workflows/keep-api-warm.yml) and set repo secret `SCANG_API_HEALTH_URL` to the same health URL.

While the process is awake, the backend now keeps Markets overview caches warm and builds the full stock universe once (shared across Discover / Radar / Screener) so stock lists appear much faster.

Upgrading the API off free tier also removes sleep entirely (uses the 750 free hours only if you stay on free).

### Manual deploy (without Blueprint)

- **API:** New → Web Service → Docker → root directory `backend-v2` → set env vars above → start via Dockerfile `CMD`.
- **Web:** New → Static Site → root `frontend-v2` → build `yarn install && yarn build:web` → publish `dist`.
  Then open the service → **Redirects/Rewrites** → add:
  - Source: `/*`
  - Destination: `/index.html`
  - Action: **Rewrite**

  Without this rewrite, opening `/stock/TSLA` (or any client route) in a new tab shows Render’s black “Not Found” page. In-app navigation still works because it never asks the CDN for that path.

  Optional alternative: deploy as a Node Web Service with start command `yarn start:web` (`scripts/serve-spa.js` includes the SPA fallback). Prefer Static Site + rewrite so the UI does not sleep on the free tier.

---

## 3. Wire CORS + Firebase

After both URLs exist:

1. Set backend `CORS_ORIGINS` to the frontend origin (e.g. `https://scang-web-xxxx.onrender.com`). Redeploy API.
2. Firebase Console → Authentication → Settings → **Authorized domains** → add the frontend host (no `https://`).
3. Keep **Google** sign-in enabled for web.

---

## 4. Local smoke tests

```bash
# Backend image
cd backend-v2
docker build -t scang-backend .
docker run --env-file .env -e PORT=8000 -p 8000:8000 scang-backend

# Frontend static export
cd frontend-v2
yarn install
# Set EXPO_PUBLIC_BACKEND_URL in .env to your API URL (no trailing slash)
yarn build:web
# Output in dist/
```

Backend env template: [`backend-v2/.env.example`](backend-v2/.env.example).

---

## 5. Other frontend hosts (optional)

| Host | Config |
|------|--------|
| Vercel | [`frontend-v2/vercel.json`](frontend-v2/vercel.json) — root `frontend-v2` |
| Netlify | [`frontend-v2/netlify.toml`](frontend-v2/netlify.toml) |
| Cloudflare Pages | Build `yarn build:web`, output `dist`, SPA fallback to `index.html` |

Redeploy the frontend whenever `EXPO_PUBLIC_BACKEND_URL` changes (it is baked in at build time).

---

## 6. Later: custom domain

1. Add the domain on the **frontend** service (Render DNS + TLS guide).
2. Optionally add `api.yourdomain.com` on the **API** service.
3. Update and redeploy:
   - Frontend: `EXPO_PUBLIC_BACKEND_URL`
   - Backend: `CORS_ORIGINS`
   - Firebase: authorized domains
4. Update Google OAuth / Firebase authorized origins if needed.

---

## Checklist

- [ ] Atlas `MONGO_URL` + `DB_NAME`
- [ ] GitHub repo with `render.yaml` at root
- [ ] Render Blueprint deploy + `FIREBASE_CREDENTIALS_JSON`
- [ ] Frontend Firebase / Google `EXPO_PUBLIC_*` build env
- [ ] `CORS_ORIGINS` matches frontend origin
- [ ] Firebase authorized domain for the frontend host
- [ ] (Later) custom domain + env updates
