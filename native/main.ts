// Physics Foundry on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules.js: the deterministic
// fixed-step physics), content (src/content.js) and session (src/session.js:
// validated commands, undo, replay log) are the browser build's, unchanged;
// this module is what src/ui.js did around them — the screen flow (title →
// modes / progression / help / leaderboards → chamber ⇄ pause / settings →
// results), starting every mode (Learn, Journey, Daily, Practice, Challenge,
// Score chase), the session's events (sounds, sparks, announcements, lesson
// steps, achievements), the spawn cursor, materials, joints, delete, undo and
// run by keys, pads, pointer and touch, the results with personal bests and
// the high-score post, and the lifecycle (a hidden window pauses a running
// chamber, as visibilitychange did). Screens are drawn by screens.ts
// (starhermit:ui), the chamber by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: a running chamber advances exactly one
// rules tick (DT = 1/60 s) per fixed step (the browser build accumulated
// requestAnimationFrame time), and the toasts, the error line and the pause
// before the results run on the same clock, so slow frames never change a
// run and play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Progress, Rules, createGameSession, type Level, type Score, type Session, type SessionEvent } from "./game.ts";
import * as audio from "./audio.ts";
import { S, T, levelName, reasonText } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

const { w: CW, h: CH } = Rules.CHAMBER;
export type ScreenName = "title" | "modes" | "progression" | "help" | "scores" | "results";
export interface Ctx { practice?: boolean; lessonIndex?: number; daily?: string }
export interface Results {
  won: boolean; score: Score; prevBest: number; newBest: boolean; firstWin: boolean; reason: string | null;
  earned: string[]; lb: platform.Posted | "posting" | null; ranked: boolean;
}

export const app = {
  /** The full-page screen, or null on the chamber. */
  screen: "title" as ScreenName | null,
  /** The pause or settings panel (settings also opens over the title). */
  overlay: null as "pause" | "settings" | null,
  openedFrame: 0,
  /** Frame the full-page screen opened on (its scroll starts at the top for a few frames). */
  screenFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  level: null as Level | null,
  mode: "journey",
  ctx: {} as Ctx,
  cursor: { x: CW / 2, y: CH * 0.6 },
  /** The cursor shows after keys, pad or a pointer over the chamber (the old canvas always drew it). */
  material: "wood",
  joint: "pin",
  selectedBody: null as string | null,
  jointMode: false,
  jointAnchor: null as string | null,
  lessonStep: 0,
  /** The mode whose setup panel shows on the modes screen. */
  setup: null as string | null,
  practiceDifficulty: 0,
  results: null as Results | null,
  resultsAt: null as number | null,
  error: null as { text: string; until: number } | null,
  toasts: [] as { text: string; until: number; ok: boolean }[],
  helpReturn: "title" as "title" | "play" | "pause",
  helpPaused: false,
  /** Board views on the leaderboards screen. */
  boardsKey: 0,
  interp: 1,
};
let clockMs = 0;
const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
export const MATERIAL_KEYS = Object.keys(Rules.MATERIALS);

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
export function toast(text: string, ok = false): void {
  app.toasts.push({ text, until: now() + 4.5, ok });
  if (app.toasts.length > 4) app.toasts.shift();
}
function vibrateMs(ms: number): void { if (platform.options.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
function flashError(msg: string): void {
  app.error = { text: msg, until: now() + 3.5 };
  announce(msg, true);
  audio.play("ui-error");
  vibrateMs(40);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }

// ------------------------------------------------------------------ screens
export function openScreen(name: ScreenName | null): void {
  app.screen = name;
  app.openedFrame = app.screenFrame = frame().frame;
  ui.setFocus(null);
  render.setActive(name === null);
  if (name === "results") app.toasts = []; // run-end toasts are listed on the results screen itself
}
export function goTitle(): void { teardownPlay(); openScreen("title"); app.focusNext = "btn-play"; }
export function openModes(): void { app.setup = null; openScreen("modes"); }
export function openProgression(): void { openScreen("progression"); }
export function openScores(): void { app.boardsKey++; openScreen("scores"); }

/** Returning players reach the playfield in at most two actions: Play → last mode. */
export function quickPlay(): void {
  const lm = platform.save().progress.lastMode || "journey";
  if (lm === "learn") startLearn(nextLessonIndex());
  else if (lm === "daily") startDaily();
  else if (lm === "challenge" || lm === "practice") { openModes(); selectMode(lm); }
  else startJourney(nextJourneyIndex());
}
export function nextJourneyIndex(): number {
  const p = platform.save().progress;
  const i = Content.JOURNEY_LEVELS.findIndex((l) => !p.completed[l.id]);
  return i < 0 ? Content.JOURNEY_LEVELS.length - 1 : i;
}
function nextLessonIndex(): number {
  const p = platform.save().progress;
  const i = Content.LEARN_LESSONS.findIndex((l) => !p.lessonsDone[l.id]);
  return i < 0 ? Content.LEARN_LESSONS.length - 1 : i;
}
export function selectMode(id: string): void {
  if (id === "learn") startLearn(nextLessonIndex());
  else if (id === "journey") startJourney(nextJourneyIndex());
  else if (id === "daily") startDaily();
  else if (id === "score") openScores();
  else {
    // the setup panel opens below the cards (ui.js scrollIntoView): focusing its first control scrolls it in
    app.setup = id;
    app.openedFrame = frame().frame;
    app.focusNext = id === "practice" ? "practice-filter" : `challenge-${Content.CHALLENGE_LEVELS[0]!.id}`;
  }
}

// ------------------------------------------------------------------ start flows
export function startLearn(i: number): void { startLevel(Content.LEARN_LESSONS[i]!, "learn", { lessonIndex: i }); }
export function startJourney(i: number): void { startLevel(Content.JOURNEY_LEVELS[i]!, "journey", {}); }
export function today(): string { return new Date(platform.nowMs()).toISOString().slice(0, 10); }
export function startDaily(): void {
  const date = today();
  const level = Content.dailyLevel(date);
  if (platform.save().progress.dailyAttempts[date]) {
    toast(T("Daily already attempted today — playing unranked practice run"));
    startLevel(level, "daily", { daily: date, practice: true });
    return;
  }
  startLevel(level, "daily", { daily: date });
}
export function restartCurrent(): void {
  if (!app.level) { goTitle(); return; }
  // The daily allows one ranked attempt; any retry after it is scored locally but never submitted.
  const ctx = { ...app.ctx };
  if (ctx.daily && platform.save().progress.dailyAttempts[ctx.daily]) ctx.practice = true;
  startLevel(app.level, app.mode, ctx);
}
export function startLevel(level: Level, mode: string, ctx: Ctx): void {
  teardownPlay();
  app.level = level;
  app.mode = mode;
  app.ctx = ctx;
  platform.save().progress.lastMode = mode;
  platform.persist();
  const s = createGameSession({ level, seed: level.seed, mode: level.mode });
  app.session = s;
  s.on(onSessionEvent);
  app.cursor = { x: CW / 2, y: CH * 0.6 };
  app.material = level.allowedMaterials[0]!;
  app.joint = level.allowedJoints[0] ?? "pin";
  app.selectedBody = null;
  app.jointMode = false;
  app.jointAnchor = null;
  app.lessonStep = 0;
  app.results = null;
  app.resultsAt = null;
  app.error = null;
  render.resetChamber();
  render.setTheme(Content.THEMES[level.theme]!);
  render.setSnapshot(s.state, 1);
  render.setSelection(null);
  render.setPaused(false);
  render.setCursor(app.cursor.x, app.cursor.y);
  updateGhost();
  audio.setPhase("build");
  openScreen(null);
  announce(`${levelName(level)}. ${level.intro ? T(level.intro) : ""}`);
  if (mode === "learn") { const st = level.steps?.[0]; if (st) announce(T(st.text)); }
}
export function teardownPlay(): void {
  app.overlay = null;
  if (app.session) app.session.setPaused(false);
  app.session = null;
  app.resultsAt = null;
  audio.setPhase("none");
  audio.setSuspended(false);
}

// ------------------------------------------------------------------ chamber actions
export const building = (): boolean => !!app.session && app.session.state.phase === "build";
export const playing = (): boolean => !!app.session && app.screen === null && app.overlay === null;
function cmdError(prefix: string, message: string): void { flashError(T(prefix, { reason: reasonText(message) })); }
export function trySpawn(x: number, y: number): void {
  const s = app.session;
  if (!s || s.state.phase !== "build") return;
  const res = s.dispatch({ type: "spawn", material: app.material, x: Math.round(x * 4) / 4, y: Math.round(y * 4) / 4 });
  if (res.error) cmdError("Cannot spawn: {reason}", res.error.message);
}
export function deleteSelected(): void {
  const s = app.session;
  if (!s || !app.selectedBody) return;
  const res = s.dispatch({ type: "delete", target: app.selectedBody });
  if (res.error) cmdError("Cannot delete: {reason}", res.error.message);
  else { app.selectedBody = null; render.setSelection(null); }
}
export function doUndo(): void {
  const s = app.session;
  if (!s) return;
  const r = s.undo();
  if (!r.ok) flashError(T("Nothing to undo"));
  else {
    audio.play("undo");
    announce(T("Undid {action}", { action: T(`action.${r.undone!.type}`) }));
    if (app.selectedBody && !s.state.bodies.some((b) => b.id === app.selectedBody)) { app.selectedBody = null; render.setSelection(null); }
    render.setSnapshot(s.state, 1);
    updateGhost();
  }
}
export function doRun(): void {
  const s = app.session;
  if (!s) return;
  const res = s.dispatch({ type: "run" });
  if (res.error) { cmdError("Cannot run: {reason}", res.error.message); return; }
  lastTickWarned = null;
  app.selectedBody = null;
  app.jointMode = false;
  app.jointAnchor = null;
  render.setSelection(null);
  audio.play("run-start");
  audio.setPhase("run");
  announce(T("Simulation running"));
}
export function selectMaterial(m: string): void {
  app.material = m;
  audio.play("ui-select");
  updateGhost();
}
/** The tray's joint buttons: toggles that joint's mode. */
export function toggleJoint(j: string): void {
  const same = app.jointMode && app.joint === j;
  app.joint = j;
  app.jointMode = !same;
  app.jointAnchor = null;
  audio.play("ui-select");
  announce(app.jointMode ? T("{joint} mode: select two bodies", { joint: T(Rules.JOINT_TYPES[j]!.name) }) : T("Joint mode off"));
}
export function moveCursor(dx: number, dy: number): void {
  app.cursor.x = Math.max(0.5, Math.min(CW - 0.5, app.cursor.x + dx * 0.5));
  app.cursor.y = Math.max(0.5, Math.min(CH - 0.5, app.cursor.y + dy * 0.5));
  render.setCursor(app.cursor.x, app.cursor.y);
  updateGhost();
  announce(T("Cursor {x}, {y}", { x: app.cursor.x.toFixed(1), y: app.cursor.y.toFixed(1) }));
}
function updateGhost(): void {
  const s = app.session;
  if (!s || s.state.phase !== "build") { render.setGhost(null); return; }
  const a = s.legal().find((x) => x.type === "spawn" && x.material === app.material);
  render.setGhost({ x: app.cursor.x, y: app.cursor.y, ok: !!a?.ok });
}
export function reframe(): void { render.frameChamber(); announce(T("Camera re-framed")); }

/** A press on a body or on empty chamber space (ui.js handlePick). */
export function pickAt(body: string | null, world: { x: number; y: number } | null): void {
  const s = app.session;
  if (!s || s.state.phase !== "build") return;
  if (body) {
    if (app.jointMode) {
      if (!app.jointAnchor) {
        app.jointAnchor = body;
        app.selectedBody = body;
        render.setSelection(body);
        audio.play("ui-select");
        announce(T("First body selected; pick a second body"));
      } else {
        const res = s.dispatch({ type: "joint", joint: app.joint, a: app.jointAnchor, b: body });
        if (res.error) cmdError("Cannot connect: {reason}", res.error.message);
        else audio.play("joint");
        app.jointAnchor = null; // stays in joint mode for chaining
      }
    } else {
      app.selectedBody = body;
      render.setSelection(body);
      audio.play("ui-select");
      const b = s.state.bodies.find((x) => x.id === body);
      announce(T(b && b.kind === "payload" ? "Selected {body} payload" : "Selected {body}", { body: b ? T(Rules.MATERIALS[b.material]!.name) : T("body") }));
    }
    return;
  }
  if (!world) return;
  // floor tap: move the cursor and spawn
  app.cursor.x = Math.max(0.5, Math.min(CW - 0.5, world.x));
  app.cursor.y = Math.max(0.5, Math.min(CH - 0.5, world.y));
  render.setCursor(app.cursor.x, app.cursor.y);
  updateGhost();
  if (app.jointMode) return; // in joint mode, taps on empty space do nothing
  trySpawn(app.cursor.x, app.cursor.y);
}

// ------------------------------------------------------------------ pause, help, settings
export function pauseGame(): void {
  const s = app.session;
  if (!s) return;
  s.setPaused(true);
  audio.play("pause");
  audio.setSuspended(true);
  render.setPaused(true);
  app.overlay = "pause";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-resume";
}
export function resumeGame(): void {
  const s = app.session;
  if (!s) return;
  s.setPaused(false);
  render.setPaused(false);
  audio.setSuspended(false);
  app.overlay = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  audio.play("ui-select");
}
export function openSettings(): void {
  app.overlay = "settings";
  app.openedFrame = frame().frame;
}
/** Done / Escape on the settings panel: back to the pause panel when a chamber is paused. */
export function closeSettings(): void {
  app.overlay = app.session && app.session.paused && app.screen === null ? "pause" : null;
  app.openedFrame = frame().frame;
  if (app.overlay === "pause") app.focusNext = "btn-resume";
}
/** Help from the title, the chamber's rail (pauses a running chamber) or the pause panel; Back returns there. */
export function openHelp(from: "title" | "play" | "pause"): void {
  const s = app.session;
  app.helpReturn = s && (from === "play" || from === "pause") ? from : "title";
  if (app.helpReturn === "play" && s && !s.paused) {
    app.helpPaused = true;
    s.setPaused(true);
    render.setPaused(true);
  }
  app.overlay = null;
  openScreen("help");
}
export function backFromHelp(): void {
  const s = app.session;
  if (app.helpReturn === "pause" && s) {
    openScreen(null);
    app.overlay = "pause";
    app.focusNext = "btn-resume";
  } else if (app.helpReturn === "play" && s) {
    openScreen(null);
    if (app.helpPaused) { s.setPaused(false); render.setPaused(false); }
  } else goTitle();
  app.helpReturn = "title";
  app.helpPaused = false;
}
export function leaveChamber(): void { goTitle(); }
export function restartChamber(): void { audio.play("ui-select"); app.overlay = null; restartCurrent(); }
export function replayTutorial(): void {
  platform.save().progress.lessonsDone = {};
  platform.persist();
  app.overlay = null;
  startLearn(0);
}

// ------------------------------------------------------------------ session events (ui.js wireSession)
function unlocked(keys: string[]): void {
  for (const k of keys) {
    const a = Content.ACHIEVEMENTS[k];
    toast(T("Achievement unlocked: {name}", { name: a ? T(a.name) : k }), true);
    audio.play("achievement");
  }
}
function onSessionEvent(ev: SessionEvent): void {
  const s = app.session;
  if (!s) return;
  if (ev.type === "command") {
    for (const e of ev.events ?? []) {
      render.setSnapshot(s.state, 1);
      render.emitEvent(e);
      if (e.type === "spawn") {
        audio.play("spawn");
        unlocked(Progress.recordSpawn(platform.save().progress));
        platform.persist();
      } else if (e.type === "joint") audio.play("joint");
      else if (e.type === "delete") audio.play("delete");
      else if (e.type === "reset") announce(T("Reset to build phase"));
    }
    if (ev.cmd) checkLessonProgress(ev.cmd.type, ev.cmd.material, ev.cmd.joint);
    render.setSnapshot(s.state, 1);
    updateGhost();
  } else if (ev.type === "command-error") {
    flashError(T("Illegal action: {reason}", { reason: reasonText(ev.error?.message ?? "") }));
  } else if (ev.type === "step") {
    for (const e of ev.events ?? []) {
      render.emitEvent(e);
      if (e.type === "shatter") audio.play("shatter");
      else if (e.type === "destroyed") audio.play("impact");
      else if (e.type === "delivered") { audio.play("goal"); announce(T("Payload delivered")); }
    }
  } else if (ev.type === "terminal") onTerminal(ev);
}
function checkLessonProgress(type: string, material?: string, joint?: string): void {
  const level = app.level;
  if (app.mode !== "learn" || !level?.steps) return;
  const step = level.steps[app.lessonStep];
  if (!step) return;
  const req = step.requireCommand;
  if (type !== req.type) return;
  if (req.material && material !== req.material) return;
  if (req.joint && joint !== req.joint) return;
  app.lessonStep += 1;
  audio.play("ui-select");
  if (app.lessonStep >= level.steps.length) {
    const r = Progress.recordLesson(platform.save().progress, level.id);
    if (r.first) {
      platform.persist();
      toast(T("Lesson complete: {name}", { name: levelName(level) }), true);
      unlocked(r.newly);
    }
    announce(T("Lesson complete! Finish the delivery or move on."));
  } else announce(T(level.steps[app.lessonStep]!.text));
}
export function nextLesson(): void { startLearn(((app.ctx.lessonIndex ?? 0) + 1) % Content.LEARN_LESSONS.length); }

const TERMINAL_TEXT: Record<string, string> = {
  "goal-complete": "All payloads delivered",
  "time-expired": "Time expired",
  "payload-destroyed": "Payload destroyed",
};
export function terminalText(reason: string | null): string { return reason && TERMINAL_TEXT[reason] ? T(TERMINAL_TEXT[reason]!) : reason || T("unknown"); }
/** Journey and Daily runs (not practice) post their total (Challenge stays local, as before). */
function isRankedPost(): boolean {
  return (app.mode === "journey" || app.mode === "daily") && !app.ctx.practice;
}
function onTerminal(ev: SessionEvent): void {
  const s = app.session!;
  const st = s.state;
  const won = st.phase === "won";
  const score = ev.score ?? s.score();
  audio.setPhase("none");
  audio.play(won ? "win" : "lose");
  vibrateMs(won ? 80 : 120);
  const level = app.level!;
  const elapsedTicks = st.runStartTick === null ? 0 : st.tick - st.runStartTick;
  const p = platform.save().progress;
  const r = Progress.recordRun(p, {
    levelId: level.id, won, total: score.total, movesUsed: st.movesUsed, elapsedTicks, par: level.par, daily: app.ctx.daily ?? null,
  });
  platform.persist();
  unlocked(r.newly);
  const ranked = isRankedPost();
  app.results = {
    won, score, prevBest: r.prevBest, newBest: r.newBest, firstWin: r.firstWin, reason: st.terminalReason,
    earned: p.achievements.slice(-3), lb: null, ranked,
  };
  if (ranked && platform.signedIn()) {
    app.results.lb = "posting";
    const r0 = app.results;
    void platform.postScore(score.total).then((res) => { r0.lb = res; });
  }
  app.resultsAt = clockMs + 900;
}
function showResults(): void {
  const r = app.results;
  if (!r) return;
  openScreen("results");
  app.focusNext = r.won && (app.mode === "journey" || app.mode === "learn") ? "btn-next" : "btn-retry";
  announce(T(r.won ? "Won with {n} points" : "Lost with {n} points", { n: r.score.total }), true);
}
export function leaderboardLine(): string | null {
  const r = app.results?.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("inviteCopied")); } catch { toast(S("inviteFailed", { link })); }
}

// ------------------------------------------------------------------ keys and pads (ui.js keydown)
onAction((e) => {
  const a = e.action;
  if (!e.pressed) {
    if (a === "joint" && platform.options.jointMode === "hold" && app.jointMode) { app.jointMode = false; app.jointAnchor = null; }
    return;
  }
  if (ui.capturingKeys()) return;
  if (app.overlay) {
    if (a !== "pause" || !fresh()) return;
    if (app.overlay === "settings") later(closeSettings);
    else later(resumeGame);
    return;
  }
  if (app.screen) {
    if (a !== "pause" || !fresh()) return;
    if (app.screen === "help") { audio.play("ui-back"); later(backFromHelp); }
    else if (app.screen === "modes" || app.screen === "progression" || app.screen === "scores") { audio.play("ui-back"); later(goTitle); }
    return;
  }
  const s = app.session;
  if (!s || app.resultsAt !== null) return;
  const level = app.level!;
  const arrow = (dx: number, dy: number): void => { ui.setFocus(null); cursorShown = true; moveCursor(dx, dy); };
  switch (a) {
    case "cursor_up": arrow(0, 1); break;
    case "cursor_down": arrow(0, -1); break;
    case "cursor_left": arrow(-1, 0); break;
    case "cursor_right": arrow(1, 0); break;
    case "spawn":
      if (ui.focused() !== null) return; // Enter / Space on a focused button is the button's
      later(() => trySpawn(app.cursor.x, app.cursor.y));
      break;
    case "joint":
      if (level.allowedJoints.length && s.state.phase === "build") {
        app.jointMode = true;
        app.jointAnchor = null;
        announce(T("{joint} mode: select two bodies", { joint: T(Rules.JOINT_TYPES[app.joint]!.name) }));
      }
      break;
    case "delete": later(deleteSelected); break;
    case "run": later(doRun); break;
    case "undo": later(doUndo); break;
    case "pause":
      if (!fresh()) return;
      if (app.jointMode) { app.jointMode = false; app.jointAnchor = null; }
      else later(pauseGame);
      break;
    case "reframe": reframe(); break;
    default: {
      const m = /^material_([1-4])$/.exec(a);
      if (m) {
        const mat = level.allowedMaterials[Number(m[1]) - 1];
        if (mat) selectMaterial(mat);
      }
    }
  }
});

// ------------------------------------------------------------------ pointer and touch on the chamber
/** Rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: render.Rect[] = [];
/** The chamber view (the old canvas) in window pixels, set by screens.ts. */
export const view: render.Rect = { x: 0, y: 0, width: 0, height: 0 };
const inView = (x: number, y: number): boolean => x >= view.x && y >= view.y && x <= view.x + view.width && y <= view.y + view.height;
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
const presses: { x: number; y: number }[] = [];
let hover: { x: number; y: number } | null = null;
let lastTouch = -1e9;
/** Whether the spawn cursor shows: always on the old canvas; kept so. */
let cursorShown = true;
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  if (e.phase === "start") presses.push({ x: e.x, y: e.y });
  else if (e.phase === "move") hover = { x: e.x, y: e.y };
});
onPointerButton((e) => {
  if (e.button !== 0 || !e.pressed || now() - lastTouch < 0.6) return;
  presses.push({ x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) hover = { x, y }; });
/** ui.js: pointerdown picks (bodies as 0.5-radius spheres, else the floor); pointermove moves the cursor in the build phase. */
function pointerInput(wasPlaying: boolean): void {
  const list = presses.splice(0);
  const h = hover;
  hover = null;
  // a press that closed a panel or left a screen this frame belongs to that widget, not the chamber
  if (!wasPlaying || !playing() || app.resultsAt !== null) return;
  const s = app.session!;
  if (h && s.state.phase === "build" && inView(h.x, h.y) && !onHud(h.x, h.y)) {
    const w = render.screenToWorld(h.x, h.y);
    app.cursor.x = Math.max(0.5, Math.min(CW - 0.5, w.x));
    app.cursor.y = Math.max(0.5, Math.min(CH - 0.5, w.y));
    render.setCursor(app.cursor.x, app.cursor.y);
    updateGhost();
  }
  for (const p of list) {
    if (!inView(p.x, p.y) || onHud(p.x, p.y)) continue;
    ui.setFocus(null);
    pickAt(render.pick(p.x, p.y), render.screenToWorld(p.x, p.y));
  }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
let lastTickWarned: number | null = null;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  const s = app.session;
  if (s && s.state.phase === "run" && !s.paused && app.screen === null) {
    s.step(1);
    const st = s.state;
    if (st.phase === "run" && app.level) {
      const remain = Math.ceil((app.level.timeLimitTicks - (st.tick - st.runStartTick!)) * Rules.DT);
      if (remain <= 5 && remain >= 1 && remain !== lastTickWarned) { lastTickWarned = remain; audio.play("tick"); }
    }
    render.setSnapshot(st, 0);
  }
  if (app.resultsAt !== null && clockMs >= app.resultsAt) { app.resultsAt = null; showResults(); }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyOptions(): void {
  render.setFraming(platform.options.cameraDefault === "tight" ? 0.02 : 0.1);
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applyOptions();
  openScreen("title");
  app.focusNext = "btn-play";
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => applyOptions());
platform.onProgressMerged(() => { if (app.screen === "title") announce(T("Progress restored from your StarHermit cloud save.")); });
onSessionEnded(() => toast(S("signedOut")));
onSuspend(() => {
  hidden = true;
  // Backgrounding pauses a running chamber (the player resumes from the pause panel).
  const s = app.session;
  if (s && s.state.phase === "run" && !s.paused && app.screen === null) pauseGame();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => { hidden = false; if (!app.session?.paused) audio.setSuspended(false); });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  const t = now();
  if (app.error && app.error.until < t) app.error = null;
  app.toasts = app.toasts.filter((x) => x.until >= t);
});
onRender((interp) => {
  hudRects.length = 0;
  const wasPlaying = playing();
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasPlaying);
  const s = app.session;
  if (s) {
    render.setSnapshot(s.state, s.state.phase === "run" && !s.paused ? interp : 1);
    render.setCursor(app.cursor.x, app.cursor.y, cursorShown && s.state.phase === "build");
  }
  const f = frame();
  render.update(frameDt, f.width, f.height, view);
});
