// Same-origin /api adapter with graceful offline fallback.
// Every call resolves to data or { error } — never throws. When the API is
// unreachable the module flags offline mode; the game stays fully playable.
// No tokens are used or persisted.

const TIMEOUT_MS = 5000;

let offline = false;

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

// Round-trip-adjusted server time. On failure returns local time with zero offset.
export async function getServerTime() {
  const t0 = Date.now();
  const r = await request("/api/v1/time");
  const t1 = Date.now();
  if (r.error) return { error: r.error, now: t1, offset: 0 };
  // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
  const serverMs = Number(r.now ?? r.serverTime ?? r.epochMs);
  if (!Number.isFinite(serverMs)) return { error: "time-shape", now: t1, offset: 0 };
  const adjusted = serverMs + (t1 - t0) / 2;
  return { now: adjusted, offset: adjusted - t1 };
}

export function getDaily() {
  return request("/api/v1/daily");
}

export function submitScore(payload) {
  return request("/api/v1/leaderboard/submit", post(payload));
}

export function unlockAchievement(key, playerId) {
  return request("/api/v1/achievements", post({ key, playerId }));
}

export function getLeaderboard(board = "global", opts = {}) {
  let url = "/api/v1/leaderboard?board=" + encodeURIComponent(board);
  if (opts.date) url += "&date=" + encodeURIComponent(opts.date);
  return request(url);
}
