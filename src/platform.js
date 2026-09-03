// Same-origin /api adapter with graceful offline fallback.
// GET /api/v1/time is the only route guaranteed to exist on the host; the
// full route set (daily, leaderboard, achievements) exists only when this
// game's own server.js is running, which its time response advertises via
// the `api` marker. Unconfirmed routes are never requested — the hosted
// features degrade to local no-ops instead, so a partial host never
// produces a 404. Every call resolves to data or { error } — never throws.
// No tokens are used or persisted.

const TIMEOUT_MS = 5000;
const API_MARKER = "physics-foundry/1";

let offline = false;
let fullApi = false;
let probePromise = null;

async function request(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...opts, signal: ctrl.signal });
    if (res.status === 429) return { error: "rate-limited" };
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) return { error: (data && data.error) || "http-" + res.status };
    if (data && typeof data === "object" && data.error) return { error: data.error };
    offline = false;
    return data;
  } catch {
    offline = true;
    return { error: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

function post(payload) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function isOffline() { return offline; }

// Probe the host once. Round-trip-adjusted server time; on failure returns
// local time with zero offset. Also detects whether the full route set is
// available (only this game's server.js sends the API marker).
function probe() {
  if (!probePromise) {
    probePromise = (async () => {
      const t0 = Date.now();
      const r = await request("/api/v1/time");
      const t1 = Date.now();
      if (r.error) return { error: r.error, now: t1, offset: 0 };
      // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
      const serverMs = Number(r.now ?? r.serverTime ?? r.epochMs);
      if (!Number.isFinite(serverMs)) return { error: "time-shape", now: t1, offset: 0 };
      fullApi = r.api === API_MARKER;
      const adjusted = serverMs + (t1 - t0) / 2;
      return { now: adjusted, offset: adjusted - t1 };
    })();
  }
  return probePromise;
}

export function getServerTime() {
  return probe();
}

export async function getDaily() {
  await probe();
  if (!fullApi) return { error: "offline" };
  return request("/api/v1/daily");
}

export async function submitScore(payload) {
  await probe();
  if (!fullApi) return { error: "offline" };
  return request("/api/v1/leaderboard/submit", post(payload));
}

export async function unlockAchievement(key, playerId) {
  await probe();
  if (!fullApi) return { error: "offline" };
  return request("/api/v1/achievements", post({ key, playerId }));
}

export async function getLeaderboard(board = "global", opts = {}) {
  await probe();
  if (!fullApi) return { error: "offline" };
  let url = "/api/v1/leaderboard?board=" + encodeURIComponent(board);
  if (opts.date) url += "&date=" + encodeURIComponent(opts.date);
  return request(url);
}
