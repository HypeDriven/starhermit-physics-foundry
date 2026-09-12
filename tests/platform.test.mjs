// StarHermit platform adapter contract checks. The hosted path is exercised
// against a mocked host (no network): fragment token read + strip, Bearer on
// every call, profile nickname, read-only leaderboard, cloud-save zip+base64,
// 45-min refresh, and the guarantee that the repo's own dev-server routes are
// never requested on-platform.
import test from "node:test";
import assert from "node:assert/strict";

const TOKEN_V1 = "hdr." + Buffer.from(JSON.stringify({ sub: "user-1234-abcd", game_scope: "physics-foundry", exp: 9999999999 })).toString("base64url") + ".sig";
const TOKEN_V2 = "hdr." + Buffer.from(JSON.stringify({ sub: "user-1234-abcd", game_scope: "physics-foundry", exp: 9999999999 })).toString("base64url") + ".sig2";

const calls = [];
const timers = [];
let replaceStateUrl = null;

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

function route(call) {
  const { path, opts } = call;
  if (path === "/api/v1/users/user-1234-abcd/profile") return jsonRes({ id: "user-1234-abcd", username: "should-not-display", nickname: "Forge Tester" });
  if (path === "/api/v1/users/u-rival-9/profile") return jsonRes({ id: "u-rival-9", username: "rival-user", nickname: "" });
  if (path.startsWith("/api/v1/me/cloud-saves/") && opts.method === "PUT") return jsonRes({ ok: true });
  if (path.startsWith("/api/v1/me/cloud-saves/")) return new Response(null, { status: 404 });
  if (path === "/api/v1/games/physics-foundry/launch-token" && opts.method === "POST") return jsonRes({ token: TOKEN_V2 });
  if (path === "/api/v1/games/physics-foundry") return jsonRes({ id: "physics-foundry", leaderboardId: "lb-1" });
  if (path.startsWith("/api/v1/leaderboards/lb-1/entries")) return jsonRes({ entries: [{ userId: "u-rival-9", score: 512, components: { goal: 300 } }] });
  if (path === "/api/v1/daily") return jsonRes({ date: "2026-09-11", seed: 123456, contentVersion: 1, rulesetVersion: 1, excluded: false });
  return jsonRes({ error: "not-found" }, 404);
}

function installHost(url) {
  calls.length = 0;
  replaceStateUrl = null;
  globalThis.window = {
    location: { href: url },
    history: { replaceState: (_a, _b, to) => { replaceStateUrl = to; } },
    addEventListener: () => {},
  };
  globalThis.document = { addEventListener: () => {}, hidden: false };
  globalThis.fetch = async (path, opts = {}) => {
    const call = { path, opts: opts || {}, headers: (opts && opts.headers) || {} };
    calls.push(call);
    return route(call);
  };
}

globalThis.setTimeout = (fn, ms = 0) => { const t = { fn, ms, cleared: false }; timers.push(t); return timers.length; };
globalThis.clearTimeout = (id) => { const t = timers[id - 1]; if (t) t.cleared = true; };

function runTimer(ms) {
  const t = timers.find((x) => !x.cleared && x.ms === ms);
  assert.ok(t, "no live timer with ms=" + ms);
  return t.fn();
}

let platform;

test.before(async () => {
  installHost("https://physics-foundry.starhermit.com/index.html#game_token=" + TOKEN_V1 + "&session_id=abc");
  platform = await import("../src/platform.js");
  platform.handshake();
});

const bearerOf = (call) => call.headers.Authorization || "";
const FABRICATED = ["/api/v1/time", "/api/v1/daily", "/api/v1/achievements", "/api/v1/leaderboard/submit"];

test("fragment token read once and stripped; sub/game_scope decoded", () => {
  assert.equal(platform.isHosted(), true);
  assert.equal(platform.getGameScope(), "physics-foundry");
  assert.equal(replaceStateUrl, "/index.html");
  assert.equal(globalThis.window.location.href.includes("game_token"), true); // href itself untouched; strip is via replaceState
  assert.equal(platform.getNickname(), "Player user-123"); // pre-profile fallback
});

test("profile nickname via /api/v1/users/{sub}/profile with Bearer; never /api/v1/me", async () => {
  const ok = await platform.fetchProfile();
  assert.equal(ok, true);
  assert.equal(platform.getNickname(), "Forge Tester");
  const p = calls.find((c) => c.path === "/api/v1/users/user-1234-abcd/profile");
  assert.ok(p, "profile call missing");
  assert.equal(bearerOf(p), "Bearer " + TOKEN_V1);
  assert.ok(!calls.some((c) => c.path === "/api/v1/me"), "/api/v1/me must never be called");
});

test("hosted leaderboard is read-only with nickname resolution", async () => {
  const res = await platform.getLeaderboard("global");
  assert.equal(res.hosted, true);
  assert.deepEqual(res.entries, [{ name: "Player u-rival-", score: 512, goal: 300 }]); // username never displayed
  assert.ok(calls.some((c) => c.path.startsWith("/api/v1/leaderboards/lb-1/entries")));
  const ro = await platform.submitScore({ board: "global" });
  assert.deepEqual(ro, { error: "read-only" });
  assert.equal((await platform.unlockAchievement("first-completion", "p-1")).ok, true);
});

test("cloud save: 2 s debounce, zip+base64 PUT with Bearer, sync status", async () => {
  const doc = { settings: { music: 0.5 }, progress: { bests: { "journey-1": 900 } } };
  platform.cloudSave(doc);
  assert.equal(platform.getSyncStatus(), "saving");
  assert.ok(!calls.some((c) => c.path.startsWith("/api/v1/me/cloud-saves/") && c.opts.method === "PUT"), "PUT must wait for the debounce");
  await runTimer(2000);
  assert.equal(platform.getSyncStatus(), "synced");
  const put = calls.find((c) => c.path === "/api/v1/me/cloud-saves/physics-foundry" && c.opts.method === "PUT");
  assert.ok(put, "cloud PUT missing");
  assert.equal(bearerOf(put), "Bearer " + TOKEN_V1);
  const body = JSON.parse(put.opts.body);
  const zipBytes = platform.base64ToBytes(body.dataBase64);
  const back = JSON.parse(new TextDecoder().decode(platform.unzipFirstEntry(zipBytes)));
  assert.deepEqual(back, doc);
});

test("45-min refresh re-mints the token via the game route and swaps it in", async () => {
  await runTimer(45 * 60 * 1000);
  const refresh = calls.find((c) => c.path === "/api/v1/games/physics-foundry/launch-token" && c.opts.method === "POST");
  assert.ok(refresh, "launch-token refresh missing");
  assert.equal(bearerOf(refresh), "Bearer " + TOKEN_V1);
  await platform.fetchProfile();
  const p = calls[calls.length - 1];
  assert.equal(bearerOf(p), "Bearer " + TOKEN_V2);
});

test("no fabricated hosted routes are ever requested on-platform", () => {
  for (const call of calls) {
    assert.ok(!FABRICATED.includes(call.path), "fabricated route called: " + call.path);
    assert.ok(!/^\/api\/1\/leaderboard\?/.test(call.path), "fabricated route called: " + call.path);
  }
});

test("hosted daily is derived locally without a network call", async () => {
  const before = calls.length;
  const d = await platform.getDaily();
  assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof d.seed, "number");
  assert.equal(calls.length, before);
});

test("local dev: query token accepted on localhost with Bearer on its-backend routes", async () => {
  installHost("http://localhost:8080/?token=" + TOKEN_V1);
  const dev = await import("../src/platform.js?dev");
  dev.handshake();
  assert.equal(dev.isHosted(), false); // query-param token is dev-only
  const d = await dev.getDaily();
  assert.equal(d.date, "2026-09-11");
  const dailyCall = calls.find((c) => c.path === "/api/v1/daily");
  assert.ok(dailyCall, "dev daily call missing");
  assert.equal(bearerOf(dailyCall), "Bearer " + TOKEN_V1);
});

test("query token refused off localhost", async () => {
  installHost("http://example.com/?token=" + TOKEN_V1);
  const dev = await import("../src/platform.js?dev2");
  dev.handshake();
  assert.equal(dev.isHosted(), false);
  assert.equal(dev.getGameScope(), "");
  await dev.fetchProfile(); // no-op without a sub
  assert.equal(calls.length, 0); // nothing was requested at all
  assert.ok(calls.every((c) => !c.headers.Authorization), "no Bearer without a token");
});
