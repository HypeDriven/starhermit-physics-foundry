import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { createServer } from "../server.js";
import { verifyReplay, SCHEMA_VERSION } from "../src/rules.js";
import { CONTENT_VERSION, getLevel } from "../src/content.js";

let server, base, dataDirBackup;

test.before(async () => {
  server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  server.close();
  await once(server, "close");
});

const get = async (p) => fetch(base + p);
const post = async (p, body) => fetch(base + p, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("GET /healthz", async () => {
  const r = await get("/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("GET /api/v1/time", async () => {
  const r = await get("/api/v1/time");
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(Math.abs(j.now - Date.now()) < 60_000);
});

test("GET /api/v1/daily", async () => {
  const r = await get("/api/v1/daily");
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.match(j.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(j.seed));
  assert.equal(j.contentVersion, CONTENT_VERSION);
  assert.equal(j.rulesetVersion, SCHEMA_VERSION);
  assert.equal(j.excluded, false);
});

test("static: index.html served, traversal blocked", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const html = await r.text();
  assert.ok(html.length > 0);

  // fetch() normalizes "/../x" to "/x" (still inside root); encoded traversal must be blocked
  const t = await get("/..%2f..%2f..%2fetc%2fpasswd");
  assert.ok([403, 404].includes(t.status));
  const t2 = await get("/%2e%2e%2f%2e%2e%2fserver.js%2e%2e");
  assert.ok([403, 404].includes(t2.status));
});

test("leaderboard: real replay submit, fetch, and tamper rejection", async () => {
  const lvl = getLevel("journey-1");
  const commands = [{ id: "c1", type: "run" }];
  const replay = verifyReplay(lvl, lvl.seed, commands);
  assert.equal(replay.terminalReason, "goal-complete");

  const name = "tester-" + Math.floor(Math.random() * 1e6);
  const payload = {
    board: "global", levelId: lvl.id, name,
    seed: lvl.seed, contentVersion: CONTENT_VERSION, rulesetVersion: SCHEMA_VERSION,
    assists: 0, durationMs: 5000, commands, stateHashes: [replay.finalHash],
  };
  const r1 = await post("/api/v1/leaderboard/submit", payload);
  const j1 = await r1.json();
  assert.equal(r1.status, 200, JSON.stringify(j1));
  assert.equal(j1.ok, true);
  assert.ok(j1.rank >= 1);
  assert.equal(j1.score, replay.scoreBreakdown.total);

  // board fetch shows the entry
  const lb = await (await get("/api/v1/leaderboard?board=global")).json();
  assert.ok(lb.entries.some((e) => e.name === name && e.score === j1.score));

  // tampered hash -> 422 replay-mismatch
  const bad = { ...payload, name: name + "x", stateHashes: ["deadbeef"] };
  const r2 = await post("/api/v1/leaderboard/submit", bad);
  assert.equal(r2.status, 422);
  assert.deepEqual(await r2.json(), { error: "replay-mismatch" });

  // tampered commands (illegal spawn) -> 422
  const bad2 = { ...payload, name: name + "y", commands: [{ id: "x", type: "spawn", material: "steel", x: 1, y: 1 }] };
  const r3 = await post("/api/v1/leaderboard/submit", bad2);
  assert.equal(r3.status, 422);

  // version mismatch -> 422
  const bad3 = { ...payload, name: name + "z", contentVersion: 999 };
  const r4 = await post("/api/v1/leaderboard/submit", bad3);
  assert.equal(r4.status, 422);
  assert.deepEqual(await r4.json(), { error: "version-mismatch" });
});

test("achievements: unlock idempotent, unknown key rejected", async () => {
  const playerId = "p-" + Math.floor(Math.random() * 1e9);
  const r1 = await post("/api/v1/achievements", { playerId, key: "first-completion" });
  const j1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(j1.already, false);
  const r2 = await post("/api/v1/achievements", { playerId, key: "first-completion" });
  const j2 = await r2.json();
  assert.equal(j2.already, true);
  const r3 = await post("/api/v1/achievements", { playerId, key: "nope" });
  assert.equal(r3.status, 400);
});

test("unknown routes 404, malformed JSON 400", async () => {
  const r = await get("/api/v1/nope");
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: "not-found" });
  const r2 = await post("/api/v1/achievements", "{not json");
  assert.equal(r2.status, 400);
});
