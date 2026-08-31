// Versioned content for Physics Foundry: themes, learn lessons, journey,
// challenges, daily generation, achievements, and offline validators.

import { CHAMBER, dailySeed, makeRng, MATERIALS, JOINT_TYPES } from "./rules.js";

export const CONTENT_VERSION = 1;

const W = CHAMBER.w, H = CHAMBER.h;
const MAX_TIME_TICKS = 60 * 120;

// ---------------------------------------------------------------- themes

export const THEMES = Object.freeze({
  "foundry-core": {
    id: "foundry-core", name: "Foundry Core",
    palette: { background: "#14161c", floor: "#3a3f4d", wall: "#565d70", accent: "#ff8a3d", uiAccent: "#ffb066" },
    ambience: "deep furnace hum with distant hammer falls",
  },
  "ember-line": {
    id: "ember-line", name: "Ember Line",
    palette: { background: "#1d1210", floor: "#4a2c22", wall: "#6e4232", accent: "#ff552e", uiAccent: "#ff9066" },
    ambience: "crackling slag channels and slow conveyor clank",
  },
  "frost-bay": {
    id: "frost-bay", name: "Frost Bay",
    palette: { background: "#0e161d", floor: "#2c4254", wall: "#45617a", accent: "#7fd8ff", uiAccent: "#a8e6ff" },
    ambience: "cold air fans and crystalline pings",
  },
  "verdant-annex": {
    id: "verdant-annex", name: "Verdant Annex",
    palette: { background: "#101a12", floor: "#2c4630", wall: "#43674a", accent: "#8ce26a", uiAccent: "#b5f29c" },
    ambience: "greenhouse drips over idling machinery",
  },
  "dusk-terminal": {
    id: "dusk-terminal", name: "Dusk Terminal",
    palette: { background: "#16121f", floor: "#372d4d", wall: "#514573", accent: "#c39bff", uiAccent: "#dcc6ff" },
    ambience: "low transformer drone with far-off signal bells",
  },
});

const THEME_KEYS = Object.keys(THEMES);

// ---------------------------------------------------------------- level helper

function mk(over) {
  const base = {
    id: "level",
    version: CONTENT_VERSION,
    name: "Untitled",
    mode: "journey",
    seed: 1,
    theme: "foundry-core",
    difficulty: 1,
    timeLimitTicks: 60 * 30,
    spawnBudget: 4,
    allowedMaterials: ["wood"],
    allowedJoints: [],
    payloads: [],
    targets: [],
    obstacles: [],
    hazards: [],
    par: { spawns: 1, timeTicks: 60 * 20 },
    intro: "",
    mechanicsIntroduced: [],
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------- learn mode

export const LEARN_LESSONS = Object.freeze([
  mk({
    id: "learn-1", name: "First Casting", mode: "learn", theme: "foundry-core",
    spawnBudget: 2, allowedMaterials: ["wood"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 0, timeTicks: 60 * 10 },
    intro: "Drop a wood ball anywhere inside the chamber.",
    mechanicsIntroduced: ["spawn"],
    steps: [
      { text: "Spawn a wood ball above the floor.", requireCommand: { type: "spawn", material: "wood" } },
    ],
  }),
  mk({
    id: "learn-2", name: "Heavy Stock", mode: "learn", theme: "foundry-core",
    spawnBudget: 3, allowedMaterials: ["wood", "steel"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 1, timeTicks: 60 * 10 },
    intro: "Steel is dense and barely bounces. Spawn one.",
    mechanicsIntroduced: ["material-steel"],
    steps: [
      { text: "Spawn a steel ball.", requireCommand: { type: "spawn", material: "steel" } },
    ],
  }),
  mk({
    id: "learn-3", name: "Pin and Link", mode: "learn", theme: "foundry-core",
    spawnBudget: 3, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 1, timeTicks: 60 * 10 },
    intro: "Pins hold two balls at a fixed distance. Link two balls.",
    mechanicsIntroduced: ["joint-pin"],
    steps: [
      { text: "Spawn a wood ball near the payload.", requireCommand: { type: "spawn", material: "wood" } },
      { text: "Connect two balls with a pin joint.", requireCommand: { type: "joint", joint: "pin" } },
    ],
  }),
  mk({
    id: "learn-4", name: "Second Thoughts", mode: "learn", theme: "ember-line",
    spawnBudget: 3, allowedMaterials: ["wood", "rubber"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 1, timeTicks: 60 * 10 },
    intro: "Remove a ball you no longer need.",
    mechanicsIntroduced: ["delete"],
    steps: [
      { text: "Spawn a rubber ball.", requireCommand: { type: "spawn", material: "rubber" } },
      { text: "Delete a ball you spawned.", requireCommand: { type: "delete" } },
    ],
  }),
  mk({
    id: "learn-5", name: "Let It Run", mode: "learn", theme: "ember-line",
    spawnBudget: 2, allowedMaterials: ["wood"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 0, timeTicks: 60 * 10 },
    intro: "Start the simulation and watch the payload fall.",
    mechanicsIntroduced: ["run"],
    steps: [
      { text: "Issue the run command.", requireCommand: { type: "run" } },
    ],
  }),
  mk({
    id: "learn-6", name: "Full Cycle", mode: "learn", theme: "frost-bay",
    spawnBudget: 3, allowedMaterials: ["wood", "rubber"], allowedJoints: ["spring"], timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 9, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 1, timeTicks: 60 * 10 },
    intro: "Build, connect, run: the complete foundry loop.",
    mechanicsIntroduced: ["joint-spring", "full-cycle"],
    steps: [
      { text: "Spawn any ball.", requireCommand: { type: "spawn" } },
      { text: "Join two balls with a spring.", requireCommand: { type: "joint", joint: "spring" } },
      { text: "Run the simulation.", requireCommand: { type: "run" } },
    ],
  }),
]);

// ---------------------------------------------------------------- journey

// Explicit per-level parameters; one mechanic at a time, combined with a known
// one, mastery stage every 8 levels. All payloads sit above (or beside with a
// clear fall line to) a target so a free-fall or ramp path always exists.

const J = (n, name, over) => mk({
  id: "journey-" + n, name, mode: "journey", seed: 1000 + n,
  theme: THEME_KEYS[(n - 1) % THEME_KEYS.length],
  ...over,
});

export const JOURNEY_LEVELS = Object.freeze([
  // --- 1-7: spawning basics (mechanic: spawn, run, materials) -------------
  J(1, "First Drop", {
    difficulty: 1, spawnBudget: 2, allowedMaterials: ["wood"],
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    par: { spawns: 0, timeTicks: 300 }, intro: "Run it. Gravity does the work.",
    mechanicsIntroduced: ["spawn"],
  }),
  J(2, "Off the Mark", {
    difficulty: 1, spawnBudget: 3, allowedMaterials: ["wood"],
    payloads: [{ material: "wood", x: 8, y: 8 }],
    targets: [{ x: 12, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 9.5, y: 4, w: 3, h: 0.4 }],
    par: { spawns: 1, timeTicks: 400 }, intro: "The ramp nudges the payload toward the zone.",
    mechanicsIntroduced: ["ramps"],
  }),
  J(3, "Steel Nudge", {
    difficulty: 1, spawnBudget: 4, allowedMaterials: ["wood", "steel"],
    payloads: [{ material: "wood", x: 9, y: 7 }],
    targets: [{ x: 11, y: 1.5, r: 1.5 }],
    par: { spawns: 1, timeTicks: 400 }, intro: "A steel ball can shove the payload sideways.",
    mechanicsIntroduced: ["material-steel"],
  }),
  J(4, "Bounce House", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "rubber"],
    payloads: [{ material: "rubber", x: 6, y: 9 }],
    targets: [{ x: 14, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 8, y: 3, w: 2.5, h: 0.4 }, { x: 12, y: 1.6, w: 2.5, h: 0.4 }],
    par: { spawns: 1, timeTicks: 500 }, intro: "Rubber keeps energy. Use the ramps.",
    mechanicsIntroduced: ["material-rubber"],
  }),
  J(5, "Brittle Cargo", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "rubber"],
    payloads: [{ material: "glass", x: 10, y: 5.5 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 7, y: 2.6, w: 6, h: 0.4 }],
    par: { spawns: 1, timeTicks: 500 }, intro: "Glass shatters above impact speed 6. Cushion the fall.",
    mechanicsIntroduced: ["material-glass"],
  }),
  J(6, "Two Moves", {
    difficulty: 2, spawnBudget: 2, allowedMaterials: ["wood", "steel"],
    payloads: [{ material: "wood", x: 7, y: 8 }],
    targets: [{ x: 12, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 9, y: 4.2, w: 4, h: 0.4 }],
    par: { spawns: 2, timeTicks: 500 }, intro: "Exactly two spawns. Plan them.",
    mechanicsIntroduced: ["budget-planning"],
  }),
  J(7, "High Shelf", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "steel", "rubber"],
    payloads: [{ material: "wood", x: 14, y: 10 }],
    targets: [{ x: 6, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 11, y: 6, w: 3, h: 0.4 }, { x: 6.5, y: 3, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 600 }, intro: "Ramps chain the payload across the chamber.",
    mechanicsIntroduced: ["ramp-chains"],
  }),
  J(8, "Mastery: The Crucible", {
    difficulty: 3, spawnBudget: 4, allowedMaterials: ["wood", "steel", "rubber"],
    payloads: [{ material: "glass", x: 5, y: 9 }],
    targets: [{ x: 15, y: 1.4, r: 1.4 }],
    obstacles: [{ x: 6.5, y: 5.5, w: 3, h: 0.4 }, { x: 11, y: 3, w: 3.5, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "Everything so far, one fragile payload.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
  // --- 9-15: joints -------------------------------------------------------
  J(9, "First Pin", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"],
    payloads: [{ material: "wood", x: 8, y: 8 }],
    targets: [{ x: 12, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 9.5, y: 4.4, w: 3, h: 0.4 }],
    par: { spawns: 1, timeTicks: 500 }, intro: "Pin a counterweight to the payload.",
    mechanicsIntroduced: ["joint-pin"],
  }),
  J(10, "First Spring", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "rubber"], allowedJoints: ["spring"],
    payloads: [{ material: "wood", x: 8, y: 8 }],
    targets: [{ x: 12, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 9.5, y: 4.4, w: 3, h: 0.4 }],
    par: { spawns: 1, timeTicks: 500 }, intro: "A spring tugs without a rigid lock.",
    mechanicsIntroduced: ["joint-spring"],
  }),
  J(11, "Anchor Line", {
    difficulty: 2, spawnBudget: 5, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"],
    payloads: [{ material: "rubber", x: 13, y: 9 }],
    targets: [{ x: 7, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 10, y: 5, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 600 }, intro: "Steel anchors steer bouncy cargo.",
    mechanicsIntroduced: ["counterweights"],
  }),
  J(12, "Twin Links", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    payloads: [{ material: "wood", x: 6, y: 9 }],
    targets: [{ x: 14, y: 1.4, r: 1.4 }],
    obstacles: [{ x: 8, y: 5.6, w: 3, h: 0.4 }, { x: 12, y: 3, w: 2.6, h: 0.4 }],
    par: { spawns: 2, timeTicks: 600 }, intro: "Two pins shape a falling train.",
    mechanicsIntroduced: ["multi-joint"],
  }),
  J(13, "Elastic Catch", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "rubber"], allowedJoints: ["spring"],
    payloads: [{ material: "glass", x: 10, y: 9 }],
    targets: [{ x: 10, y: 1.5, r: 1.5 }],
    obstacles: [{ x: 7.5, y: 3.2, w: 5, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "Springs soften what glass cannot take.",
    mechanicsIntroduced: ["spring-damping"],
  }),
  J(14, "Mixed Rigging", {
    difficulty: 3, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: 15, y: 9 }],
    targets: [{ x: 5, y: 1.4, r: 1.4 }],
    obstacles: [{ x: 11.5, y: 5.4, w: 3, h: 0.4 }, { x: 7, y: 2.8, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 700 }, intro: "Pins and springs in one rig.",
    mechanicsIntroduced: ["mixed-joints"],
  }),
  J(15, "Swing Set", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"],
    payloads: [{ material: "wood", x: 9, y: 10 }],
    targets: [{ x: 13, y: 1.4, r: 1.4 }],
    obstacles: [{ x: 11, y: 5, w: 2.6, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "A pinned pendulum carries momentum sideways.",
    mechanicsIntroduced: ["pendulums"],
  }),
  J(16, "Mastery: Rigging Exam", {
    difficulty: 3, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "glass", x: 14, y: 9.5 }],
    targets: [{ x: 5, y: 1.4, r: 1.3 }],
    obstacles: [{ x: 10.5, y: 6, w: 3, h: 0.4 }, { x: 6.5, y: 3.2, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 }, intro: "Fragile cargo, long traverse, full toolkit.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
  // --- 17-23: hazards -----------------------------------------------------
  J(17, "Hot Floor", {
    difficulty: 2, spawnBudget: 4, allowedMaterials: ["wood", "steel"],
    payloads: [{ material: "wood", x: 10, y: 8 }],
    targets: [{ x: 10, y: 1.4, r: 1.3 }],
    hazards: [{ x: 2, y: 0, w: 4, h: 1 }],
    par: { spawns: 1, timeTicks: 500 }, intro: "The left strip melts anything that lands in it.",
    mechanicsIntroduced: ["hazards"],
  }),
  J(18, "Narrow Slot", {
    difficulty: 3, spawnBudget: 4, allowedMaterials: ["wood", "steel", "rubber"],
    payloads: [{ material: "wood", x: 8, y: 9 }],
    targets: [{ x: 11, y: 1.4, r: 1.2 }],
    hazards: [{ x: 4, y: 0, w: 5, h: 0.8 }, { x: 13, y: 0, w: 5, h: 0.8 }],
    obstacles: [{ x: 9.5, y: 4.6, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 600 }, intro: "One safe landing lane between the burn lines.",
    mechanicsIntroduced: ["hazard-gaps"],
  }),
  J(19, "Over the Fire", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"],
    payloads: [{ material: "rubber", x: 5, y: 9 }],
    targets: [{ x: 15, y: 1.4, r: 1.3 }],
    hazards: [{ x: 8, y: 0, w: 5, h: 1 }],
    obstacles: [{ x: 7, y: 5.4, w: 3, h: 0.4 }, { x: 11.5, y: 3, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "Arc the payload across the hazard.",
    mechanicsIntroduced: ["hazard-traversal"],
  }),
  J(20, "Glass Over Coals", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "rubber"], allowedJoints: ["spring"],
    payloads: [{ material: "glass", x: 10, y: 8.5 }],
    targets: [{ x: 10, y: 1.6, r: 1.2 }],
    hazards: [{ x: 1, y: 0, w: 6, h: 1 }, { x: 13, y: 0, w: 6, h: 1 }],
    obstacles: [{ x: 8, y: 3.4, w: 4, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "Fragile cargo above a burning floor.",
    mechanicsIntroduced: ["fragile-hazards"],
  }),
  J(21, "Side Burn", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    payloads: [{ material: "wood", x: 6, y: 9 }],
    targets: [{ x: 14, y: 1.4, r: 1.3 }],
    hazards: [{ x: 9, y: 2.4, w: 3, h: 1.2 }],
    obstacles: [{ x: 8, y: 5.4, w: 3, h: 0.4 }, { x: 12, y: 3, w: 2.6, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "A floating burn strip blocks the direct line.",
    mechanicsIntroduced: ["floating-hazards"],
  }),
  J(22, "Double Jeopardy", {
    difficulty: 4, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: 15, y: 9.5 }],
    targets: [{ x: 5, y: 1.4, r: 1.3 }],
    hazards: [{ x: 6.5, y: 0, w: 3, h: 0.8 }, { x: 12, y: 4, w: 3, h: 1 }],
    obstacles: [{ x: 11, y: 6.2, w: 3, h: 0.4 }, { x: 6.5, y: 3.4, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 }, intro: "Two hazard zones, one long descent.",
    mechanicsIntroduced: ["multi-hazard"],
  }),
  J(23, "The Gauntlet", {
    difficulty: 4, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "glass", x: 4, y: 9.5 }],
    targets: [{ x: 16, y: 1.4, r: 1.2 }],
    hazards: [{ x: 6, y: 0, w: 3, h: 0.8 }, { x: 11, y: 0, w: 3, h: 0.8 }, { x: 8, y: 4.6, w: 3, h: 1 }],
    obstacles: [{ x: 6, y: 6, w: 2.6, h: 0.4 }, { x: 12, y: 3.2, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 900 }, intro: "Thread fragile cargo through three burn zones.",
    mechanicsIntroduced: ["gauntlet"],
  }),
  J(24, "Mastery: Furnace Walk", {
    difficulty: 4, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "glass", x: 16, y: 9.5 }],
    targets: [{ x: 4, y: 1.4, r: 1.2 }],
    hazards: [{ x: 5, y: 0, w: 4, h: 0.8 }, { x: 12, y: 2.4, w: 3, h: 1 }, { x: 8, y: 5.6, w: 3, h: 1 }],
    obstacles: [{ x: 13, y: 6.6, w: 3, h: 0.4 }, { x: 8.5, y: 3.8, w: 2.6, h: 0.4 }],
    par: { spawns: 3, timeTicks: 1000 }, intro: "Everything you know, under fire.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
  // --- 25-31: multi-payload ----------------------------------------------
  J(25, "Two Crates", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel"],
    payloads: [{ material: "wood", x: 8, y: 8 }, { material: "wood", x: 12, y: 8 }],
    targets: [{ x: 8, y: 1.3, r: 1.3 }, { x: 12, y: 1.3, r: 1.3 }],
    par: { spawns: 1, timeTicks: 600 }, intro: "Both payloads must reach a zone.",
    mechanicsIntroduced: ["multi-payload"],
  }),
  J(26, "Cross Traffic", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"],
    payloads: [{ material: "wood", x: 6, y: 9 }, { material: "wood", x: 14, y: 9 }],
    targets: [{ x: 13, y: 1.3, r: 1.3 }, { x: 7, y: 1.3, r: 1.3 }],
    obstacles: [{ x: 9, y: 5, w: 2.4, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "The payloads swap sides.",
    mechanicsIntroduced: ["crossing-paths"],
  }),
  J(27, "Shared Zone", {
    difficulty: 3, spawnBudget: 5, allowedMaterials: ["wood", "steel"],
    payloads: [{ material: "wood", x: 7, y: 8.5 }, { material: "rubber", x: 13, y: 8.5 }],
    targets: [{ x: 10, y: 1.8, r: 1.8 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "One wide zone accepts both.",
    mechanicsIntroduced: ["shared-target"],
  }),
  J(28, "Escort Duty", {
    difficulty: 4, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    payloads: [{ material: "glass", x: 9, y: 9 }, { material: "wood", x: 11, y: 9 }],
    targets: [{ x: 14, y: 1.5, r: 1.5 }],
    hazards: [{ x: 4, y: 0, w: 5, h: 0.8 }],
    obstacles: [{ x: 10.5, y: 5, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 }, intro: "A fragile and a sturdy payload, one destination.",
    mechanicsIntroduced: ["escort"],
  }),
  J(29, "Three Deep", {
    difficulty: 4, spawnBudget: 7, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: 6, y: 9 }, { material: "wood", x: 10, y: 9.5 }, { material: "rubber", x: 14, y: 9 }],
    targets: [{ x: 6, y: 1.3, r: 1.2 }, { x: 10, y: 1.3, r: 1.2 }, { x: 14, y: 1.3, r: 1.2 }],
    par: { spawns: 3, timeTicks: 900 }, intro: "Three payloads, three zones.",
    mechanicsIntroduced: ["triple-payload"],
  }),
  J(30, "Chain Delivery", {
    difficulty: 4, spawnBudget: 7, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: 15, y: 9.5 }, { material: "wood", x: 16.5, y: 9.5 }],
    targets: [{ x: 5, y: 1.5, r: 1.5 }],
    hazards: [{ x: 9, y: 0, w: 4, h: 0.8 }],
    obstacles: [{ x: 12, y: 6, w: 3, h: 0.4 }, { x: 7.5, y: 3.4, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 1000 }, intro: "Linked cargo over the burn line.",
    mechanicsIntroduced: ["linked-payloads"],
  }),
  J(31, "Split Decision", {
    difficulty: 4, spawnBudget: 7, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "glass", x: 5, y: 9.5 }, { material: "wood", x: 15, y: 9.5 }],
    targets: [{ x: 4, y: 1.3, r: 1.2 }, { x: 16, y: 1.3, r: 1.2 }],
    hazards: [{ x: 8, y: 0, w: 4, h: 0.8 }],
    obstacles: [{ x: 8.5, y: 4.6, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 1000 }, intro: "Opposite corners, opposite materials.",
    mechanicsIntroduced: ["split-routes"],
  }),
  J(32, "Mastery: Freight Master", {
    difficulty: 4, spawnBudget: 8, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    payloads: [{ material: "glass", x: 4, y: 9.5 }, { material: "wood", x: 10, y: 10 }, { material: "rubber", x: 16, y: 9.5 }],
    targets: [{ x: 5, y: 1.3, r: 1.2 }, { x: 10, y: 1.3, r: 1.2 }, { x: 15, y: 1.3, r: 1.2 }],
    hazards: [{ x: 7, y: 0, w: 2.5, h: 0.8 }, { x: 12.5, y: 0, w: 2.5, h: 0.8 }],
    obstacles: [{ x: 9, y: 5, w: 2.4, h: 0.4 }],
    par: { spawns: 4, timeTicks: 1200 }, intro: "Three payloads, two burn strips, full rig.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
  // --- 33-39: time pressure ----------------------------------------------
  J(33, "Short Fuse", {
    difficulty: 3, spawnBudget: 4, allowedMaterials: ["wood", "steel"],
    timeLimitTicks: 60 * 12,
    payloads: [{ material: "wood", x: 10, y: 9 }],
    targets: [{ x: 10, y: 1.4, r: 1.4 }],
    par: { spawns: 1, timeTicks: 300 }, intro: "The run clock is tight now.",
    mechanicsIntroduced: ["time-pressure"],
  }),
  J(34, "Quick Rig", {
    difficulty: 3, spawnBudget: 4, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    timeLimitTicks: 60 * 14,
    payloads: [{ material: "wood", x: 7, y: 9 }],
    targets: [{ x: 13, y: 1.3, r: 1.3 }],
    obstacles: [{ x: 9.5, y: 4.6, w: 3.4, h: 0.4 }],
    par: { spawns: 2, timeTicks: 400 }, intro: "Rig fast, run faster.",
    mechanicsIntroduced: ["fast-builds"],
  }),
  J(35, "Burning Clock", {
    difficulty: 4, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    timeLimitTicks: 60 * 15,
    payloads: [{ material: "rubber", x: 5, y: 9.5 }],
    targets: [{ x: 15, y: 1.3, r: 1.3 }],
    hazards: [{ x: 8, y: 0, w: 4, h: 0.8 }],
    obstacles: [{ x: 7, y: 5.4, w: 3, h: 0.4 }, { x: 11.5, y: 3, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 500 }, intro: "Hazards and a short clock.",
    mechanicsIntroduced: ["hazard-clock"],
  }),
  J(36, "Twin Sprint", {
    difficulty: 4, spawnBudget: 5, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin", "spring"],
    timeLimitTicks: 60 * 16,
    payloads: [{ material: "wood", x: 8, y: 9 }, { material: "wood", x: 12, y: 9 }],
    targets: [{ x: 8, y: 1.3, r: 1.2 }, { x: 12, y: 1.3, r: 1.2 }],
    par: { spawns: 2, timeTicks: 500 }, intro: "Two payloads before the clock dies.",
    mechanicsIntroduced: ["multi-clock"],
  }),
  J(37, "Precision Window", {
    difficulty: 4, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["spring"],
    timeLimitTicks: 60 * 14,
    payloads: [{ material: "glass", x: 10, y: 8.5 }],
    targets: [{ x: 10, y: 1.4, r: 1.1 }],
    hazards: [{ x: 2, y: 0, w: 5, h: 0.8 }, { x: 13, y: 0, w: 5, h: 0.8 }],
    obstacles: [{ x: 8.5, y: 3.4, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 500 }, intro: "A small zone, a soft landing, little time.",
    mechanicsIntroduced: ["precision-clock"],
  }),
  J(38, "Assembly Line", {
    difficulty: 5, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    timeLimitTicks: 60 * 18,
    payloads: [{ material: "wood", x: 4, y: 9.5 }, { material: "wood", x: 16, y: 9.5 }],
    targets: [{ x: 10, y: 1.6, r: 1.6 }],
    hazards: [{ x: 6, y: 0, w: 2.5, h: 0.8 }, { x: 11.5, y: 0, w: 2.5, h: 0.8 }],
    obstacles: [{ x: 8.5, y: 4.6, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 700 }, intro: "Converge both lines on one zone, quickly.",
    mechanicsIntroduced: ["convergent-clock"],
  }),
  J(39, "Final Approach", {
    difficulty: 5, spawnBudget: 6, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    timeLimitTicks: 60 * 16,
    payloads: [{ material: "glass", x: 15, y: 9.5 }],
    targets: [{ x: 5, y: 1.3, r: 1.2 }],
    hazards: [{ x: 7, y: 0, w: 4, h: 0.8 }, { x: 11, y: 4.4, w: 3, h: 1 }],
    obstacles: [{ x: 12, y: 6.4, w: 3, h: 0.4 }, { x: 7, y: 3.4, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 700 }, intro: "The hardest traverse, on a clock.",
    mechanicsIntroduced: ["advanced-traverse"],
  }),
  J(40, "Mastery: Shift Supervisor", {
    difficulty: 5, spawnBudget: 7, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    timeLimitTicks: 60 * 20,
    payloads: [{ material: "glass", x: 4, y: 9.5 }, { material: "wood", x: 16, y: 9.5 }],
    targets: [{ x: 6, y: 1.3, r: 1.2 }, { x: 14, y: 1.3, r: 1.2 }],
    hazards: [{ x: 8.5, y: 0, w: 3, h: 0.8 }, { x: 10, y: 4.8, w: 3, h: 1 }],
    obstacles: [{ x: 6, y: 6, w: 2.6, h: 0.4 }, { x: 12.5, y: 3, w: 3, h: 0.4 }],
    par: { spawns: 4, timeTicks: 900 }, intro: "Two cargoes, two clocks' worth of trouble.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
  // --- 41-44: restricted materials ---------------------------------------
  J(41, "Wood Only", {
    difficulty: 4, spawnBudget: 5, allowedMaterials: ["wood"], allowedJoints: ["pin"],
    payloads: [{ material: "wood", x: 14, y: 9 }],
    targets: [{ x: 6, y: 1.3, r: 1.3 }],
    hazards: [{ x: 8.5, y: 0, w: 3, h: 0.8 }],
    obstacles: [{ x: 11, y: 5.4, w: 3, h: 0.4 }, { x: 6.5, y: 3, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 }, intro: "No steel, no rubber. Wood and pins.",
    mechanicsIntroduced: ["restricted-materials"],
  }),
  J(42, "Rubber Riot", {
    difficulty: 4, spawnBudget: 5, allowedMaterials: ["rubber"], allowedJoints: ["spring"],
    payloads: [{ material: "wood", x: 6, y: 9 }],
    targets: [{ x: 14, y: 1.3, r: 1.3 }],
    obstacles: [{ x: 8, y: 5, w: 2.6, h: 0.4 }, { x: 12, y: 2.8, w: 2.6, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 }, intro: "Everything bounces. Control it anyway.",
    mechanicsIntroduced: ["single-material"],
  }),
  J(43, "Skeleton Crew", {
    difficulty: 5, spawnBudget: 2, allowedMaterials: ["steel"], allowedJoints: ["pin"],
    timeLimitTicks: 60 * 18,
    payloads: [{ material: "wood", x: 8, y: 9.5 }],
    targets: [{ x: 13, y: 1.3, r: 1.3 }],
    hazards: [{ x: 10, y: 0, w: 2, h: 0.8 }],
    obstacles: [{ x: 10, y: 5, w: 3, h: 0.4 }],
    par: { spawns: 2, timeTicks: 700 }, intro: "Two steel balls. Nothing else.",
    mechanicsIntroduced: ["minimal-budget"],
  }),
  J(44, "Mastery: Foundry Master", {
    difficulty: 5, spawnBudget: 6, allowedMaterials: ["wood", "steel"], allowedJoints: ["pin"],
    timeLimitTicks: 60 * 20,
    payloads: [{ material: "glass", x: 10, y: 10 }, { material: "wood", x: 15, y: 9.5 }],
    targets: [{ x: 4, y: 1.3, r: 1.2 }, { x: 16, y: 1.3, r: 1.2 }],
    hazards: [{ x: 7, y: 0, w: 3, h: 0.8 }, { x: 12, y: 0, w: 3, h: 0.8 }, { x: 9, y: 5, w: 3, h: 1 }],
    obstacles: [{ x: 12.5, y: 6.4, w: 3, h: 0.4 }, { x: 6, y: 3.4, w: 3, h: 0.4 }],
    par: { spawns: 4, timeTicks: 1000 }, intro: "The final exam of the foundry.",
    mechanicsIntroduced: [], tutorialFlags: { mastery: true },
  }),
]);

// ---------------------------------------------------------------- challenge

export const CHALLENGE_LEVELS = Object.freeze([
  mk({
    id: "challenge-1", name: "One Ball Only", mode: "challenge", seed: 7001, theme: "ember-line",
    difficulty: 4, spawnBudget: 1, allowedMaterials: ["steel"], allowedJoints: [],
    timeLimitTicks: 60 * 20,
    payloads: [{ material: "wood", x: 8, y: 9 }],
    targets: [{ x: 12, y: 1.3, r: 1.3 }],
    obstacles: [{ x: 9.5, y: 4.6, w: 3, h: 0.4 }],
    par: { spawns: 1, timeTicks: 500 },
    intro: "One steel ball. Make it count.",
    mechanicsIntroduced: ["challenge-spawn-limit"],
  }),
  mk({
    id: "challenge-2", name: "Speedrun Bay", mode: "challenge", seed: 7002, theme: "frost-bay",
    difficulty: 4, spawnBudget: 4, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin"],
    timeLimitTicks: 60 * 8,
    payloads: [{ material: "rubber", x: 10, y: 9.5 }],
    targets: [{ x: 10, y: 1.4, r: 1.4 }],
    par: { spawns: 1, timeTicks: 240 },
    intro: "Eight seconds of simulation. No more.",
    mechanicsIntroduced: ["challenge-time-target"],
  }),
  mk({
    id: "challenge-3", name: "No Rigging", mode: "challenge", seed: 7003, theme: "verdant-annex",
    difficulty: 5, spawnBudget: 4, allowedMaterials: ["wood", "rubber"], allowedJoints: [],
    payloads: [{ material: "glass", x: 5, y: 9.5 }, { material: "wood", x: 15, y: 9.5 }],
    targets: [{ x: 5, y: 1.3, r: 1.2 }, { x: 15, y: 1.3, r: 1.2 }],
    hazards: [{ x: 8, y: 0, w: 4, h: 0.8 }],
    obstacles: [{ x: 8.5, y: 4.6, w: 3, h: 0.4 }],
    par: { spawns: 3, timeTicks: 800 },
    intro: "Joints are forbidden in this chamber.",
    mechanicsIntroduced: ["challenge-no-joints"],
  }),
  mk({
    id: "challenge-4", name: "Heavy Water", mode: "challenge", seed: 7004, theme: "dusk-terminal",
    difficulty: 5, spawnBudget: 5, allowedMaterials: ["wood", "steel", "rubber"], allowedJoints: ["pin", "spring"],
    gravity: -16, timeLimitTicks: 60 * 18,
    payloads: [{ material: "wood", x: 6, y: 9.5 }, { material: "glass", x: 14, y: 9.5 }],
    targets: [{ x: 6, y: 1.3, r: 1.3 }, { x: 14, y: 1.3, r: 1.3 }],
    hazards: [{ x: 9, y: 0, w: 2.5, h: 0.8 }],
    par: { spawns: 3, timeTicks: 700 },
    intro: "Gravity runs hot here: 16 u/s².",
    mechanicsIntroduced: ["challenge-gravity"],
  }),
]);

// ---------------------------------------------------------------- daily

export function dailyLevel(utcDateString) {
  const seed = dailySeed(utcDateString);
  const rng = makeRng(seed);
  const theme = THEME_KEYS[seed % THEME_KEYS.length];
  const px = 6 + Math.floor(rng.next() * 9);            // 6..14
  const tx = Math.max(2, Math.min(W - 2, px + rng.int(-3, 4))); // near payload
  const rampCount = rng.int(1, 3);
  const obstacles = [];
  for (let i = 0; i < rampCount; i++) {
    const ox = 3 + rng.next() * 12;
    const oy = 2.5 + i * 2.2 + rng.next();
    obstacles.push({ x: Math.round(ox * 2) / 2, y: Math.round(oy * 2) / 2, w: 2.4 + rng.next(), h: 0.4 });
  }
  const hazards = [];
  if (rng.next() < 0.6) {
    const hx = 2 + rng.next() * 12;
    hazards.push({ x: Math.round(hx * 2) / 2, y: 0, w: 2.5 + rng.next() * 1.5, h: 0.8 });
  }
  const materials = [["wood", "steel", "rubber"], ["wood", "steel"], ["wood", "rubber"], ["wood", "steel", "rubber"]][rng.int(0, 4)];
  return mk({
    id: "daily-" + utcDateString,
    name: "Daily Cast " + utcDateString,
    mode: "challenge",
    seed,
    theme,
    difficulty: 3,
    timeLimitTicks: 60 * 30,
    spawnBudget: 5,
    allowedMaterials: materials,
    allowedJoints: ["pin", "spring"],
    payloads: [{ material: "wood", x: px, y: 9 }],
    targets: [{ x: tx, y: 1.4, r: 1.4 }],
    obstacles,
    hazards,
    par: { spawns: 2, timeTicks: 700 },
    intro: "One shared chamber for everyone, today only.",
    mechanicsIntroduced: ["daily"],
  });
}

// ---------------------------------------------------------------- lookup

export function getLevel(id) {
  for (const l of LEARN_LESSONS) if (l.id === id) return l;
  for (const l of JOURNEY_LEVELS) if (l.id === id) return l;
  for (const l of CHALLENGE_LEVELS) if (l.id === id) return l;
  return null;
}

// ---------------------------------------------------------------- achievements

export const ACHIEVEMENTS = Object.freeze({
  "first-completion": { key: "first-completion", name: "First Completion", description: "Complete any session with every payload delivered." },
  "mechanic-mastery": { key: "mechanic-mastery", name: "Mechanic Mastery", description: "Complete every Learn mode lesson." },
  "streak-3": { key: "streak-3", name: "Hot Streak", description: "Win three sessions in a row." },
  "mastery-milestone": { key: "mastery-milestone", name: "Mastery Milestone", description: "Complete every Journey mastery stage." },
  "marathon-builder": { key: "marathon-builder", name: "Marathon Builder", description: "Spawn 500 bodies over your lifetime." },
});

// ---------------------------------------------------------------- validators

const fin = (v) => typeof v === "number" && Number.isFinite(v);

function rectInside(r) {
  return fin(r.x) && fin(r.y) && fin(r.w) && fin(r.h)
    && r.w > 0 && r.h > 0
    && r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
}

function pointInRect(px, py, r) {
  return px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
}

// Conservative reachability: for each payload, some target whose straight-line
// path is not blocked by an obstacle that spans the full chamber.
function reachable(level, errors) {
  const spans = (level.obstacles || []).filter((o) => o.w >= W || o.h >= H);
  for (const p of level.payloads || []) {
    const ok = (level.targets || []).some((t) => {
      for (const o of spans) {
        // sample the segment; blocked only if the segment crosses the full-span rect
        let crosses = false;
        for (let k = 0; k <= 20; k++) {
          const x = p.x + (t.x - p.x) * (k / 20);
          const y = p.y + (t.y - p.y) * (k / 20);
          if (pointInRect(x, y, o)) { crosses = true; break; }
        }
        if (crosses) return false;
      }
      return true;
    });
    if (!ok) errors.push("payload-unreachable:" + JSON.stringify(p));
  }
}

export function validateLevel(level) {
  const errors = [];
  if (!level || typeof level !== "object") return { ok: false, errors: ["not-an-object"] };
  if (typeof level.id !== "string" || !level.id) errors.push("missing-id");
  if (!fin(level.version)) errors.push("missing-version");
  if (typeof level.name !== "string" || !level.name) errors.push("missing-name");
  if (!["journey", "challenge", "learn"].includes(level.mode)) errors.push("bad-mode");
  if (!fin(level.seed)) errors.push("bad-seed");
  if (!THEMES[level.theme]) errors.push("bad-theme");
  if (!fin(level.difficulty) || level.difficulty < 1 || level.difficulty > 5) errors.push("bad-difficulty");
  if (!fin(level.timeLimitTicks) || level.timeLimitTicks <= 0 || level.timeLimitTicks > MAX_TIME_TICKS)
    errors.push("bad-time-limit");
  if (!fin(level.spawnBudget) || level.spawnBudget < 1) errors.push("bad-spawn-budget");
  if (!Array.isArray(level.allowedMaterials) || level.allowedMaterials.length === 0)
    errors.push("empty-allowed-materials");
  else for (const m of level.allowedMaterials) if (!MATERIALS[m]) errors.push("unknown-material:" + m);
  if (!Array.isArray(level.allowedJoints)) errors.push("bad-allowed-joints");
  else for (const j of level.allowedJoints) if (!JOINT_TYPES[j]) errors.push("unknown-joint:" + j);
  if (level.gravity !== undefined && !fin(level.gravity)) errors.push("bad-gravity");

  if (!Array.isArray(level.payloads) || level.payloads.length < 1) errors.push("need-payload");
  else for (const p of level.payloads) {
    if (!MATERIALS[p.material]) errors.push("payload-unknown-material:" + p.material);
    if (!fin(p.x) || !fin(p.y) || p.x < 0.5 || p.x > W - 0.5 || p.y < 0.5 || p.y > H - 0.5)
      errors.push("payload-out-of-bounds:" + JSON.stringify(p));
    for (const h of level.hazards || []) {
      if (pointInRect(p.x, p.y, h)) errors.push("payload-in-hazard:" + JSON.stringify(p));
    }
  }

  if (!Array.isArray(level.targets) || level.targets.length < 1) errors.push("need-target");
  else for (const t of level.targets) {
    if (!fin(t.x) || !fin(t.y) || !fin(t.r) || t.r <= 0) errors.push("bad-target:" + JSON.stringify(t));
    else if (t.x - t.r < 0 || t.x + t.r > W || t.y - t.r < 0 || t.y + t.r > H)
      errors.push("target-out-of-bounds:" + JSON.stringify(t));
  }

  for (const o of level.obstacles || []) if (!rectInside(o)) errors.push("obstacle-out-of-bounds:" + JSON.stringify(o));
  for (const h of level.hazards || []) if (!rectInside(h)) errors.push("hazard-out-of-bounds:" + JSON.stringify(h));

  if (!level.par || !fin(level.par.spawns) || !fin(level.par.timeTicks)) errors.push("bad-par");
  if (!Array.isArray(level.mechanicsIntroduced)) errors.push("bad-mechanics");

  if (Array.isArray(level.payloads) && level.payloads.length >= 1
      && Array.isArray(level.targets) && level.targets.length >= 1) {
    reachable(level, errors);
  }

  // Learn lessons: steps must reference real command types.
  for (const s of level.steps || []) {
    if (!s || typeof s.text !== "string" || !s.requireCommand || typeof s.requireCommand.type !== "string")
      errors.push("bad-step");
    else if (!["spawn", "joint", "delete", "run", "reset"].includes(s.requireCommand.type))
      errors.push("bad-step-command:" + s.requireCommand.type);
  }

  return { ok: errors.length === 0, errors };
}

export function validateAll() {
  const errors = {};
  for (const level of [...LEARN_LESSONS, ...JOURNEY_LEVELS, ...CHALLENGE_LEVELS]) {
    const r = validateLevel(level);
    if (!r.ok) errors[level.id] = r.errors;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
