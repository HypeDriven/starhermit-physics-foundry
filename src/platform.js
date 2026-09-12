// Same-origin platform adapter: StarHermit launch-token handshake (fragment
// #game_token, 45-min refresh), Bearer-authenticated REST, account nickname,
// cloud-save mirror (zip+base64) and read-only leaderboards. Hosted mode
// activates iff a fragment token was read; query-param tokens are a
// localhost-only dev fallback. This repo's own server.js routes
// (/api/v1/time, /api/v1/daily, /api/v1/leaderboard*) are its development
// backend — they are called only when NOT hosted (on-platform they would 404
// and are never requested). Every call resolves to data or { error } — never
// throws. The launch token lives in memory only and is never persisted.

import { dailySeed } from "./rules.js";

const TIMEOUT_MS = 5000;
const REFRESH_MS = 45 * 60 * 1000; // token lifetime is 60 min; re-mint at 45
const REFRESH_RETRY_MS = 60 * 1000;

let launchToken = ""; // short-lived launch token; NEVER persisted to storage
let fromFragment = false;
let userSub = "";     // JWT sub claim (user id)
let gameScope = "";   // JWT game_scope claim (game slug / cloud key)
let nickname = "";
let offline = false;
let syncState = "offline"; // "synced" | "saving" | "offline"
let refreshTimer = 0;
let saveTimer = 0;
let pendingDoc = null;
const nickCache = new Map();

export function isOffline() { return offline; }
// Hosted iff a fragment token was read; query-param tokens are dev-only.
export function isHosted() { return fromFragment; }
export function getGameScope() { return gameScope; }
export function getNickname() { return nickname; }
export function getSyncStatus() { return syncState; }

// Base64url-decode the JWT payload segment (no signature verification).
function decodeJwtPayload(t) {
  try {
    const seg = String(t).split(".")[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

function acceptToken(t, fragment) {
  launchToken = t || "";
  fromFragment = !!(fragment && launchToken);
  const claims = decodeJwtPayload(launchToken);
  userSub = claims && typeof claims.sub === "string" ? claims.sub : "";
  gameScope = claims && typeof claims.game_scope === "string" ? claims.game_scope : "";
  if (userSub && !nickname) nickname = "Player " + userSub.slice(0, 8);
  scheduleRefresh();
}

// Read the launch token from the host shell, then scrub the URL. The platform
// delivers it in the fragment (#game_token=<jwt>[&session_id=…]); query params
// are kept ONLY as a local-dev fallback on localhost.
export function handshake() {
  try {
    const u = new URL(window.location.href);
    if (u.hash.length > 1) {
      const frag = new URLSearchParams(u.hash.slice(1));
      const t = frag.get("game_token");
      if (t) {
        acceptToken(t, true);
        window.history.replaceState({}, "", u.pathname + u.search);
        return;
      }
    }
    const host = u.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return;
    const t = u.searchParams.get("game_token") || u.searchParams.get("token") || u.searchParams.get("launch");
    if (t) {
      acceptToken(t, false);
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  } catch { /* non-browser context */ }
}

function authHeaders(extra) {
  const h = { ...(extra || {}) };
  if (launchToken) h.Authorization = "Bearer " + launchToken;
  return h;
}

async function request(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      ...opts,
      headers: authHeaders({ "content-type": "application/json", ...(opts.headers || {}) }),
      signal: ctrl.signal,
    });
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
  return { method: "POST", body: JSON.stringify(payload) };
}

// Token lifetime is 60 min; re-mint on a 45-min cadence via the game route,
// retrying a failed refresh after ~60 s. Scoped launch tokens re-mint with
// the current one, sent as the Bearer credential.
function scheduleRefresh(ms) {
  clearTimeout(refreshTimer);
  refreshTimer = 0;
  if (!isHosted() || !gameScope || !launchToken) return;
  refreshTimer = setTimeout(refreshToken, ms || REFRESH_MS);
}

async function refreshToken() {
  const r = await request("/api/v1/games/" + encodeURIComponent(gameScope) + "/launch-token", post({}));
  const t = r && (r.token || r.launchToken);
  if (typeof t === "string" && t) launchToken = t;
  scheduleRefresh(t ? REFRESH_MS : REFRESH_RETRY_MS);
}

// ---------------------------------------------------------------- zip helper
// Minimal ZIP writer/reader (stored entries only, no compression).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error("unsupported zip entry");
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error("bad zip");
}
function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
export { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes };

// ---------------------------------------------------------------- cloud save
// ONE slot keyed by the game slug; zip+base64. localStorage stays the offline
// cache, the cloud is a mirror; on conflict the remote wins.

export async function cloudLoad() {
  if (!isHosted() || !gameScope) return null;
  try {
    const res = await fetch("/api/v1/me/cloud-saves/" + encodeURIComponent(gameScope), { headers: authHeaders() });
    if (!res.ok) { syncState = res.status === 404 ? "synced" : "offline"; return null; }
    const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(new Uint8Array(await res.arrayBuffer()))));
    syncState = "synced";
    return doc;
  } catch { syncState = "offline"; return null; }
}

export function cloudSave(doc) {
  if (!isHosted() || !gameScope || !doc) return;
  pendingDoc = doc;
  syncState = "saving";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloudSave, 2000); // ~2 s debounce
}

async function flushCloudSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const doc = pendingDoc;
  pendingDoc = null;
  if (!doc || !isHosted() || !gameScope) return;
  try {
    const zip = zipStore("save.json", new TextEncoder().encode(JSON.stringify(doc)));
    const res = await fetch("/api/v1/me/cloud-saves/" + encodeURIComponent(gameScope), {
      method: "PUT",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ dataBase64: bytesToBase64(zip) }),
    });
    syncState = res.ok ? "synced" : "offline";
  } catch { syncState = "offline"; }
}

// Flush a pending debounced save when the page is hidden or torn down.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { if (saveTimer) flushCloudSave(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && saveTimer) flushCloudSave();
  });
}

// ---------------------------------------------------------------- profile
// Account nickname via the profile route (NEVER /api/v1/me, never usernames).

export async function fetchProfile() {
  if (!isHosted() || !userSub) return false;
  const r = await request("/api/v1/users/" + encodeURIComponent(userSub) + "/profile");
  if (r && !r.error) {
    const n = typeof r.nickname === "string" ? r.nickname.trim() : "";
    nickname = n || ("Player " + String(r.id || userSub).slice(0, 8));
    nickCache.set(userSub, nickname);
    return true;
  }
  if (!nickname) nickname = "Player " + userSub.slice(0, 8);
  return false;
}

async function resolveNickname(userId) {
  const id = String(userId || "");
  if (!id) return "";
  if (nickCache.has(id)) return nickCache.get(id);
  let name = "Player " + id.slice(0, 8);
  const r = await request("/api/v1/users/" + encodeURIComponent(id) + "/profile");
  if (r && !r.error) {
    const n = typeof r.nickname === "string" ? r.nickname.trim() : "";
    if (n) name = n;
  }
  nickCache.set(id, name);
  return name;
}

// ---------------------------------------------------------------- time/daily
// The dev backend serves round-trip-adjusted time and the daily descriptor;
// on-platform there are no such routes, so hosted play derives the UTC day
// from the device clock (zero offset). Both degrade to local values.

export async function getServerTime() {
  if (!isHosted()) {
    const t0 = Date.now();
    const r = await request("/api/v1/time");
    const t1 = Date.now();
    if (!r.error) {
      // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
      const serverMs = Number(r.now ?? r.serverTime ?? r.epochMs);
      if (!Number.isFinite(serverMs)) return { error: "time-shape", now: t1, offset: 0 };
      const adjusted = serverMs + (t1 - t0) / 2;
      return { now: adjusted, offset: adjusted - t1 };
    }
    return { error: r.error, now: t1, offset: 0 };
  }
  return { now: Date.now(), offset: 0 };
}

export async function getDaily() {
  if (!isHosted()) {
    const r = await request("/api/v1/daily");
    if (!r.error) return r;
  }
  // The daily chamber is seeded by the UTC date, so it is derivable locally.
  const date = new Date().toISOString().slice(0, 10);
  return { date, seed: dailySeed(date), local: true };
}

// ---------------------------------------------------------------- leaderboards
// Leaderboards are script/elo-owned: on-platform clients can only READ, via
// the game record and its entries (nicknames resolved through the profile
// helper). Personal bests stay local and cloud-mirrored. The replay-validated
// submission endpoint below exists only on this repo's own dev server.

export async function getLeaderboard(board = "global", opts = {}) {
  if (isHosted()) {
    const g = await request("/api/v1/games/" + encodeURIComponent(gameScope));
    const leaderboardId = g && !g.error ? g.leaderboardId : null;
    if (!leaderboardId) return { error: (g && g.error) || "no-board" };
    const e = await request("/api/v1/leaderboards/" + encodeURIComponent(leaderboardId) + "/entries?pageSize=20");
    if (!e || e.error || !Array.isArray(e.entries)) return { error: (e && e.error) || "board-error" };
    return {
      hosted: true,
      entries: await Promise.all(e.entries.slice(0, 20).map(async (en) => ({
        name: await resolveNickname(en.userId != null ? en.userId : en.user),
        score: en.score | 0,
        goal: en.components && en.components.goal != null ? en.components.goal : 0,
      }))),
    };
  }
  let url = "/api/v1/leaderboard?board=" + encodeURIComponent(board);
  if (opts.date) url += "&date=" + encodeURIComponent(opts.date);
  const r = await request(url);
  if (r.error) return r;
  return {
    entries: (r.entries || []).slice(0, 20).map((en) => ({
      name: en.name,
      score: en.score,
      goal: en.components && en.components.goal != null ? en.components.goal : 0,
    })),
  };
}

// ---------------------------------------------------------------- own server
// This repo's server.js (the dev backend): replay-validated score submission
// and durable achievement unlocks. Called only when NOT hosted; failures
// resolve to { error } and the game continues locally.

export async function submitScore(payload) {
  if (isHosted()) return { error: "read-only" };
  return request("/api/v1/leaderboard/submit", post(payload));
}

export async function unlockAchievement(key, playerId) {
  if (isHosted()) return { ok: true }; // hosted: achievements stay local
  return request("/api/v1/achievements", post({ key, playerId }));
}
