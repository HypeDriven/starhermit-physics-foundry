// Pure deterministic rules engine for Physics Foundry.
// No DOM, no Math.random, no Date.now. Everything seeded and serializable.

export const SCHEMA_VERSION = 1;

export const CHAMBER = Object.freeze({ w: 20, h: 12 });
export const DT = 1 / 60;
export const BALL_RADIUS = 0.5;
const RELAX_ITERS = 4;
const DEFAULT_GRAVITY = -10; // signed y acceleration (u/s^2)

export const MATERIALS = Object.freeze({
  steel:  { id: "steel",  name: "Steel",  color: "#c9d4e8", density: 3,   restitution: 0.2,  size: 0.5 },
  wood:   { id: "wood",   name: "Wood",   color: "#b5722f", density: 1,   restitution: 0.35, size: 0.5 },
  glass:  { id: "glass",  name: "Glass",  color: "#6fd3ff", density: 0.8, restitution: 0.1,  size: 0.5, shatterSpeed: 6 },
  rubber: { id: "rubber", name: "Rubber", color: "#d14b4b", density: 0.7, restitution: 0.85, size: 0.5 },
});

export const JOINT_TYPES = Object.freeze({
  pin:    { id: "pin",    name: "Pin Joint", size: 0.6, maxLength: 3 },
  spring: { id: "spring", name: "Spring",    size: 0.6, maxLength: 5, stiffness: 40, damping: 4 },
});

// Compat shims for the phase-0 client stubs (render.js/ui.js).
export function entityInfo(id) { return MATERIALS[id]; }
export function jointInfo(id) { return JOINT_TYPES[id]; }

// ---------------------------------------------------------------- RNG

export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  return { next, int, pick };
}

export function dailySeed(utcDateString) {
  // FNV-1a 32-bit over the date string.
  let h = 0x811c9dc5;
  const str = String(utcDateString);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- utils

export function quantize(v) {
  return Math.round(v * 1e6) / 1e6;
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function makeBody(id, kind, material, x, y) {
  const m = MATERIALS[material];
  const mass = m.density * Math.PI * BALL_RADIUS * BALL_RADIUS;
  return {
    id, kind, material,
    x, y, vx: 0, vy: 0,
    r: BALL_RADIUS,
    mass, invMass: 1 / mass,
    restitution: m.restitution,
  };
}

// ---------------------------------------------------------------- session

export function createSession({ level, seed, mode }) {
  const lvl = clone(level);
  const bodies = (lvl.payloads || []).map((p, i) =>
    makeBody("p" + i, "payload", p.material, p.x, p.y));
  return {
    schemaVersion: SCHEMA_VERSION,
    contentVersion: lvl.version,
    levelId: lvl.id,
    seed: seed >>> 0,
    mode: mode || lvl.mode || "journey",
    level: lvl,
    chamber: { w: CHAMBER.w, h: CHAMBER.h },
    gravity: finite(lvl.gravity) ? lvl.gravity : DEFAULT_GRAVITY,
    phase: "build",
    tick: 0,
    seq: 0,
    nextId: 0,
    bodies,
    joints: [],
    spawnBudget: lvl.spawnBudget,
    movesUsed: 0,
    invalidActions: 0,
    runStartTick: null,
    events: [],
    goals: { delivered: 0, total: bodies.length, status: "pending" },
    terminalReason: null,
    commandIds: [],
  };
}

// ---------------------------------------------------------------- legality

function spawnCheck(state, material) {
  if (state.phase === "run") return { ok: false, reason: "already-running" };
  if (state.phase !== "build") return { ok: false, reason: "session-over" };
  if (!MATERIALS[material]) return { ok: false, reason: "material-unknown" };
  if (!state.level.allowedMaterials.includes(material)) return { ok: false, reason: "material-not-allowed" };
  if (state.movesUsed >= state.spawnBudget) return { ok: false, reason: "budget-exhausted" };
  return { ok: true };
}

function jointCheck(state, jointType) {
  if (state.phase === "run") return { ok: false, reason: "already-running" };
  if (state.phase !== "build") return { ok: false, reason: "session-over" };
  if (!JOINT_TYPES[jointType]) return { ok: false, reason: "joint-unknown" };
  if (!state.level.allowedJoints.includes(jointType)) return { ok: false, reason: "joint-not-allowed" };
  if (state.bodies.length < 2) return { ok: false, reason: "need-two-bodies" };
  return { ok: true };
}

export function legalActions(state) {
  const out = [];
  for (const mat of Object.keys(MATERIALS)) {
    out.push({ type: "spawn", material: mat, ...spawnCheck(state, mat) });
  }
  for (const jt of Object.keys(JOINT_TYPES)) {
    out.push({ type: "joint", joint: jt, ...jointCheck(state, jt) });
  }
  let del;
  if (state.phase === "run") del = { ok: false, reason: "already-running" };
  else if (state.phase !== "build") del = { ok: false, reason: "session-over" };
  else if (!state.bodies.some((b) => b.kind === "player") && state.joints.length === 0)
    del = { ok: false, reason: "nothing-to-delete" };
  else del = { ok: true };
  out.push({ type: "delete", ...del });

  let run;
  if (state.phase === "run") run = { ok: false, reason: "already-running" };
  else if (state.phase !== "build") run = { ok: false, reason: "session-over" };
  else run = { ok: true };
  out.push({ type: "run", ...run });

  out.push({ type: "reset", ok: true });
  return out;
}

// ---------------------------------------------------------------- commands

const COMMAND_TYPES = new Set(["spawn", "joint", "delete", "run", "reset"]);

function illegal(state, cmd, reason) {
  const s = clone(state);
  s.commandIds.push(cmd.id);
  s.invalidActions += 1;
  s.seq += 1;
  return { state: s, events: [], error: { code: "illegal", message: reason } };
}

function ok(state, cmd, events) {
  const s = state; // already cloned by caller
  s.commandIds.push(cmd.id);
  s.seq += 1;
  s.events.push(...events);
  return { state: s, events, error: null };
}

export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== "object" || typeof cmd.id !== "string" || cmd.id.length === 0
      || !COMMAND_TYPES.has(cmd.type)) {
    return { state, events: [], error: { code: "malformed", message: "malformed-command" } };
  }
  if (state.commandIds.includes(cmd.id)) {
    return { state, events: [], error: null }; // idempotent dedupe
  }

  switch (cmd.type) {
    case "spawn": {
      const chk = spawnCheck(state, cmd.material);
      if (!chk.ok) return illegal(state, cmd, chk.reason);
      if (!finite(cmd.x) || !finite(cmd.y)) return illegal(state, cmd, "bad-position");
      const r = BALL_RADIUS;
      if (cmd.x < r || cmd.x > state.chamber.w - r || cmd.y < r || cmd.y > state.chamber.h - r)
        return illegal(state, cmd, "out-of-bounds");
      const s = clone(state);
      const body = makeBody("b" + s.nextId++, "player", cmd.material, cmd.x, cmd.y);
      s.bodies.push(body);
      s.movesUsed += 1;
      return ok(s, cmd, [{ type: "spawn", id: body.id, material: cmd.material, x: cmd.x, y: cmd.y }]);
    }
    case "joint": {
      const chk = jointCheck(state, cmd.joint);
      if (!chk.ok) return illegal(state, cmd, chk.reason);
      const a = state.bodies.find((b) => b.id === cmd.a);
      const b = state.bodies.find((b) => b.id === cmd.b);
      if (!a || !b || a.id === b.id) return illegal(state, cmd, "bad-bodies");
      const jt = JOINT_TYPES[cmd.joint];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (!(dist <= jt.maxLength)) return illegal(state, cmd, "too-far");
      const s = clone(state);
      const joint = {
        id: "j" + s.nextId++, type: cmd.joint, a: a.id, b: b.id,
        restLength: dist,
        stiffness: jt.stiffness || 0, damping: jt.damping || 0,
      };
      s.joints.push(joint);
      return ok(s, cmd, [{ type: "joint", id: joint.id, joint: cmd.joint, a: a.id, b: b.id }]);
    }
    case "delete": {
      if (state.phase === "run") return illegal(state, cmd, "already-running");
      if (state.phase !== "build") return illegal(state, cmd, "session-over");
      const s = clone(state);
      const bi = s.bodies.findIndex((x) => x.id === cmd.target);
      if (bi >= 0) {
        if (s.bodies[bi].kind === "payload") return illegal(state, cmd, "payload-locked");
        const [removed] = s.bodies.splice(bi, 1);
        s.joints = s.joints.filter((j) => j.a !== removed.id && j.b !== removed.id);
        return ok(s, cmd, [{ type: "delete", target: removed.id }]);
      }
      const ji = s.joints.findIndex((x) => x.id === cmd.target);
      if (ji >= 0) {
        s.joints.splice(ji, 1);
        return ok(s, cmd, [{ type: "delete", target: cmd.target }]);
      }
      return illegal(state, cmd, "not-found");
    }
    case "run": {
      if (state.phase === "run") return illegal(state, cmd, "already-running");
      if (state.phase !== "build") return illegal(state, cmd, "session-over");
      const s = clone(state);
      s.phase = "run";
      s.runStartTick = s.tick;
      return ok(s, cmd, [{ type: "run" }]);
    }
    case "reset": {
      const s = createSession({ level: state.level, seed: state.seed, mode: state.mode });
      s.seq = state.seq + 1;
      s.invalidActions = state.invalidActions;
      s.commandIds = state.commandIds.concat(cmd.id);
      return { state: s, events: [{ type: "reset" }], error: null };
    }
  }
  return { state, events: [], error: { code: "malformed", message: "unknown-command" } };
}

// ---------------------------------------------------------------- physics

function removeBody(s, events, idx, eventType) {
  const [b] = s.bodies.splice(idx, 1);
  s.joints = s.joints.filter((j) => j.a !== b.id && j.b !== b.id);
  events.push({ type: eventType, id: b.id, kind: b.kind, tick: s.tick });
  return b;
}

function physicsStep(s, events) {
  const g = s.gravity;
  const bodies = s.bodies;

  // gravity
  for (const b of bodies) b.vy += g * DT;

  // spring forces
  for (const j of s.joints) {
    if (j.type !== "spring") continue;
    const a = bodies.find((x) => x.id === j.a);
    const b = bodies.find((x) => x.id === j.b);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) continue;
    const nx = dx / dist, ny = dy / dist;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const f = j.stiffness * (dist - j.restLength) + j.damping * (rvx * nx + rvy * ny);
    a.vx += f * nx * a.invMass * DT; a.vy += f * ny * a.invMass * DT;
    b.vx -= f * nx * b.invMass * DT; b.vy -= f * ny * b.invMass * DT;
  }

  // integrate
  for (const b of bodies) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
  }

  const shattered = [];

  // circle vs circle
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      const dist = Math.sqrt(d2);
      const nx = dx / dist, ny = dy / dist;
      const overlap = rr - dist;
      const invSum = a.invMass + b.invMass;
      // positional correction
      a.x -= nx * overlap * (a.invMass / invSum);
      a.y -= ny * overlap * (a.invMass / invSum);
      b.x += nx * overlap * (b.invMass / invSum);
      b.y += ny * overlap * (b.invMass / invSum);
      // impulse
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const impact = -vn;
        if (impact > 6) {
          if (a.material === "glass") shattered.push(a.id);
          if (b.material === "glass") shattered.push(b.id);
        }
        const e = Math.min(a.restitution, b.restitution);
        const imp = (-(1 + e) * vn) / invSum;
        a.vx -= imp * nx * a.invMass; a.vy -= imp * ny * a.invMass;
        b.vx += imp * nx * b.invMass; b.vy += imp * ny * b.invMass;
      }
    }
  }

  // circle vs obstacle rects and walls
  const wallHit = (b, impact) => {
    if (impact > 6 && b.material === "glass") shattered.push(b.id);
  };
  for (const b of bodies) {
    for (const o of s.level.obstacles || []) {
      const cx = Math.max(o.x, Math.min(b.x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(b.y, o.y + o.h));
      const dx = b.x - cx, dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= b.r * b.r) continue;
      let nx, ny, dist;
      if (d2 < 1e-12) { nx = 0; ny = 1; dist = 0; }
      else { dist = Math.sqrt(d2); nx = dx / dist; ny = dy / dist; }
      const overlap = b.r - dist;
      b.x += nx * overlap; b.y += ny * overlap;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        wallHit(b, -vn);
        const e = b.restitution;
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
      }
    }
    // chamber walls: x in [0,W], y in [0,H]
    const W = s.chamber.w, H = s.chamber.h;
    if (b.x < b.r) {
      b.x = b.r;
      if (b.vx < 0) { wallHit(b, -b.vx); b.vx = -b.vx * b.restitution; }
    } else if (b.x > W - b.r) {
      b.x = W - b.r;
      if (b.vx > 0) { wallHit(b, b.vx); b.vx = -b.vx * b.restitution; }
    }
    if (b.y < b.r) {
      b.y = b.r;
      if (b.vy < 0) { wallHit(b, -b.vy); b.vy = -b.vy * b.restitution; }
    } else if (b.y > H - b.r) {
      b.y = H - b.r;
      if (b.vy > 0) { wallHit(b, b.vy); b.vy = -b.vy * b.restitution; }
    }
  }

  // glass shatter (insertion order, deduped)
  for (const id of shattered) {
    const idx = s.bodies.findIndex((b) => b.id === id);
    if (idx >= 0) {
      const removed = removeBody(s, events, idx, "shatter");
      if (removed.kind === "payload" && s.phase === "run") {
        s.phase = "lost";
        s.terminalReason = "payload-destroyed";
      }
    }
  }

  // pin constraints + spring max-length: fixed relaxation iterations
  for (let it = 0; it < RELAX_ITERS; it++) {
    for (const j of s.joints) {
      const a = s.bodies.find((x) => x.id === j.a);
      const b = s.bodies.find((x) => x.id === j.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-9) continue;
      let target = null;
      if (j.type === "pin") target = j.restLength;
      else if (j.type === "spring" && dist > JOINT_TYPES.spring.maxLength) target = JOINT_TYPES.spring.maxLength;
      if (target === null) continue;
      const diff = (dist - target) / dist;
      const invSum = a.invMass + b.invMass;
      const fa = a.invMass / invSum, fb = b.invMass / invSum;
      a.x += dx * diff * fa; a.y += dy * diff * fa;
      b.x -= dx * diff * fb; b.y -= dy * diff * fb;
    }
  }
}

// ---------------------------------------------------------------- run phase

export function stepRun(state, ticks) {
  if (state.phase !== "run" || !(ticks > 0)) return { state, events: [] };
  const s = clone(state);
  const events = [];
  const limit = s.level.timeLimitTicks;

  for (let n = 0; n < ticks && s.phase === "run"; n++) {
    s.tick += 1;
    physicsStep(s, events);

    // NaN guard
    for (let i = s.bodies.length - 1; i >= 0; i--) {
      const b = s.bodies[i];
      if (!finite(b.x) || !finite(b.y) || !finite(b.vx) || !finite(b.vy)) {
        const removed = removeBody(s, events, i, "lost");
        if (removed.kind === "payload") {
          s.phase = "lost";
          s.terminalReason = "payload-destroyed";
        }
      }
    }
    if (s.phase !== "run") break;

    // hazards
    for (let i = s.bodies.length - 1; i >= 0; i--) {
      const b = s.bodies[i];
      const inHazard = (s.level.hazards || []).some((h) =>
        b.x > h.x && b.x < h.x + h.w && b.y > h.y && b.y < h.y + h.h);
      if (inHazard) {
        const removed = removeBody(s, events, i, "destroyed");
        if (removed.kind === "payload") {
          s.phase = "lost";
          s.terminalReason = "payload-destroyed";
        }
      }
    }
    if (s.phase !== "run") break;

    // goals: payload center within any undelivered target radius
    for (let i = s.bodies.length - 1; i >= 0; i--) {
      const b = s.bodies[i];
      if (b.kind !== "payload") continue;
      const hit = (s.level.targets || []).some((t) =>
        Math.hypot(b.x - t.x, b.y - t.y) <= t.r);
      if (hit) {
        removeBody(s, events, i, "delivered");
        s.goals.delivered += 1;
      }
    }
    if (s.goals.total > 0 && s.goals.delivered >= s.goals.total) {
      s.goals.status = "complete";
      s.phase = "won";
      s.terminalReason = "goal-complete";
      break;
    }

    // time limit
    if (finite(limit) && s.tick - s.runStartTick >= limit) {
      s.phase = "lost";
      s.terminalReason = "time-expired";
      s.goals.status = "failed";
      break;
    }
  }

  if (s.phase !== "run") s.goals.status = s.phase === "won" ? "complete" : "failed";
  s.events.push(...events);
  return { state: s, events };
}

// ---------------------------------------------------------------- hashing / serialization

export function stateHash(state) {
  const canon = {
    phase: state.phase,
    tick: state.tick,
    bodies: state.bodies.map((b) => [
      b.id, b.material, quantize(b.x), quantize(b.y), quantize(b.vx), quantize(b.vy),
    ]),
    joints: state.joints.map((j) => [j.id, j.type, j.a, j.b, quantize(j.restLength)]),
    goals: [state.goals.delivered, state.goals.total, state.goals.status],
    spawnBudget: state.spawnBudget,
    movesUsed: state.movesUsed,
    invalidActions: state.invalidActions,
  };
  const str = JSON.stringify(canon);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function serializeState(state) {
  return JSON.stringify(state);
}

const MIGRATIONS = {
  // 1: identity; future migrations go here keyed by source version.
};

export function deserializeState(json) {
  const state = typeof json === "string" ? JSON.parse(json) : json;
  let v = state.schemaVersion ?? 1;
  while (v < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[v];
    if (migrate) migrate(state);
    v += 1;
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

// ---------------------------------------------------------------- scoring

export function scoreBreakdown(state) {
  const goal = 1000 * state.goals.delivered;
  const limit = state.level.timeLimitTicks;
  const elapsed = state.runStartTick === null ? 0 : state.tick - state.runStartTick;
  const timeBonus = finite(limit) ? Math.max(0, Math.round(limit - elapsed)) : 0;
  const parSpawns = (state.level.par && state.level.par.spawns) ?? 0;
  const materialEfficiency = state.movesUsed <= parSpawns
    ? 250
    : Math.max(0, 250 - 50 * (state.movesUsed - parSpawns));
  const spawnEfficiency = Math.max(0, 50 * (state.spawnBudget - state.movesUsed));
  const invalidPenalty = -25 * state.invalidActions;
  const components = { goal, timeBonus, materialEfficiency, spawnEfficiency, invalidPenalty };
  const total = Math.max(0, goal + timeBonus + materialEfficiency + spawnEfficiency + invalidPenalty);
  return { components, total };
}

// ---------------------------------------------------------------- replay

export function verifyReplay(level, seed, commands) {
  let state = createSession({ level, seed, mode: level.mode });
  for (const cmd of commands || []) {
    const res = applyCommand(state, cmd);
    if (res.error) {
      return { ok: false, error: res.error, finalHash: stateHash(state), terminalReason: state.terminalReason, ticks: state.tick };
    }
    state = res.state;
    if (cmd.type === "run") {
      // auto-step to terminal, bounded by timeLimitTicks (plus slack)
      const cap = (level.timeLimitTicks ?? 60 * 120) + 60;
      let stepped = 0;
      while (state.phase === "run" && stepped < cap) {
        const batch = Math.min(120, cap - stepped);
        const r = stepRun(state, batch);
        state = r.state;
        stepped += batch;
      }
      if (state.phase === "run") {
        // unbounded safety net; should not happen with a valid level
        state = { ...state, phase: "lost", terminalReason: "time-expired" };
      }
    }
  }
  return {
    ok: true,
    finalHash: stateHash(state),
    scoreBreakdown: scoreBreakdown(state),
    terminalReason: state.terminalReason,
    ticks: state.tick,
  };
}
