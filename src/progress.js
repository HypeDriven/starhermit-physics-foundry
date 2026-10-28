// Physics Foundry — the save document, its merge, the run bookkeeping
// (progression, stars, streak, bests, dailies, achievements) and the game's
// own options. Pure (no storage, no platform): the engine client
// (native/platform.ts, native/main.ts) and the node tests share it. Moved
// here from the browser build's src/platform.js (mergeProgress) and src/ui.js
// (onTerminal, unlockAchievement, the lesson and spawn counters), unchanged in
// what they decide.
//
// The engine save is { v, progress }: progress is the document the browser
// build kept in localStorage (pf-progress-v1) and mirrored, with its settings,
// to the cloud slot game:<slug> as { settings, progress }. readForeign() reads
// that cloud text; its settings carry the game's own options over.

import { ACHIEVEMENTS, JOURNEY_LEVELS, LEARN_LESSONS } from "./content.js";

export const SAVE_VERSION = 1;

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** bootstrap.js defaultProgress (the player id is made lazily by normalize when missing). */
export function emptyProgress() {
  return {
    version: 1,
    playerId: "",
    completed: {}, stars: {}, lessonsDone: {}, achievements: [],
    counters: { spawns: 0, wins: 0, streak: 0 },
    bests: {}, dailyAttempts: {},
    lastMode: "journey",
  };
}

let idSeq = 0;
function newPlayerId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  idSeq += 1;
  return "anon-" + idSeq.toString(36);
}

/** A progress document from anything (missing fields from the empty one). */
export function normalizeProgress(raw) {
  const p = obj(raw) ? clone(raw) : {};
  const out = { ...emptyProgress(), ...p };
  for (const k of ["completed", "stars", "lessonsDone", "bests", "dailyAttempts"]) out[k] = obj(out[k]) || {};
  out.achievements = Array.isArray(out.achievements) ? out.achievements.filter((a) => typeof a === "string") : [];
  const c = obj(out.counters) || {};
  out.counters = { ...c, spawns: num(c.spawns), wins: num(c.wins), streak: num(c.streak) };
  if (typeof out.lastMode !== "string") out.lastMode = "journey";
  if (typeof out.playerId !== "string") out.playerId = "";
  return out;
}

export function defaultSave() {
  const progress = normalizeProgress(null);
  progress.playerId = newPlayerId();
  return { v: SAVE_VERSION, progress };
}

/** A save document from anything. */
export function normalize(raw) {
  const d = obj(raw) || {};
  return { v: SAVE_VERSION, progress: normalizeProgress(d.progress) };
}

/** platform.js mergeProgress: merge two progress documents without dropping either side's progress. */
export function mergeProgress(remote, local) {
  const r = remote && typeof remote === "object" ? remote : {};
  const l = local && typeof local === "object" ? local : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const union = (a, b) => ({ ...o(a), ...Object.fromEntries(Object.entries(o(b)).filter(([, v]) => v)) });
  const bests = { ...o(r.bests) };
  for (const [k, v] of Object.entries(o(l.bests))) bests[k] = Math.max(num(bests[k]), num(v));
  const daily = { ...o(r.dailyAttempts) };
  for (const [k, v] of Object.entries(o(l.dailyAttempts))) {
    daily[k] = !daily[k] || num(o(v).score) > num(o(daily[k]).score) ? v : daily[k];
  }
  const rc = o(r.counters), lc = o(l.counters);
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

/** Merge two saves (another device saved since, or the old cloud slot); this device's streak and last mode win. */
export function mergeSave(remote, local) {
  const a = normalize(remote), b = normalize(local);
  return { v: SAVE_VERSION, progress: normalizeProgress(mergeProgress(a.progress, b.progress)) };
}

export function sameSave(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * The browser build's cloud slot text ({ settings, progress } through the JS SDK's saveJSON):
 * { save, options } (options: the game's own options among its settings), or null.
 */
export function readForeign(text) {
  if (typeof text !== "string" || !text) return null;
  try {
    const d = JSON.parse(text);
    if (!obj(d)) return null;
    if (obj(d.progress)) return { save: normalize({ progress: d.progress }), options: pickOptions(d.settings) };
    if ("completed" in d || "achievements" in d || "counters" in d) return { save: normalize({ progress: d }), options: {} };
    return null;
  } catch { return null; }
}

// --- the run bookkeeping (ui.js onTerminal / unlockAchievement / checkLessonProgress) ---------------

function unlock(p, key, newly) {
  if (p.achievements.includes(key)) return;
  p.achievements.push(key);
  newly.push(key);
}

/** A spawn command landed: the lifetime counter (Marathon Builder at 500). Newly unlocked keys. */
export function recordSpawn(p) {
  const newly = [];
  p.counters.spawns += 1;
  if (p.counters.spawns >= 500) unlock(p, "marathon-builder", newly);
  return newly;
}

/** A lesson's steps were all done: lessonsDone (Mechanic Mastery once all six are). { first, newly }. */
export function recordLesson(p, lessonId) {
  const newly = [];
  if (p.lessonsDone[lessonId]) return { first: false, newly };
  p.lessonsDone[lessonId] = true;
  if (LEARN_LESSONS.every((l) => p.lessonsDone[l.id])) unlock(p, "mechanic-mastery", newly);
  return { first: true, newly };
}

/**
 * A finished run (ui.js onTerminal): completion, stars at par, streak, wins, the daily's attempt,
 * achievements and the per-chamber best. `run`: { levelId, won, total, movesUsed, elapsedTicks,
 * par: { spawns, timeTicks }, daily: date | null }. Returns { firstWin, prevBest, newBest, newly }.
 */
export function recordRun(p, run) {
  const newly = [];
  const firstWin = run.won && !p.completed[run.levelId];
  if (run.won) {
    p.completed[run.levelId] = true;
    if (run.movesUsed <= run.par.spawns && run.elapsedTicks <= run.par.timeTicks) p.stars[run.levelId] = true;
    p.counters.wins += 1;
    p.counters.streak += 1;
    if (run.daily) p.dailyAttempts[run.daily] = { score: run.total };
    unlock(p, "first-completion", newly);
    if (p.counters.streak >= 3) unlock(p, "streak-3", newly);
    const masteryDone = JOURNEY_LEVELS.filter((l) => l.tutorialFlags && l.tutorialFlags.mastery).every((l) => p.completed[l.id]);
    if (masteryDone) unlock(p, "mastery-milestone", newly);
  } else {
    p.counters.streak = 0;
    if (run.daily && !p.dailyAttempts[run.daily]) p.dailyAttempts[run.daily] = { score: run.total };
  }
  const prevBest = p.bests[run.levelId] || 0;
  const newBest = run.total > prevBest;
  if (newBest) p.bests[run.levelId] = run.total;
  return { firstWin, prevBest, newBest, newly };
}

export const ACHIEVEMENT_KEYS = Object.keys(ACHIEVEMENTS);

// --- the game's own options ---------------------------------------------------------------------
// The browser build's settings that stay the game's (engine `settings`, synced with the account):
// the left-handed tray, the camera default, the joint-mode behaviour and haptics. Volumes, mute,
// graphics, language, reduced motion, high contrast and larger text are the runtime's Options now;
// the console-only analytics consent is gone with the analytics.
export const DEFAULT_OPTIONS = { leftHanded: false, cameraDefault: "frame", jointMode: "toggle", haptics: false };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** The browser build's keys in the account's settings KV (ui.js syncSettings), removed once migrated. */
export const BROWSER_KEYS = ["music", "effects", "ambience", "voice", "muted", "graphics", "reducedMotion", "highContrast",
  "largeText", "leftHanded", "cameraDefault", "jointMode", "haptics", "consentAnalytics", "version"];

/** The valid option values among `raw`. */
export function pickOptions(raw) {
  const o = obj(raw) || {};
  const out = {};
  if (typeof o.leftHanded === "boolean") out.leftHanded = o.leftHanded;
  if (typeof o.haptics === "boolean") out.haptics = o.haptics;
  if (o.cameraDefault === "frame" || o.cameraDefault === "tight") out.cameraDefault = o.cameraDefault;
  if (o.jointMode === "toggle" || o.jointMode === "hold") out.jointMode = o.jointMode;
  return out;
}
