# Keep ScanG API awake (Cloudflare Worker)

Pings your Render `/api/health` every **5 minutes** during NSE hours so the free-tier API (and Nifty 1m poller) does not sleep.

## One-time setup

1. Create a free [Cloudflare](https://dash.cloudflare.com) account (Workers enabled).
2. Install deps and log in:

```bash
cd cloudflare/keep-api-warm
npm install
npx wrangler login
```

3. Deploy:

```bash
npm run deploy
```

4. Set the health URL secret (your real Render API):

```bash
npx wrangler secret put HEALTH_URL
```

When prompted, paste e.g.:

```text
https://scang-api-xxxx.onrender.com/api/health
```

5. Manual test (optional): open the worker URL printed by deploy, or:

```bash
curl https://scang-keep-api-warm.<your-subdomain>.workers.dev/ping
```

## Schedule

Cron in `wrangler.toml`:

```text
*/5 3-10 * * 1-5
```

Mon–Fri, every 5 minutes, ~08:30–16:30 IST buffer. The Worker also skips weekends / off-hours in code.

## Logs

```bash
npm run tail
```

## Notes

- This only **wakes** Render; the FastAPI poller still writes the 1m rows.
- Cold starts can take 30–90s; the Worker retries up to 3 times.
- You can keep the GitHub Action as a backup; Cloudflare cron timing is usually steadier.
