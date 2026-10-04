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
// mirror; on load the remote wins.

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
  for (const [k, v] of Object.entries(s)) sentSettings[k] = JSON.stringify(v);
  return s;
}

/** Mirror changed top-level preference keys with one PATCH. */
export function syncSettings(prefs) {
  if (!isHosted() || !settingsLoaded) return Promise.resolve(null);
  const patch = {};
  for (const [k, v] of Object.entries(prefs || {})) {
    if (k === "version") continue;
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
// On-platform clients can only READ boards (nicknames resolved through the
// profile). Personal bests stay local and cloud-mirrored; nothing is submitted.

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
