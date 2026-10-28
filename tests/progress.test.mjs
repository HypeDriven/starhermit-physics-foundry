// The save model (src/progress.js): normalizing, the two-device merge, the
// browser build's cloud slot as a foreign save, the run / lesson / spawn
// bookkeeping (stars, streak, bests, dailies, achievements) and the game's
// options. The signed-in paths (foreign migration, conflict merge, legacy
// settings) can't be live-tested here; their logic is covered by these.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/progress.js";
import { JOURNEY_LEVELS, LEARN_LESSONS } from "../src/content.js";

test("defaultSave has a player id; normalize fills missing fields and keeps an empty id empty", () => {
  const d = P.defaultSave();
  assert.equal(d.v, 1);
  assert.ok(d.progress.playerId.length > 0);
  const n = P.normalize({ progress: { completed: { a: true }, counters: { wins: 2 } } });
  assert.deepEqual(n.progress.completed, { a: true });
  assert.deepEqual(n.progress.counters, { spawns: 0, wins: 2, streak: 0 });
  assert.equal(n.progress.playerId, "");
  assert.ok(P.sameSave(n, P.normalize(n)), "normalize is stable");
  assert.deepEqual(P.normalize(null).progress.achievements, []);
});

test("mergeSave unions progress, keeps the larger totals and bests, this device's streak", () => {
  const remote = { progress: { playerId: "r", completed: { "journey-1": true }, stars: { "journey-1": true }, achievements: ["first-completion"],
    counters: { spawns: 40, wins: 5, streak: 4 }, bests: { "journey-1": 2000 }, dailyAttempts: { "2026-10-01": { score: 900 } }, lastMode: "daily" } };
  const local = { progress: { playerId: "l", completed: { "journey-2": true }, lessonsDone: { "learn-1": true }, achievements: ["streak-3"],
    counters: { spawns: 10, wins: 9, streak: 1 }, bests: { "journey-1": 2500, "journey-2": 100 }, dailyAttempts: { "2026-10-01": { score: 800 } }, lastMode: "journey" } };
  const m = P.mergeSave(remote, local).progress;
  assert.deepEqual(m.completed, { "journey-1": true, "journey-2": true });
  assert.deepEqual(m.lessonsDone, { "learn-1": true });
  assert.deepEqual([...m.achievements].sort(), ["first-completion", "streak-3"]);
  assert.deepEqual(m.counters, { spawns: 40, wins: 9, streak: 1 });
  assert.deepEqual(m.bests, { "journey-1": 2500, "journey-2": 100 });
  assert.deepEqual(m.dailyAttempts["2026-10-01"], { score: 900 });
  assert.equal(m.lastMode, "journey");
  assert.equal(m.playerId, "r");
  assert.ok(P.sameSave(P.mergeSave({ progress: m }, { progress: m }), { progress: m }), "merging a save with itself changes nothing");
});

test("readForeign: the browser build's { settings, progress } cloud text", () => {
  const text = JSON.stringify({
    settings: { music: 0.3, leftHanded: true, cameraDefault: "tight", jointMode: "hold", haptics: "yes", graphics: { preset: "high" } },
    progress: { completed: { "journey-3": true }, achievements: ["first-completion"], counters: { spawns: 12, wins: 1, streak: 1 } },
  });
  const f = P.readForeign(text);
  assert.deepEqual(f.save.progress.completed, { "journey-3": true });
  assert.deepEqual(f.options, { leftHanded: true, cameraDefault: "tight", jointMode: "hold" });
  assert.deepEqual(P.readForeign(JSON.stringify({ completed: { x: true } })).save.progress.completed, { x: true });
  assert.equal(P.readForeign("not json"), null);
  assert.equal(P.readForeign(JSON.stringify({ hello: 1 })), null);
  assert.equal(P.readForeign(""), null);
});

test("recordRun: completion, stars at par, streak, bests, dailies and achievements (ui.js onTerminal)", () => {
  const p = P.normalize(null).progress;
  const j1 = JOURNEY_LEVELS[0];
  let r = P.recordRun(p, { levelId: j1.id, won: true, total: 3000, movesUsed: 0, elapsedTicks: 100, par: j1.par, daily: null });
  assert.equal(r.firstWin, true);
  assert.equal(r.newBest, true);
  assert.deepEqual(r.newly, ["first-completion"]);
  assert.equal(p.stars[j1.id], true);
  r = P.recordRun(p, { levelId: j1.id, won: true, total: 2000, movesUsed: 5, elapsedTicks: 9999, par: j1.par, daily: null });
  assert.equal(r.firstWin, false);
  assert.equal(r.newBest, false);
  assert.equal(r.prevBest, 3000);
  r = P.recordRun(p, { levelId: "daily-2026-10-28", won: true, total: 1500, movesUsed: 1, elapsedTicks: 100, par: { spawns: 0, timeTicks: 1 }, daily: "2026-10-28" });
  assert.deepEqual(r.newly, ["streak-3"]);
  assert.deepEqual(p.dailyAttempts["2026-10-28"], { score: 1500 });
  P.recordRun(p, { levelId: j1.id, won: false, total: 100, movesUsed: 0, elapsedTicks: 10, par: j1.par, daily: "2026-10-29" });
  assert.equal(p.counters.streak, 0);
  assert.deepEqual(p.dailyAttempts["2026-10-29"], { score: 100 });
  assert.equal(p.counters.wins, 3);
});

test("recordLesson and recordSpawn unlock Mechanic Mastery and Marathon Builder once", () => {
  const p = P.normalize(null).progress;
  let last;
  for (const l of LEARN_LESSONS) last = P.recordLesson(p, l.id);
  assert.deepEqual(last, { first: true, newly: ["mechanic-mastery"] });
  assert.deepEqual(P.recordLesson(p, LEARN_LESSONS[0].id), { first: false, newly: [] });
  p.counters.spawns = 498;
  assert.deepEqual(P.recordSpawn(p), []);
  assert.deepEqual(P.recordSpawn(p), ["marathon-builder"]);
  assert.deepEqual(P.recordSpawn(p), []);
});

test("options: defaults, valid values only, the browser build's KV keys", () => {
  assert.deepEqual(P.DEFAULT_OPTIONS, { leftHanded: false, cameraDefault: "frame", jointMode: "toggle", haptics: false });
  assert.deepEqual(P.pickOptions({ leftHanded: 1, cameraDefault: "wide", jointMode: "toggle", haptics: true }), { jointMode: "toggle", haptics: true });
  for (const k of P.OPTION_KEYS) assert.ok(P.BROWSER_KEYS.includes(k));
});
