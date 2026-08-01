/**
 * Cloudflare Worker: keep Render free-tier API awake.
 * Cron pings HEALTH_URL every 5 minutes during NSE hours (UTC window).
 *
 * Secrets / vars:
 *   HEALTH_URL — e.g. https://scang-api-xxxx.onrender.com/api/health
 */
async function pingHealth(url) {
  const errors = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "scang-keep-alive/1.0" },
        redirect: "follow",
      });
      if (res.ok) {
        return { ok: true, status: res.status, attempt };
      }
      errors.push(`HTTP ${res.status}`);
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
    }
    // Brief pause between retries (cold start)
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, errors };
}

/** True during Mon–Fri ~08:30–16:30 IST (buffer around NSE). */
function inNseBufferWindow(date = new Date()) {
  // IST = UTC+5:30
  const istMs = date.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const dow = ist.getUTCDay(); // 0=Sun … 6=Sat (using UTC getters on shifted time)
  if (dow === 0 || dow === 6) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 510 && minutes <= 990; // 08:30–16:30
}

export default {
  async scheduled(event, env, ctx) {
    const url = env.HEALTH_URL;
    if (!url) {
      console.log("HEALTH_URL not set — skip");
      return;
    }
    if (!inNseBufferWindow()) {
      console.log("Outside NSE buffer window — skip");
      return;
    }
    const result = await pingHealth(url);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result, url }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ping" || url.pathname === "/") {
      const health = env.HEALTH_URL;
      if (!health) {
        return new Response("HEALTH_URL not configured\n", { status: 500 });
      }
      const result = await pingHealth(health);
      return new Response(JSON.stringify(result, null, 2) + "\n", {
        status: result.ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("scang keep-alive worker\n", { status: 200 });
  },
};
