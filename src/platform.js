// StarHermit platform adapter over the shared SDK (starhermit-sdk.js, loaded
// as a classic script before the bundle): launch token + renewal, sign-in,
// account nickname, cloud-save mirror (slot game:<slug>), per-player settings
// KV, keyboard bindings, invite link and read-only leaderboards. Hosted mode
// is "the SDK holds a token". The game never calls its own server routes
// (/api, /ws): without a token it makes no request at all; time, the daily
// seed, boards and achievements are local. Every call resolves to data or
// { error } — never throws.

import { dailySeed } from "./rules.js";

const SAVE_DEBOUNCE_MS = 2000;

let nickname = "";
let syncState = "offline"; // "synced" | "saving" | "offline"
const sentSettings = {};   // key -> JSON last mirrored to the settings KV
let settingsLoaded = false; // no PATCH before the platform values were read
const authListeners = new Set();

/** The SDK instance (window.StarHermit; tests inject one on globalThis). */
function sdk() { return globalThis.StarHermit || null; }

export function isOffline() { return !isHosted(); }
export function isHosted() { return !!(sdk() && sdk().signedIn); }
export function getGameScope() { return (isHosted() && sdk().slug) || ""; }
export function getNickname() { return isHosted() ? nickname : ""; }
export function getSyncStatus() { return syncState; }
export function getUserId() { return isHosted() ? sdk().userId : ""; }

/** fn({ signedIn }) when the platform session ends (renewal refused). */
export function onAuthChange(fn) { authListeners.add(fn); }

// Read + scrub the launch token (StarHermit.init) and wire save/auth events.
let wired = false;
export function handshake() {
  const sh = sdk();
  if (!sh) return;
  if (!sh.signedIn) sh.init();
  if (wired) return;
  wired = true;
  if (sh.userId && !nickname) nickname = "Player " + String(sh.userId).slice(0, 6);
  if (isHosted()) syncState = "synced";
  sh.on("saved", (ok) => { syncState = ok ? "synced" : "offline"; });
  sh.on("auth", (a) => {
    if (!a.signedIn) { nickname = ""; syncState = "offline"; }
    for (const fn of authListeners) fn({ signedIn: !!a.signedIn });
  });
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", () => { flushCloudSave(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) flushCloudSave(); });
  }
}

// ---------------------------------------------------------------- sign-in / invite

export function canSignIn() { return !!(sdk() && sdk().canSignIn()); }
export function signIn() { return !!(sdk() && sdk().signIn()); }
export function inviteLink() { return isHosted() ? sdk().inviteLink() : null; }

// ---------------------------------------------------------------- cloud save
// ONE slot (game:<slug>); localStorage stays the offline cache, the cloud is a
// mirror. loadJSON makes later writes conditional; ui.js merges the loaded doc
// (and a conflicting one, see onSaveConflict) with local progress.

export async function cloudLoad() {
  if (!isHosted()) return null;
  const doc = await sdk().loadJSON();
  syncState = "synced";
  return doc && typeof doc === "object" ? doc : null;
}

export function cloudSave(doc) {
  if (!isHosted() || !doc) return;
  syncState = "saving";
  sdk().saveJSON(doc, SAVE_DEBOUNCE_MS);
}

export function flushCloudSave() {
  if (!isHosted()) return Promise.resolve(false);
  return sdk().flushSave(true);
}

// ---------------------------------------------------------------- settings KV

/** Platform-stored preferences ({} when signed out / none). */
export async function loadRemoteSettings() {
  if (!isHosted()) return {};
  const s = (await sdk().getSettings()) || {};
  settingsLoaded = true;
  for (const [k, v] of Object.entries(s)) if (!k.startsWith("ui.")) sentSettings[k] = JSON.stringify(v);
  return s;
}

/** Mirror changed top-level preference keys with one PATCH. */
export function syncSettings(prefs) {
  if (!isHosted() || !settingsLoaded) return Promise.resolve(null);
  const patch = {};
  for (const [k, v] of Object.entries(prefs || {})) {
    if (k === "version" || k.startsWith("ui.")) continue; // ui.* keys belong to the platform (ui.language)
    const json = JSON.stringify(v);
    if (sentSettings[k] !== json) { patch[k] = v; sentSettings[k] = json; }
  }
  return Object.keys(patch).length ? sdk().patchSettings(patch) : Promise.resolve(null);
}

// ---------------------------------------------------------------- controls

/** { action: codes[] } with the player's platform overrides applied. */
export function loadBindings(defaults) {
  const copy = () => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.slice()]));
  if (!isHosted()) return Promise.resolve(copy());
  return sdk().loadBindings(defaults).catch(copy);
}

// ---------------------------------------------------------------- profile
// Account nickname via the profile route (never /api/v1/me, never usernames).

export async function fetchProfile() {
  if (!isHosted()) return false;
  const p = await sdk().profile();
  if (p) nickname = p.displayName;
  return !!(p && p.nickname);
}

async function resolveNickname(userId) {
  const id = String(userId || "");
  if (!id) return "";
  const p = await sdk().profile(id);
  return p ? p.displayName : "Player " + id.slice(0, 6);
}

// ---------------------------------------------------------------- daily
// No client-reachable time/daily route: the UTC day comes from the device clock.

export async function getDaily() {
  const date = new Date().toISOString().slice(0, 10);
  return { date, seed: dailySeed(date), local: true };
}

// ---------------------------------------------------------------- leaderboards
// Boards are read with nicknames resolved through the profile. A finished ranked
// run posts its total through StarHermit.submitScores (score-script.js range-checks
// it onto the `high-score` board); personal bests stay local and cloud-mirrored.

/** Post a ranked run's total; resolves { posted, rank } (rank on `high-score`, or null). */
export async function submitScore(total) {
  if (!isHosted() || typeof sdk().submitScores !== "function") return { posted: false, rank: null };
  let keys = [];
  try { keys = await sdk().submitScores({ "high-score": Math.max(0, Math.round(total)) }); } catch { keys = []; }
  if (!keys.includes("high-score")) return { posted: false, rank: null };
  try {
    const r = await sdk().leaderboard("high-score", { pageSize: 100 });
    const me = (r.items || []).find((i) => i.userId === getUserId());
    return { posted: true, rank: me ? me.rank : null };
  } catch { return { posted: true, rank: null }; }
}

export async function getLeaderboard() {
  if (!isHosted()) return { error: "local" };
  const r = await sdk().leaderboard(null, { pageSize: 20 });
  if (!r || !r.board) return { error: "no-board" };
  return {
    hosted: true,
    title: r.board.name || r.board.key || "",
    entries: await Promise.all((r.items || []).slice(0, 20).map(async (en) => ({
      name: await resolveNickname(en.userId),
      score: en.score | 0,
      goal: en.components && en.components.goal != null ? en.components.goal : 0,
    }))),
  };
}

// ---------------------------------------------------------------- save conflicts
// The SDK makes cloud writes conditional on the last-read version; when another
// device saved first it emits `saveconflict` and blocks writes until a reload.

/** Merge two progress documents without dropping either side's progress. */
export function mergeProgress(remote, local) {
  const r = remote && typeof remote === "object" ? remote : {};
  const l = local && typeof local === "object" ? local : {};
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const union = (a, b) => ({ ...obj(a), ...Object.fromEntries(Object.entries(obj(b)).filter(([, v]) => v)) });
  const bests = { ...obj(r.bests) };
  for (const [k, v] of Object.entries(obj(l.bests))) bests[k] = Math.max(num(bests[k]), num(v));
  const daily = { ...obj(r.dailyAttempts) };
  for (const [k, v] of Object.entries(obj(l.dailyAttempts))) {
    daily[k] = !daily[k] || num(obj(v).score) > num(obj(daily[k]).score) ? v : daily[k];
  }
  const rc = obj(r.counters), lc = obj(l.counters);
  const achievements = [...(Array.isArray(l.achievements) ? l.achievements : [])];
  for (const a of Array.isArray(r.achievements) ? r.achievements : []) if (!achievements.includes(a)) achievements.push(a);
  return {
    ...r, ...l,
    playerId: r.playerId || l.playerId,
    completed: union(r.completed, l.completed),
    stars: union(r.stars, l.stars),
    lessonsDone: union(r.lessonsDone, l.lessonsDone),
    achievements,
    // lifetime totals take the larger side; the win streak is this device's run
    counters: { ...rc, ...lc, spawns: Math.max(num(rc.spawns), num(lc.spawns)), wins: Math.max(num(rc.wins), num(lc.wins)), streak: num(lc.streak) },
    bests,
    dailyAttempts: daily,
    lastMode: l.lastMode || r.lastMode,
  };
}

/** fn(remoteDoc|null) after another device's save won: reload, then the caller merges and saves. */
export function onSaveConflict(fn) {
  const sh = sdk();
  if (!sh || typeof sh.on !== "function") return;
  sh.on("saveconflict", async () => {
    let remote = null;
    try { remote = await sh.loadJSON(); } catch { remote = null; }
    fn(remote && typeof remote === "object" ? remote : null);
  });
}
