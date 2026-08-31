import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION, MATERIALS, JOINT_TYPES, CHAMBER,
  makeRng, dailySeed, createSession, legalActions, applyCommand, stepRun,
  stateHash, serializeState, deserializeState, scoreBreakdown, verifyReplay, quantize,
} from "../src/rules.js";
import {
  CONTENT_VERSION, THEMES, LEARN_LESSONS, JOURNEY_LEVELS, CHALLENGE_LEVELS,
  ACHIEVEMENTS, dailyLevel, getLevel, validateLevel, validateAll,
} from "../src/content.js";

// Tiny authored level used across rule tests.
function testLevel(over = {}) {
  return {
    id: "t-1", version: CONTENT_VERSION, name: "Test", mode: "journey", seed: 42,
    theme: "foundry-core", difficulty: 1, timeLimitTicks: 60 * 20,
    spawnBudget: 3, allowedMaterials: ["wood", "steel", "glass", "rubber"],
    allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    obstacles: [], hazards: [],
    par: { spawns: 1, timeTicks: 300 },
    intro: "test", mechanicsIntroduced: [],
    ...over,
  };
}

// ------------------------------------------------------------------ legality

test("legalActions: per-material spawn legality and reasons", () => {
  const lvl = testLevel({ allowedMaterials: ["wood"], spawnBudget: 1 });
  let s = createSession({ level: lvl, seed: 1, mode: "journey" });
  const acts = legalActions(s);
  const wood = acts.find((a) => a.type === "spawn" && a.material === "wood");
  const steel = acts.find((a) => a.type === "spawn" && a.material === "steel");
  assert.equal(wood.ok, true);
  assert.equal(steel.ok, false);
  assert.equal(steel.reason, "material-not-allowed");

  const r = applyCommand(s, { id: "s1", type: "spawn", material: "wood", x: 5, y: 5 });
  assert.equal(r.error, null);
  s = r.state;
  const wood2 = legalActions(s).find((a) => a.type === "spawn" && a.material === "wood");
  assert.equal(wood2.ok, false);
  assert.equal(wood2.reason, "budget-exhausted");

  const run = applyCommand(s, { id: "r1", type: "run" });
  s = run.state;
  for (const a of legalActions(s)) {
    if (["spawn", "joint", "delete", "run"].includes(a.type)) {
      assert.equal(a.ok, false);
      assert.equal(a.reason, "already-running");
    }
  }
});

test("legalActions: joint needs two bodies and allowed joint types", () => {
  const lvl = testLevel({ allowedJoints: ["pin"], payloads: [{ material: "wood", x: 10, y: 8 }] });
  const s = createSession({ level: lvl, seed: 1, mode: "journey" });
  const pin = legalActions(s).find((a) => a.type === "joint" && a.joint === "pin");
  assert.equal(pin.ok, false);
  assert.equal(pin.reason, "need-two-bodies");
  const spring = legalActions(s).find((a) => a.type === "joint" && a.joint === "spring");
  assert.equal(spring.ok, false);
  assert.equal(spring.reason, "joint-not-allowed");
});

test("applyCommand: spawn, joint, delete happy paths and seq monotonicity", () => {
  let s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  let r = applyCommand(s, { id: "a", type: "spawn", material: "steel", x: 9, y: 8 });
  assert.equal(r.error, null);
  assert.equal(r.state.bodies.length, 2);
  assert.equal(r.state.movesUsed, 1);
  assert.ok(r.state.seq > s.seq);
  s = r.state;

  r = applyCommand(s, { id: "b", type: "joint", joint: "pin", a: "p0", b: "b0" });
  assert.equal(r.error, null);
  assert.equal(r.state.joints.length, 1);
  assert.equal(r.state.joints[0].restLength, 1);
  s = r.state;

  r = applyCommand(s, { id: "c", type: "delete", target: "b0" });
  assert.equal(r.error, null);
  assert.equal(r.state.bodies.length, 1);
  assert.equal(r.state.joints.length, 0); // joints on removed body are dropped
  s = r.state;

  // payload cannot be deleted
  r = applyCommand(s, { id: "d", type: "delete", target: "p0" });
  assert.equal(r.error.code, "illegal");
  assert.equal(r.error.message, "payload-locked");
  assert.equal(r.state.invalidActions, 1);
});

test("applyCommand: joint too far is illegal, invalidActions counted", () => {
  let s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  s = applyCommand(s, { id: "a", type: "spawn", material: "wood", x: 2, y: 8 }).state;
  const r = applyCommand(s, { id: "b", type: "joint", joint: "pin", a: "p0", b: "b0" });
  assert.equal(r.error.code, "illegal");
  assert.equal(r.error.message, "too-far");
  assert.equal(r.state.joints.length, 0);
  assert.equal(r.state.invalidActions, 1);
});

test("applyCommand: idempotent duplicate command ids return same state", () => {
  let s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  const r1 = applyCommand(s, { id: "dup", type: "spawn", material: "wood", x: 5, y: 5 });
  const r2 = applyCommand(r1.state, { id: "dup", type: "spawn", material: "wood", x: 5, y: 5 });
  assert.equal(r2.error, null);
  assert.deepEqual(r2.events, []);
  assert.equal(r2.state, r1.state); // same reference, unchanged
  assert.equal(r2.state.bodies.length, 2);
});

test("applyCommand: malformed commands rejected without invalidActions", () => {
  const s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  for (const bad of [null, {}, { id: 1, type: "spawn" }, { id: "x", type: "explode" }, { id: "", type: "spawn" }]) {
    const r = applyCommand(s, bad);
    assert.equal(r.error.code, "malformed");
    assert.equal(r.state, s);
  }
  assert.equal(s.invalidActions, 0);
});

test("applyCommand: out-of-bounds spawn rejected", () => {
  const s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  const r = applyCommand(s, { id: "o", type: "spawn", material: "wood", x: 100, y: 5 });
  assert.equal(r.error.code, "illegal");
  assert.equal(r.error.message, "out-of-bounds");
});

// ------------------------------------------------------------------ run phase

test("terminal: goal-complete by free fall", () => {
  const lvl = testLevel();
  const r = verifyReplay(lvl, 42, [{ id: "run", type: "run" }]);
  assert.equal(r.ok, true);
  assert.equal(r.terminalReason, "goal-complete");
  assert.ok(r.scoreBreakdown.components.goal === 1000);
  assert.ok(r.scoreBreakdown.components.timeBonus > 0);
});

test("terminal: time-expired", () => {
  const lvl = testLevel({
    timeLimitTicks: 120,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 18, y: 1.5, r: 1 }], // never reached in 120 ticks
  });
  const r = verifyReplay(lvl, 42, [{ id: "run", type: "run" }]);
  assert.equal(r.terminalReason, "time-expired");
  assert.ok(r.ticks <= 120 + 1);
});

test("terminal: payload-destroyed by hazard", () => {
  const lvl = testLevel({
    hazards: [{ x: 8, y: 0, w: 4, h: 2 }],
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 18, y: 1.5, r: 1 }],
  });
  const r = verifyReplay(lvl, 42, [{ id: "run", type: "run" }]);
  assert.equal(r.terminalReason, "payload-destroyed");
});

test("stepRun does nothing outside run phase", () => {
  const s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  const r = stepRun(s, 100);
  assert.equal(r.state, s);
  assert.deepEqual(r.events, []);
});

test("run caps at timeLimitTicks (no unbounded loop)", () => {
  const lvl = testLevel({ timeLimitTicks: 300, targets: [{ x: 18, y: 1.5, r: 1 }] });
  const r = verifyReplay(lvl, 42, [{ id: "run", type: "run" }]);
  assert.notEqual(r.terminalReason, null);
  assert.ok(r.ticks < 1000);
});

test("glass shatters on hard impact", () => {
  const lvl = testLevel({
    payloads: [{ material: "glass", x: 10, y: 11 }],
    targets: [{ x: 18, y: 1.5, r: 1.5 }],
    timeLimitTicks: 60 * 5,
  });
  // falls 10.5u -> impact speed ~ sqrt(2*10*10) ~ 14 > 6; shatter => payload destroyed
  const r = verifyReplay(lvl, 42, [{ id: "run", type: "run" }]);
  assert.equal(r.terminalReason, "payload-destroyed");
});

// ------------------------------------------------------------------ determinism

test("determinism property: same seed+commands -> identical hash (20 seeds)", () => {
  for (let trial = 0; trial < 20; trial++) {
    const seed = 1000 + trial * 7919;
    const rng = makeRng(seed);
    const lvl = testLevel({
      timeLimitTicks: 60 * 10,
      targets: [{ x: 4 + rng.next() * 12, y: 1.5, r: 1.3 }],
      obstacles: [{ x: 4 + rng.next() * 10, y: 3 + rng.next() * 4, w: 2 + rng.next() * 2, h: 0.4 }],
    });
    const commands = [];
    let s = createSession({ level: lvl, seed, mode: "journey" });
    const nCmd = 2 + rng.int(0, 4);
    for (let i = 0; i < nCmd; i++) {
      const mats = legalActions(s).filter((a) => a.type === "spawn" && a.ok);
      if (mats.length === 0) break;
      const m = rng.pick(mats).material;
      const cmd = {
        id: "c" + i, type: "spawn", material: m,
        x: 1 + rng.next() * (CHAMBER.w - 2), y: 1 + rng.next() * (CHAMBER.h - 2),
      };
      const r = applyCommand(s, cmd);
      if (!r.error) { commands.push(cmd); s = r.state; }
    }
    commands.push({ id: "run", type: "run" });
    const r1 = verifyReplay(lvl, seed, commands);
    const r2 = verifyReplay(lvl, seed, commands);
    assert.equal(r1.finalHash, r2.finalHash, "seed " + seed);
    assert.equal(r1.terminalReason, r2.terminalReason);
    assert.deepEqual(r1.scoreBreakdown, r2.scoreBreakdown);
  }
});

// ------------------------------------------------------------------ scoring

test("scoreBreakdown components on a scripted won session", () => {
  const lvl = testLevel({ spawnBudget: 5, timeLimitTicks: 1200, par: { spawns: 1, timeTicks: 300 } });
  let s = createSession({ level: lvl, seed: 7, mode: "journey" });
  s = applyCommand(s, { id: "s", type: "spawn", material: "steel", x: 12, y: 8 }).state;
  s = applyCommand(s, { id: "bad", type: "spawn", material: "glass", x: 99, y: 0 }).state; // illegal
  const run = applyCommand(s, { id: "run", type: "run" });
  let cur = run.state;
  while (cur.phase === "run") cur = stepRun(cur, 60).state;
  assert.equal(cur.phase, "won");
  const sb = scoreBreakdown(cur);
  assert.equal(sb.components.goal, 1000);
  assert.equal(sb.components.timeBonus, 1200 - (cur.tick - cur.runStartTick));
  assert.equal(sb.components.materialEfficiency, 250); // movesUsed(1) <= par.spawns(1)
  assert.equal(sb.components.spawnEfficiency, 50 * (5 - 1));
  assert.equal(sb.components.invalidPenalty, -25);
  assert.equal(sb.total, 1000 + sb.components.timeBonus + 250 + 200 - 25);
  for (const v of Object.values(sb.components)) assert.ok(Number.isInteger(v));
});

// ------------------------------------------------------------------ serialization

test("serialization round-trip preserves hash", () => {
  let s = createSession({ level: testLevel(), seed: 9, mode: "journey" });
  s = applyCommand(s, { id: "a", type: "spawn", material: "rubber", x: 6, y: 6 }).state;
  s = applyCommand(s, { id: "r", type: "run" }).state;
  s = stepRun(s, 30).state;
  const json = serializeState(s);
  const back = deserializeState(json);
  assert.equal(back.schemaVersion, SCHEMA_VERSION);
  assert.equal(stateHash(back), stateHash(s));
  assert.deepEqual(back, s);
});

test("deserializeState migrates missing schemaVersion as v1 identity", () => {
  const s = createSession({ level: testLevel(), seed: 9, mode: "journey" });
  const raw = JSON.parse(serializeState(s));
  delete raw.schemaVersion;
  const back = deserializeState(JSON.stringify(raw));
  assert.equal(back.schemaVersion, SCHEMA_VERSION);
});

// ------------------------------------------------------------------ fuzz

test("NaN/absurd fuzz: no throws, state safely rejected or unchanged", () => {
  let s = createSession({ level: testLevel(), seed: 1, mode: "journey" });
  const fuzz = [
    { id: "f1", type: "spawn", material: "wood", x: NaN, y: Infinity },
    { id: "f2", type: "spawn", material: "wood", x: 1e300, y: -1e300 },
    { id: "f3", type: "joint", joint: "pin", a: "nope", b: "also-nope" },
    { id: "f4", type: "delete", target: "ghost" },
    { id: "f5", type: "spawn", material: "unobtanium", x: 5, y: 5 },
  ];
  for (const cmd of fuzz) {
    const r = applyCommand(s, cmd);
    assert.ok(r.error, cmd.id);
    s = r.state;
  }
  // state still fully functional afterwards
  const r = applyCommand(s, { id: "ok", type: "spawn", material: "wood", x: 5, y: 5 });
  assert.equal(r.error, null);
  // stepping a running sim with extreme spawn heights never throws and stays finite
  let cur = applyCommand(r.state, { id: "run", type: "run" }).state;
  cur = stepRun(cur, 240).state;
  for (const b of cur.bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  }
});

// ------------------------------------------------------------------ rng / seeds

test("makeRng deterministic and bounded; dailySeed stable", () => {
  const a = makeRng(123), b = makeRng(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const rng = makeRng(7);
  for (let i = 0; i < 100; i++) {
    const v = rng.int(3, 9);
    assert.ok(v >= 3 && v < 9 && Number.isInteger(v));
  }
  assert.equal(dailySeed("2026-08-30"), dailySeed("2026-08-30"));
  assert.notEqual(dailySeed("2026-08-30"), dailySeed("2026-08-31"));
});

test("quantize rounds to 1e-6", () => {
  assert.equal(quantize(1.23456789), 1.234568);
  assert.equal(quantize(0), 0);
});

// ------------------------------------------------------------------ content

test("content: validateAll passes on all shipped levels", () => {
  const v = validateAll();
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("content: at least 40 journey levels, validators accept each", () => {
  assert.ok(JOURNEY_LEVELS.length >= 40);
  for (const lvl of JOURNEY_LEVELS) {
    assert.equal(validateLevel(lvl).ok, true, lvl.id);
    assert.ok(lvl.par && Number.isFinite(lvl.par.spawns));
    assert.ok(Array.isArray(lvl.mechanicsIntroduced));
  }
  // mastery stage every 8 levels
  for (const n of [8, 16, 24, 32, 40]) {
    assert.ok(JOURNEY_LEVELS[n - 1].tutorialFlags?.mastery, "journey-" + n);
  }
});

test("content: 5 themes with palettes", () => {
  assert.equal(Object.keys(THEMES).length, 5);
  for (const t of Object.values(THEMES)) {
    for (const k of ["background", "floor", "wall", "accent", "uiAccent"]) {
      assert.match(t.palette[k], /^#[0-9a-f]{6}$/i);
    }
    assert.ok(t.ambience.length > 0);
  }
});

test("content: learn lessons require commands in steps", () => {
  assert.ok(LEARN_LESSONS.length >= 6);
  for (const l of LEARN_LESSONS) {
    assert.ok(Array.isArray(l.steps) && l.steps.length >= 1, l.id);
    for (const st of l.steps) assert.ok(st.requireCommand.type);
  }
});

test("content: dailyLevel deterministic and theme rotates", () => {
  const d1 = dailyLevel("2026-08-30");
  const d2 = dailyLevel("2026-08-30");
  assert.deepEqual(d1, d2);
  assert.equal(d1.seed, dailySeed("2026-08-30"));
  const d3 = dailyLevel("2026-08-31");
  assert.notEqual(d1.seed, d3.seed);
  const themes = new Set();
  for (let i = 1; i <= 10; i++) themes.add(dailyLevel("2026-09-" + String(i).padStart(2, "0")).theme);
  assert.ok(themes.size > 1);
  assert.equal(validateLevel(d1).ok, true, JSON.stringify(validateLevel(d1).errors));
});

test("content: getLevel lookup and achievement keys", () => {
  assert.equal(getLevel("journey-1").id, "journey-1");
  assert.equal(getLevel("learn-1").mode, "learn");
  assert.equal(getLevel("challenge-1").mode, "challenge");
  assert.equal(getLevel("nope"), null);
  for (const k of ["first-completion", "mechanic-mastery", "streak-3", "mastery-milestone", "marathon-builder"]) {
    assert.ok(ACHIEVEMENTS[k], k);
    assert.equal(k, k.toLowerCase());
    assert.equal(ACHIEVEMENTS[k].key, k);
  }
  assert.ok(Object.keys(MATERIALS).length >= 4);
  assert.ok(Object.keys(JOINT_TYPES).length >= 2);
});
