// StarHermit adapter (src/platform.js) over the shared SDK with a mocked host
// (no network): fragment token read + strip, profile nickname, cloud save in
// slot game:<slug>, settings KV patch, bindings, read-only leaderboard, and
// the guarantee that nothing platform-side is requested standalone and the
// repo's own dev-server routes are never requested on-platform.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The SDK is a classic browser script (this package is ESM): evaluate it the
// way a <script> tag would, against a stand-in global.
const holder = {};
new Function("self", "module", readFileSync(new URL("../starhermit-sdk.js", import.meta.url), "utf8"))(holder, undefined);
const SDK = holder.StarHermit;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = "hdr." + b64u({ sub: "user-1234-abcd", game_scope: "pf-slug", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".sig";

const calls = [];
const saves = {};
const kv = { music: 0.25 };
let replaced = null;

function route(url, init) {
  const r = (status, body) => new Response(body, { status });
  const j = (o) => r(200, JSON.stringify(o));
  if (url === "/api/v1/users/user-1234-abcd/profile") return j({ username: "should-not-display", nickname: "Forge Tester" });
  if (url === "/api/v1/users/u-rival-9/profile") return j({ username: "rival-user", nickname: "" });
  if (url.startsWith("/api/v1/me/cloud-saves/")) {
    const key = decodeURIComponent(url.split("/cloud-saves/")[1]);
    if (init.method === "PUT") { saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, "base64"); return j({}); }
    return saves[key] ? r(200, saves[key]) : r(404, "");
  }
  if (url === "/api/v1/games/pf-slug/settings" && init.method === "PATCH") { Object.assign(kv, JSON.parse(init.body).settings); return j({}); }
  if (url === "/api/v1/games/pf-slug/settings") return j({ settings: kv });
  if (url === "/api/v1/games/pf-slug/controls") return j({ actions: [{ action: "run", codes: ["KeyG"] }] });
  if (url === "/api/v1/games/pf-slug/leaderboards") return j([{ id: "lb-1", key: "score", name: "Best score" }]);
  if (url.startsWith("/api/v1/leaderboards/lb-1/entries")) return j({ items: [{ userId: "u-rival-9", score: 512, rank: 1 }], total: 1 });
  return r(404, "");
}

function install(href) {
  calls.length = 0;
  const u = new URL(href);
  const win = {
    location: { hash: u.hash, search: u.search, pathname: u.pathname, origin: u.origin, hostname: u.hostname, href },
    history: { replaceState: (_a, _b, to) => { replaced = to; } },
  };
  const fetch = async (url, init = {}) => { calls.push({ url, method: init.method || "GET", init }); return route(url, init); };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.fetch = fetch;
  globalThis.StarHermit = SDK.create({ window: win, fetch, setTimeout: () => 0, clearTimeout: () => {} });
}

const FABRICATED = ["/api/v1/time", "/api/v1/daily", "/api/v1/achievements", "/api/v1/leaderboard/submit"];

test("hosted: token, nickname, cloud save, settings, bindings, leaderboard", async () => {
  install("https://example.test/index.html#game_token=" + TOKEN + "&session_id=abc");
  const platform = await import("../src/platform.js?hosted");
  platform.handshake();
  assert.equal(platform.isHosted(), true);
  assert.equal(platform.getGameScope(), "pf-slug");
  assert.equal(platform.getUserId(), "user-1234-abcd");
  assert.equal(replaced, "/index.html");
  assert.equal(platform.getNickname(), "Player user-1"); // pre-profile fallback

  assert.equal(await platform.fetchProfile(), true);
  assert.equal(platform.getNickname(), "Forge Tester");
  assert.ok(calls.every((c) => c.url !== "/api/v1/me"), "/api/v1/me must never be called");
  assert.ok(calls.every((c) => c.init.headers.Authorization === "Bearer " + TOKEN));

  const doc = { settings: { music: 0.5 }, progress: { bests: { "journey-1": 900 } } };
  platform.cloudSave(doc);
  assert.equal(platform.getSyncStatus(), "saving");
  assert.equal(await platform.flushCloudSave(), true);
  assert.equal(platform.getSyncStatus(), "synced");
  assert.deepEqual(Object.keys(saves), ["game:pf-slug"]);
  assert.deepEqual(await platform.cloudLoad(), doc);

  assert.deepEqual(await platform.loadRemoteSettings(), { music: 0.25 });
  await platform.syncSettings({ version: 1, music: 0.25, muted: true });
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), { settings: { muted: true } });

  assert.deepEqual(await platform.loadBindings({ run: ["KeyR"], undo: ["KeyU"] }), { run: ["KeyG"], undo: ["KeyU"] });

  const lb = await platform.getLeaderboard("global");
  assert.equal(lb.hosted, true);
  assert.deepEqual(lb.entries, [{ name: "Player u-riva", score: 512, goal: 0 }]); // username never displayed
  assert.match(platform.inviteLink(), /\/game-invite\/user-1234-abcd\/pf-slug$/);

  const d = await platform.getDaily();
  assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const c of calls) assert.ok(!FABRICATED.includes(c.url), "dev route called on-platform: " + c.url);
});

test("standalone: no platform request, local defaults", async () => {
  install("http://localhost:8080/index.html");
  const platform = await import("../src/platform.js?standalone");
  platform.handshake();
  assert.equal(platform.isHosted(), false);
  assert.equal(platform.getGameScope(), "");
  assert.equal(await platform.fetchProfile(), false);
  assert.equal(await platform.cloudLoad(), null);
  platform.cloudSave({ a: 1 });
  assert.deepEqual(await platform.loadRemoteSettings(), {});
  assert.equal(await platform.syncSettings({ music: 1 }), null);
  assert.deepEqual(await platform.loadBindings({ run: ["KeyR"] }), { run: ["KeyR"] });
  assert.equal(platform.inviteLink(), null);
  assert.equal(platform.canSignIn(), false);
  assert.deepEqual(await platform.getLeaderboard("global"), { error: "local" });
  assert.match((await platform.getDaily()).date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(await platform.submitScore(1500), { posted: false, rank: null });
  assert.equal(calls.length, 0);
});

test("sign-in offered on <id>.starhermit.com without a token", async () => {
  install("https://pf-slug.starhermit.com/index.html");
  const platform = await import("../src/platform.js?signin");
  platform.handshake();
  assert.equal(platform.canSignIn(), true);
  assert.equal(calls.length, 0);
});

test("hosted: submitScore posts high-score and reads the rank", async () => {
  install("https://example.test/index.html#game_token=" + TOKEN);
  const platform = await import("../src/platform.js?submit");
  platform.handshake();
  const sent = [];
  globalThis.StarHermit.submitScores = async (sc) => { sent.push(sc); return Object.keys(sc); };
  globalThis.StarHermit.leaderboard = async (key) => ({ items: key === "high-score" ? [{ userId: "user-1234-abcd", rank: 5 }] : [] });
  assert.deepEqual(await platform.submitScore(1325.4), { posted: true, rank: 5 });
  assert.deepEqual(sent, [{ "high-score": 1325 }]);
  globalThis.StarHermit.submitScores = async () => [];
  assert.deepEqual(await platform.submitScore(10), { posted: false, rank: null });
});

test("leaderboard line strings in every locale", async () => {
  const { platformStrings, PLATFORM_LOCALES } = await import("../src/platform-i18n.js");
  assert.equal(PLATFORM_LOCALES.length, 9);
  for (const l of PLATFORM_LOCALES) {
    const t = platformStrings(l);
    for (const k of ["lbPosting", "lbRank", "lbPosted", "lbNotPosted"]) assert.ok(t[k], l + " " + k);
    assert.ok(t.lbRank.includes("{rank}"));
  }
});
