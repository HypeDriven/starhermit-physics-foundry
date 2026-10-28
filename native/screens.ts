// The browser build's DOM shell (src/ui.js + src/style.css) as starhermit:ui,
// built every frame over the chamber: the header (logo, player and sync
// status), the chamber screen (the objective rail with the HUD lines, the
// error line, Pause and Help; the chamber view; the lesson box and the
// action tray — materials, Spawn at cursor, joints, Delete, Undo, Run and the
// cursor pad — mirrored for the left-handed tray), named targets for the
// bodies (the old picking's DOM equivalent: screen readers and play scripts
// find them), the toasts, the pause and settings panels, and every
// full-page screen (title, modes with their setup panels, progression, how
// to play, leaderboards, results). The old media queries are layouts picked
// by the window's logical size: wide (≥ 1024 px: three columns), short
// landscape (≤ 900 px wide, landscape: narrow rails either side) and
// compact (the status above the chamber and the tray below; phones in
// portrait put the cursor pad in one row). The chamber view's rectangle
// goes to main.ts (view → render.ts), and the page is painted around it.
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, type Level } from "./game.ts";
import { N, S, T, levelName } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, backFromHelp, building, closeSettings, copyInvite, deleteSelected, doRun, doUndo, fresh, goTitle, hudRects, later,
  leaderboardLine, leaveChamber, moveCursor, nextJourneyIndex, nextLesson, openHelp, openModes, openProgression, openScores,
  openSettings, pauseGame, quickPlay, replayTutorial, restartChamber, restartCurrent, resumeGame, selectMaterial, selectMode,
  signIn, startDaily, startJourney, startLearn, startLevel, terminalText, today, toggleJoint, trySpawn, view,
} from "./main.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; land: boolean; phone: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const wide = lw >= 1024;
  return { lw, lh, sc, wide, land: !wide && lw > lh && lw <= 900, phone: lw <= 700 && lh > lw };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn {
  id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean;
  content?: () => void; width?: number; height?: number;
}
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (b.width != null && buttonWidth(b.text, style) > b.width) {
    // a label wider than its button wraps (labels don't)
    const inner = b.width - 34;
    opts.content = () => { ui.style("wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** Buttons at their own widths (or `stretch`ed to fill each row) in rows that wrap at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 8, stretch = false, justify: "start" | "center" = "start"): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      if (stretch) {
        const total = row.reduce((n, b) => n + bw(b), 0);
        const extra = (width - total - gap * (row.length - 1)) / row.length;
        for (const b of row) button({ ...b, width: bw(b) + extra });
      } else for (const b of row) button(b);
    }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
function rect(r: ui.Rect): void { hudRects.push({ x: r.x, y: r.y, width: r.width, height: r.height }); }
/** A box over a window rectangle (window px) drawn by a placed role-none widget. */
function paint(id: string, x: number, y: number, w: number, h: number, drawFn: (r: ui.Rect) => void): void {
  if (w <= 0 || h <= 0) return;
  const sc = ui.preferences().scale, sa = frame().safeArea;
  ui.place(id, { anchor: "top-start", x: (x - sa.left) / sc, y: (y - sa.top) / sc }, () => {
    ui.widget("", { role: "none", size: { width: w / sc, height: h / sc }, draw: drawFn });
  });
}
function toWindow(x: number, y: number, w: number, h: number): ui.Rect {
  const sc = ui.preferences().scale, sa = frame().safeArea;
  return { x: sa.left + x * sc, y: sa.top + y * sc, width: w * sc, height: h * sc };
}
/** CSS repeat(auto-fit, minmax(min, 1fr)). */
function cardGrid(id: string, count: number, w: number, min: number, gap: number, cell: (i: number, cw: number) => void): void {
  const cols = Math.max(1, Math.min(count, Math.floor((w + gap) / (min + gap))));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < count; r++) {
      ui.row(`${id}-r${r}`, () => { for (let i = r * cols; i < Math.min(count, (r + 1) * cols); i++) cell(i, cw); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
/** A .pf-card button: a bold title and muted lines. */
function cardButton(id: string, title: string, lines: string[], cw: number, act: () => void, selected?: boolean): void {
  const inner = cw - 30;
  button({
    id, text: title, name: title, style: "card", width: cw, act, ...(selected !== undefined ? { selected } : {}),
    content: () => ui.column(`${id}-face`, () => {
      para(title, inner, "card-title");
      for (const l of lines) para(l, inner, "card-text");
    }, { spacing: 4, width: inner }),
  });
}
/** A static .pf-card (help). */
function infoCard(id: string, title: string, text: string, cw: number): void {
  ui.column(id, () => {
    para(title, cw - 30, "card-title");
    para(text, cw - 30, "card-text");
  }, { style: "info-card", width: cw, spacing: 4 });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.screen) fullScreen(L);
  else playScreen(L);
  header(L);
  if (app.overlay === "pause") pausePanel(L);
  else if (app.overlay === "settings") settingsPanel(L);
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}
const HEADER = 40;
function header(L: Layout): void {
  const bar = ui.place("topbar", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.row("topbar-row", () => {
      ui.style("logo").label("Physics Foundry");
      ui.spacer();
      const bits: string[] = [];
      if (platform.signedIn()) bits.push(platform.displayName() || T("Player"));
      bits.push(platform.signedIn() ? T("online") : T("local"));
      if (platform.signedIn()) {
        const st = platform.syncState();
        bits.push(T(st === "synced" ? "sync.synced" : st === "saving" ? "sync.saving" : "sync.offline"));
      }
      ui.style("net").id("net-status").label(bits.join(" · "));
    }, { style: "topbar", width: L.lw, height: HEADER, align: "center" });
  });
  rect(bar);
}

// ------------------------------------------------------------------ the chamber screen
function playScreen(L: Layout): void {
  const s = app.session, level = app.level;
  if (!s || !level) return;
  const left = platform.options.leftHanded;
  const pad = L.wide ? 12 : L.land ? 6 : 8, gap = L.wide ? 12 : L.land ? 6 : 8;
  const top = HEADER + pad;
  let cv: { x: number; y: number; w: number; h: number };
  if (L.wide || L.land) {
    const lw = L.wide ? 240 : Math.max(140, Math.min(170, 0.19 * L.lw)), rw = L.wide ? 260 : Math.max(150, Math.min(190, 0.22 * L.lw));
    const h = L.lh - top - pad;
    // .pf-lh swaps the rails
    const statusX = left ? L.lw - pad - lw : pad, trayX = left ? pad : L.lw - pad - rw;
    cv = { x: (left ? pad + rw : pad + lw) + gap, y: top, w: L.lw - 2 * pad - lw - rw - 2 * gap, h };
    pagePaint(cv);
    railBox("rail-status", statusX, top, lw, h, (iw) => statusRail(iw, false, L));
    railBox("rail-tray", trayX, top, rw, h, (iw) => trayRail(iw, L));
  } else {
    const w = L.lw - 2 * pad;
    const statusH = (lastSize.get("rail-status-in")?.height ?? 120 * L.sc) / L.sc + 20;
    const trayH = (lastSize.get("rail-tray-in")?.height ?? 260 * L.sc) / L.sc + 20;
    const room = L.lh - top - pad - 2 * gap;
    const sh = Math.min(statusH, room * (app.mode === "learn" ? 0.34 : 0.22));
    // the chamber keeps its full-width height (20 × 12 plus the margin) when the room allows, at least 160 px
    const th = Math.min(trayH, room - sh - Math.max(160, Math.min(room * 0.4, 0.6 * w + 12)));
    cv = { x: pad, y: top + sh + gap, w, h: room - sh - th };
    pagePaint(cv);
    railBox("rail-status", pad, top, w, sh, (iw) => statusRail(iw, true, L));
    railBox("rail-tray", pad, top + sh + gap + cv.h + gap, w, th, (iw) => trayRail(iw, L));
  }
  bodyTargets();
}
/** The chamber view's rectangle (to main.ts) and the page painted around it (the canvas sat in the grid's centre track). */
function pagePaint(cv: { x: number; y: number; w: number; h: number }): void {
  Object.assign(view, toWindow(cv.x, cv.y, Math.max(1, cv.w), Math.max(1, cv.h)));
  const f = frame(), bg = token("bg");
  const v = view;
  paint("page-t", 0, 0, f.width, v.y, (r) => draw.rect(r.x, r.y, r.width, r.height, bg));
  paint("page-b", 0, v.y + v.height, f.width, f.height - v.y - v.height, (r) => draw.rect(r.x, r.y, r.width, r.height, bg));
  paint("page-l", 0, v.y, v.x, v.height, (r) => draw.rect(r.x, r.y, r.width, r.height, bg));
  paint("page-r", v.x + v.width, v.y, f.width - v.x - v.width, v.height, (r) => draw.rect(r.x, r.y, r.width, r.height, bg));
}
/** A .pf-rail panel at a logical rectangle; its content scrolls when taller. */
function railBox(id: string, x: number, y: number, w: number, h: number, build: (inner: number) => void): void {
  const r = ui.place(id, { anchor: "top-start", x, y }, () => {
    ui.column(id, () => {
      const prev = lastSize.get(`${id}-in`);
      const inner = h - 20;
      const scroll = !!prev && prev.height / ui.preferences().scale > inner + 1;
      const iw = w - 20 - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(`${id}-in`, ui.column(`${id}-in`, () => build(iw), { spacing: 8, width: iw })); };
      if (scroll) ui.scrollArea(`${id}-scroll`, { width: w - 16, height: inner }, body);
      else body();
    }, { style: "rail", width: w, height: h, spacing: 0, padding: 10 });
  });
  rect(r);
}
function fmtTime(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks * Rules.DT));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** .pf-rail-left: the objective, delivered, spawns left, time left, phase, the error line, Pause and Help. */
function statusRail(w: number, compact: boolean, L: Layout): void {
  const s = app.session!, st = s.state, level = app.level!;
  para(T(st.goals.total > 1 ? "{level} — deliver {n} payloads" : "{level} — deliver 1 payload", { level: levelName(level), n: st.goals.total }), w, "objective", "hud-objective");
  const lines: [string, string, string][] = [
    [T("Delivered: {done} / {total}", { done: st.goals.delivered, total: st.goals.total }), "hud-line", "hud-progress"],
    [T("Spawns left: {left} / {total}", { left: st.spawnBudget - st.movesUsed, total: st.spawnBudget }), "hud-line", "hud-budget"],
  ];
  if (st.phase === "run" && st.runStartTick !== null) {
    lines.push([T("Time left: {time}", { time: fmtTime(level.timeLimitTicks - (st.tick - st.runStartTick)) }), "hud-time", "hud-time"]);
  }
  lines.push([T(s.paused ? "Phase: {phase} (paused)" : "Phase: {phase}", { phase: T(`phase.${st.phase}`) }), "hud-phase", "hud-phase"]);
  const btns: Btn[] = [
    { id: "btn-hud-pause", text: T("Pause (Esc)"), style: "btn-secondary", act: pauseGame, disabled: app.resultsAt !== null },
    { id: "btn-hud-help", text: T("Help"), style: "btn-secondary", act: () => openHelp("play"), disabled: app.resultsAt !== null },
  ];
  if (compact) {
    // compact layouts carry the lesson box here, so the tray stays in view below the chamber
    if (app.mode === "learn" && level.steps) lessonBox(w, level);
    // .pf-rail-left at ≤ 1023 px: one wrapping row
    const items = lines.map(([t]) => t);
    para(items.join("  ·  "), w, "hud-line", "hud-lines");
    if (app.error) para(app.error.text, w, "error", "hud-error");
    flow("hud-btns", btns, w, 8);
  } else {
    for (const [t, cls, id] of lines) para(t, w, cls, id);
    if (app.error) para(app.error.text, w, "error", "hud-error");
    else ui.spacer(0.0001);
    ui.column("hud-btns", () => { for (const b of btns) button({ ...b, width: w }); }, { spacing: 8, width: w, padding: { top: L.land ? 4 : 16 } });
  }
}
/** .pf-rail-right: the lesson box and the action tray. */
function trayRail(w: number, L: Layout): void {
  const s = app.session!, level = app.level!;
  if (app.mode === "learn" && level.steps && (L.wide || L.land)) lessonBox(w, level);
  const legal: Record<string, { ok: boolean; reason?: string }> = {};
  for (const a of s.legal()) legal[`${a.type}:${a.material ?? a.joint ?? ""}`] = a;
  const build = building() && app.resultsAt === null;
  const full = !L.wide && !L.land; // compact: buttons stretch across the row
  // materials
  const mats: Btn[] = level.allowedMaterials.map((m, i) => {
    const name = `${T(Rules.MATERIALS[m]!.name)} (${i + 1})`;
    const color = Rules.MATERIALS[m]!.color;
    return {
      id: `mat-${m}`, text: name, name, style: "btn-mat", selected: app.material === m, act: () => selectMaterial(m),
      width: buttonWidth(name, "btn-mat") + 8,
      content: () => ui.row(`mat-${m}-face`, () => {
        ui.widget("", { role: "none", size: { width: 6, height: 22 }, draw: (r) => draw.rect(r.x, r.y, r.width, r.height, color) });
        ui.label(name);
      }, { spacing: 8, align: "center" }),
    };
  });
  flow("tray-mats", mats, w, 8, full || L.land);
  button({ id: "btn-spawn", text: T("Spawn at cursor (Enter)"), style: "btn-primary", width: w, disabled: !build, act: () => trySpawn(app.cursor.x, app.cursor.y),
    content: () => para(T("Spawn at cursor (Enter)"), w - 34, "on-accent") });
  const acts: Btn[] = [];
  for (const j of level.allowedJoints) {
    acts.push({ id: `btn-joint-${j}`, text: `${T(Rules.JOINT_TYPES[j]!.name)} (J)`, selected: app.jointMode && app.joint === j, disabled: !build, act: () => toggleJoint(j) });
  }
  acts.push(
    { id: "btn-delete", text: T("Delete selected (Del)"), disabled: !build || !app.selectedBody, act: deleteSelected },
    { id: "btn-undo", text: T("Undo (U)"), disabled: !s.canUndo || app.resultsAt !== null, act: doUndo },
    { id: "btn-run", text: build ? T("Run (R)") : T("Running…"), style: "btn-go", disabled: !build, act: doRun },
  );
  flow("tray-acts", acts, w, 8, full || L.land);
  // the cursor pad: a d-pad (one row on phones and short landscape)
  const pad = (id: string, glyph: string, name: string, dx: number, dy: number): Btn => ({
    id, text: glyph, name: T(name), style: "btn", width: 48, act: () => moveCursor(dx, dy),
  });
  const l = pad("btn-cur-l", "←", "Cursor left", -1, 0), u = pad("btn-cur-u", "↑", "Cursor up", 0, 1);
  const d = pad("btn-cur-d", "↓", "Cursor down", 0, -1), r = pad("btn-cur-r", "→", "Cursor right", 1, 0);
  if (L.phone || L.land || w < 170) {
    flow("cursor-row", [l, u, d, r], w, 8, false, "center");
  } else {
    ui.column("cursor-pad", () => {
      ui.row("cursor-pad-1", () => button(u), { justify: "center", width: w });
      ui.row("cursor-pad-2", () => { button(l); button(d); button(r); }, { spacing: 8, justify: "center", width: w });
    }, { spacing: 8, width: w });
  }
}
function lessonBox(w: number, level: Level): void {
  const steps = level.steps!;
  ui.column("lesson-box", () => {
    if (app.lessonStep >= steps.length) {
      para(T("Lesson complete! Finish the delivery or move on."), w - 22, "text", "lesson-text");
      button({ id: "btn-next-lesson", text: T("Next lesson"), style: "btn-primary", width: w - 22, act: nextLesson });
    } else {
      para(T("Lesson {n}/{total}", { n: (app.ctx.lessonIndex ?? 0) + 1, total: Content.LEARN_LESSONS.length }), w - 22, "strong", "lesson-n");
      para(T(steps[app.lessonStep]!.text), w - 22, "text", "lesson-text");
    }
  }, { style: "lesson", width: w, spacing: 6 });
}
/** Every body as a named target over its disc (the DOM equivalent of picking it). */
function bodyTargets(): void {
  const s = app.session;
  if (!s || s.state.phase !== "build" || app.overlay || app.resultsAt !== null) return;
  const r = 0.5 * render.pixelsPerUnit();
  let n = 0;
  for (const b of s.state.bodies) {
    const p = render.bodyScreen(b.id);
    const mat = T(Rules.MATERIALS[b.material]!.name);
    const name = b.kind === "payload" ? T("{material} payload {n}", { material: mat, n: Number(b.id.slice(1)) + 1 })
      : T("{material} ball {n}", { material: mat, n: ++n });
    if (!p || p.x < view.x || p.y < view.y || p.x > view.x + view.width || p.y > view.y + view.height) continue;
    ui.target(name + (app.selectedBody === b.id ? T(", selected") : ""), { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r }, { role: "button" });
  }
}

// ------------------------------------------------------------------ toasts
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 32, 420);
  // .pf-toasts sat at the bottom; on compact layouts that is the tray, so they show under the header there
  const where = L.wide || app.screen ? { anchor: "bottom" as const, y: 16 }
    : { anchor: "top" as const, y: Math.max(HEADER + 8, (view.y - frame().safeArea.top) / L.sc + 8) };
  ui.place("toast-stack", where, () => {
    ui.column("toast-col", () => {
      app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => para(t.text, w - 34, "toast-text", `toast-${i}-text`), { style: t.ok ? "toast-ok" : "toast" }));
    }, { spacing: 6, align: "center" });
  });
}

// ------------------------------------------------------------------ the pause and settings panels (.pf-overlay)
function pausePanel(L: Layout): void {
  const w = Math.min(300, L.lw - 32), inner = w - 40;
  const open = ui.dialog(T("Paused"), "", true, () => {
    ui.column("pause-panel", () => {
      para(T("Paused"), inner, "h2", "pause-h");
      button({ id: "btn-resume", text: T("Resume"), style: "btn-big", width: inner, act: resumeGame });
      button({ id: "btn-pause-settings", text: T("Settings"), width: inner, act: openSettings });
      button({ id: "btn-pause-help", text: T("Help"), width: inner, act: () => openHelp("pause") });
      button({ id: "btn-restart", text: T("Restart chamber"), width: inner, act: restartChamber });
      button({ id: "btn-leave", text: T("Leave chamber"), style: "btn-secondary", width: inner, act: leaveChamber });
    }, { style: "panel", width: w, spacing: 10 });
  });
  if (!open && fresh()) later(resumeGame);
}
function profileNote(): string {
  if (platform.signedIn()) {
    const st = platform.syncState();
    return T("Playing as {name} — progress syncs to your account ({status}).", {
      name: platform.displayName() || "…", status: T(st === "synced" ? "sync.synced" : st === "saving" ? "sync.saving" : "sync.offline"),
    });
  }
  return T("Local guest profile — progress stays in this browser.");
}
/** A labelled select row (.pf-field). */
function selectRow(id: string, label: string, idx: number, options: string[], w: number, set: (i: number) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w * 0.45, "text", `${id}-label`);
    ui.spacer();
    const pick = ui.id(id).select(label, idx, options, { width: Math.min(w * 0.52, 240) } as ui.WidgetOptions);
    if (pick !== idx) later(() => set(pick));
  }, { width: w, align: "center", height: 48 });
}
/** A check box row (.pf-check; a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    const res = ui.id(id).widget(T(label), {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel-2"));
        draw.strokeRoundRect(bx, by, box, box, 4, token("muted"), 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: "#1a0d08", align: "center", weight: "bold" });
      },
    });
    para(T(label), w - 56, "text", `${id}-label`);
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 8 });
}
function settingsPanel(L: Layout): void {
  const w = Math.min(480, L.lw - 24), inner = w - 40;
  const o = platform.options;
  const maxH = 0.9 * L.lh;
  const prev = lastSize.get("settings-in");
  const scroll = !!prev && prev.height / L.sc > maxH - 40;
  const open = ui.dialog(T("Settings"), "", true, () => {
    ui.column("settings-panel", () => {
      const body = (): void => {
        lastSize.set("settings-in", ui.column("settings-in", () => {
          const iw = inner - (scroll ? 14 : 0);
          para(T("Settings"), iw, "h2", "settings-h");
          para(T("Profile"), iw, "h3");
          para(profileNote(), iw, "muted", "profile-note");
          para(T("Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options."), iw, "muted", "options-note");
          flow("settings-runtime", [
            { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
            { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
          ], iw, 8);
          para(T("Display"), iw, "h3");
          selectRow("set-camera", T("Camera default"), o.cameraDefault === "tight" ? 1 : 0, [T("Full chamber"), T("Tight frame")], iw,
            (i) => platform.setOption("cameraDefault", i === 1 ? "tight" : "frame"));
          para(T("Controls"), iw, "h3");
          toggleRow("set-left", N("Left-handed action tray"), o.leftHanded, iw, (v) => platform.setOption("leftHanded", v));
          selectRow("set-joint", T("Joint mode"), o.jointMode === "hold" ? 1 : 0, [T("Toggle (press J)"), T("Hold (hold J)")], iw,
            (i) => platform.setOption("jointMode", i === 1 ? "hold" : "toggle"));
          toggleRow("set-haptics", N("Haptics (vibration)"), o.haptics, iw, (v) => platform.setOption("haptics", v));
          para(T("Other"), iw, "h3");
          button({ id: "btn-replay-tutorial", text: T("Replay tutorial"), act: replayTutorial });
          button({ id: "btn-settings-done", text: T("Done"), style: "btn-primary", width: iw, act: closeSettings });
        }, { spacing: 10, width: inner - (scroll ? 14 : 0) }));
      };
      if (scroll) ui.scrollArea("settings-scroll", { width: inner, height: maxH - 40 }, body);
      else body();
    }, { style: "panel", width: w, spacing: 0 });
  });
  if (!open && fresh()) later(closeSettings);
}

// ------------------------------------------------------------------ full-page screens (.pf-screen)
function fullScreen(L: Layout): void {
  const f = frame();
  paint("page", 0, 0, f.width, f.height, (r) => draw.rect(r.x, r.y, r.width, r.height, token("bg")));
  const bodyH = L.lh - HEADER;
  const cw = Math.min(680, L.lw - 32);
  const key = `screen-${app.screen}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc > bodyH;
  const opening = f.frame - app.screenFrame <= 6;
  ui.place("screen", { anchor: "top-start", x: 0, y: HEADER }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, () => {
        ui.column(`${key}-inner`, () => buildScreen(cw - (scroll ? 14 : 0), L), { width: cw - (scroll ? 14 : 0), spacing: 16 });
      }, { width: L.lw - (scroll ? 14 : 0), align: "center", padding: { top: 16, bottom: 24 } });
      lastSize.set(key, r);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: L.lw, height: bodyH }, body, opening ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}
function buildScreen(w: number, L: Layout): void {
  switch (app.screen) {
    case "title": titleScreen(w); break;
    case "modes": modesScreen(w); break;
    case "progression": progressionScreen(w); break;
    case "help": helpScreen(w); break;
    case "scores": scoresScreen(w); break;
    case "results": resultsScreen(w); break;
  }
  void L;
}
const backBtn = (w: number, act: () => void): void => button({ id: "btn-back", text: T("Back"), style: "btn-secondary", width: w, act: () => act() });

// ------------------------------------------------------------------ title
function titleScreen(w: number): void {
  const p = platform.save().progress;
  para(T("Industrial physics sandbox"), w, "title-h2", "title-h");
  para(T("Cast materials, rig joints, run the chamber, deliver every payload."), w, "muted", "tagline");
  button({ id: "btn-play", text: T("Play"), style: "btn-big", width: w, act: quickPlay });
  const ms = new Date(platform.nowMs());
  const next = Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth(), ms.getUTCDate() + 1) - ms.getTime();
  const done = Content.JOURNEY_LEVELS.filter((l) => p.completed[l.id]).length;
  const cards: [string, string, string[], () => void][] = [
    ["card-daily", T("Daily challenge"), [T("Today's cast: {date}", { date: today() }), T("Next daily in {h}h {m}m", { h: Math.floor(next / 3600000), m: Math.floor((next % 3600000) / 60000) })], startDaily],
    ["card-journey", T("Journey"), [T("{done} / {total} chambers", { done, total: Content.JOURNEY_LEVELS.length })], openProgression],
    ["card-settings", T("Profile & settings"), [T("{n} achievements, audio & accessibility", { n: p.achievements.length })], openSettings],
    ["card-modes", T("All modes"), [T("Learn, Practice, Challenge, Score chase")], openModes],
  ];
  cardGrid("title-grid", cards.length, w, 200, 12, (i, cw) => { const c = cards[i]!; cardButton(c[0], c[1], c[2], cw, c[3]); });
  const foot: Btn[] = [
    { id: "btn-howto", text: T("How to play"), style: "btn-secondary", act: () => openHelp("title") },
    { id: "btn-boards", text: T("Leaderboards"), style: "btn-secondary", act: openScores },
  ];
  if (platform.inviteLink()) foot.push({ id: "btn-invite", text: S("invite"), style: "btn-secondary", act: copyInvite });
  if (!platform.signedIn()) foot.push({ id: "btn-signin", text: S("signIn"), style: "btn-secondary", act: signIn });
  flow("title-foot", foot, w, 10);
}

// ------------------------------------------------------------------ modes and their setup
const MODE_DEFS = [
  { id: "learn", name: N("Learn"), desc: N("Six interactive lessons; one rule at a time."), duration: N("2-4 min each"), ranked: false },
  { id: "journey", name: N("Journey"), desc: N("44 authored chambers with rising complexity."), duration: N("1-3 min per level"), ranked: true },
  { id: "daily", name: N("Daily"), desc: N("One shared chamber per UTC day, one ranked attempt."), duration: N("~2 min"), ranked: true },
  { id: "practice", name: N("Practice"), desc: N("Any unlocked level, free restart and undo, unranked."), duration: N("open-ended"), ranked: false },
  { id: "challenge", name: N("Challenge"), desc: N("Four constrained chambers: limits, clocks, altered gravity."), duration: N("2-5 min"), ranked: true },
  { id: "score", name: N("Score chase"), desc: N("Global and daily leaderboards with verified replays."), duration: N("-"), ranked: true },
];
function modesScreen(w: number): void {
  para(T("Choose a mode"), w, "h2", "modes-h");
  cardGrid("mode-grid", MODE_DEFS.length, w, 200, 12, (i, cw) => {
    const m = MODE_DEFS[i]!;
    cardButton(`mode-${m.id}`, T(m.name), [T(m.desc)], cw, () => selectMode(m.id), app.setup === m.id);
  });
  const id = app.setup;
  const def = MODE_DEFS.find((m) => m.id === id);
  if (def) {
    const inner = w - 32;
    ui.column("setup", () => {
      para(T("{mode} setup", { mode: T(def.name) }), inner, "h3", "setup-h");
      const kw = Math.max(...[T("Rules"), T("Expected duration"), T("Ranked")].map((t) => textWidth(t, "dt"))) + 16;
      const facts: [string, string][] = [
        [T("Rules"), T(def.desc)], [T("Expected duration"), T(def.duration)],
        [T("Ranked"), def.ranked ? T("Yes — verified replays") : T("No — unranked")],
      ];
      facts.forEach(([k, v], i) => {
        if (inner < 380) { para(k, inner, "dt"); para(v, inner, "dd", `setup-fact-${i}`); return; }
        ui.row(`setup-fact-${i}`, () => {
          ui.column(`setup-fact-${i}-k`, () => ui.style("dt").label(k), { width: kw });
          ui.column(`setup-fact-${i}-v`, () => para(v, inner - kw - 8, "dd"), { width: inner - kw - 8 });
        }, { width: inner, spacing: 8 });
      });
      if (id === "practice") practiceList(inner);
      if (id === "challenge") {
        const p = platform.save().progress;
        flow("challenge-list", Content.CHALLENGE_LEVELS.map((l) => ({
          id: `challenge-${l.id}`, text: levelName(l) + (p.completed[l.id] ? " ✓" : ""), style: "chip",
          act: () => startLevel(l, "challenge", {}),
        })), inner, 8);
      }
    }, { style: "setup", width: w, spacing: 8 });
  }
  backBtn(w, goTitle);
}
function practiceList(w: number): void {
  const p = platform.save().progress;
  const opts = [T("All difficulties"), ...[1, 2, 3, 4, 5].map((d) => T("Difficulty {n}", { n: d }))];
  const pick = ui.id("practice-filter").select(T("Difficulty filter"), app.practiceDifficulty, opts, { width: Math.min(w, 260) } as ui.WidgetOptions);
  if (pick !== app.practiceDifficulty) later(() => { app.practiceDifficulty = pick; });
  const maxD = app.practiceDifficulty;
  const levels = Content.JOURNEY_LEVELS.filter((l, i) => (i === 0 || p.completed[Content.JOURNEY_LEVELS[i - 1]!.id]) && (!maxD || l.difficulty === maxD));
  if (!levels.length) { para(T("No unlocked levels at this difficulty yet."), w, "text", "practice-empty"); return; }
  flow("practice-list", levels.map((l) => ({ id: `practice-${l.id}`, text: levelName(l), style: "chip", act: () => startLevel(l, "practice", { practice: true }) })), w, 8);
}

// ------------------------------------------------------------------ progression
function progressionScreen(w: number): void {
  const p = platform.save().progress;
  const J = Content.JOURNEY_LEVELS;
  const done = J.filter((l) => p.completed[l.id]).length;
  para(T("Progression"), w, "h2", "progression-h");
  para(T("Journey ({summary})", { summary: T("{done} / {total} chambers", { done, total: J.length }) }), w, "h3", "journey-h");
  flow("journey-list", J.map((l, i) => {
    const unlocked = i === 0 || !!p.completed[J[i - 1]!.id];
    const fin = !!p.completed[l.id];
    const mastery = !!l.tutorialFlags?.mastery;
    return {
      id: `journey-${i + 1}`, text: `${i + 1}. ${levelName(l)}${p.stars[l.id] ? " ★" : ""}${mastery ? " ◆" : ""}`,
      style: mastery ? (fin ? "chip-mastery-done" : "chip-mastery") : fin ? "chip-done" : "chip", disabled: !unlocked, act: () => startJourney(i),
    };
  }), w, 8);
  para(T("Lessons"), w, "h3");
  flow("lesson-list", Content.LEARN_LESSONS.map((l, i) => ({
    id: `lesson-${i + 1}`, text: T("Lesson {n}", { n: i + 1 }) + (p.lessonsDone[l.id] ? " ✓" : ""), style: "chip", act: () => startLearn(i),
  })), w, 8);
  para(T("Achievements"), w, "h3");
  ui.column("ach-list", () => {
    for (const a of Object.values(Content.ACHIEVEMENTS)) {
      const on = p.achievements.includes(a.key);
      para(`${on ? "★ " : "☆ "}${T(a.name)} — ${T(a.description)}`, w - 20, on ? "ach-on" : "ach-off", `ach-${a.key}`);
    }
  }, { spacing: 6, width: w, padding: { start: 20 } });
  para(T("Lifetime spawns: {spawns} · Wins: {wins} · Current streak: {streak}", p.counters), w, "muted", "counters");
  backBtn(w, goTitle);
}

// ------------------------------------------------------------------ help
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
function keysFor(...actions: string[]): string {
  return actions.map((a) => {
    let list: string[] = [];
    try { list = bindings(a).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
    return [...new Set(list)].join(" / ");
  }).filter(Boolean).join(" · ");
}
function helpScreen(w: number): void {
  para(T("How to play"), w, "h2", "help-h");
  para(T("Build phase: spawn balls and connect them with joints. Run phase: gravity takes over — deliver every payload (outlined ball) into a pulsing target ring. Glass shatters on hard impacts; hazard strips destroy anything."), w, "text", "help-intro");
  para(T("Controls"), w, "h3");
  const keys: [string, string][] = [
    [keysFor("cursor_up", "cursor_left", "cursor_down", "cursor_right"), T("Move the spawn cursor")],
    [keysFor("spawn"), T("Spawn selected material at cursor")],
    [keysFor("material_1", "material_2", "material_3", "material_4"), T("Select material 1-4")],
    [keysFor("joint"), T(platform.options.jointMode === "hold" ? "Joint mode (hold), then pick two bodies" : "Joint mode (toggle), then pick two bodies")],
    [keysFor("delete"), T("Remove selected body")],
    [keysFor("run"), T("Run the simulation")],
    [keysFor("undo"), T("Undo last build action")],
    [keysFor("reframe"), T("Re-frame camera")],
    [keysFor("pause"), T("Pause / cancel joint mode")],
  ];
  cardGrid("help-keys", keys.length, w, 200, 12, (i, cw) => infoCard(`help-key-${i}`, keys[i]![0] || "—", keys[i]![1], cw));
  para(T("Materials"), w, "h3");
  const mats = Object.values(Rules.MATERIALS);
  cardGrid("help-mats", mats.length, w, 200, 12, (i, cw) => {
    const m = mats[i]!;
    infoCard(`help-mat-${m.id}`, T(m.name), T(m.shatterSpeed ? "Density {d}, bounce {b}, shatters above impact {s}" : "Density {d}, bounce {b}",
      { d: m.density, b: m.restitution, s: m.shatterSpeed ?? 0 }), cw);
  });
  para(T("Joints"), w, "h3");
  const joints = Object.values(Rules.JOINT_TYPES);
  cardGrid("help-joints", joints.length, w, 200, 12, (i, cw) => {
    const j = joints[i]!;
    infoCard(`help-joint-${j.id}`, T(j.name), T(j.stiffness ? "Max length {n}, stiffness {s}" : "Max length {n}, rigid distance lock", { n: j.maxLength, s: j.stiffness ?? 0 }), cw);
  });
  backBtn(w, backFromHelp);
}

// ------------------------------------------------------------------ leaderboards
let hosted: platform.HostedRow[] | null | undefined;
let hostedFor = -1;
function table(id: string, w: number, heads: string[], rows: string[][], numeric: boolean[]): void {
  const n = heads.length;
  const widths = heads.map((h, i) => Math.max(textWidth(h, "th") + 24, i === 1 && n > 2 ? w * 0.4 : 0));
  const rest = w - widths.reduce((a, b) => a + b, 0);
  const cw = widths.map((x) => x + rest / n);
  const row = (rid: string, cells: string[], head: boolean): void => {
    ui.row(rid, () => cells.forEach((c, i) => ui.column(`${rid}-${i}`, () => para(c, cw[i]! - 16, head ? "th" : numeric[i] ? "td" : "td-start"),
      { width: cw[i]!, align: numeric[i] && !head ? "end" : "start" })), { style: "score-row", width: w, spacing: 0 });
  };
  ui.column(id, () => { row(`${id}-h`, heads, true); rows.forEach((r, i) => row(`${id}-${i}`, r, false)); }, { width: w, spacing: 0 });
}
function scoresScreen(w: number): void {
  const p = platform.save().progress;
  para(T("Leaderboards"), w, "h2", "scores-h");
  // Global (Journey): signed in, the platform's board; else the local journey bests.
  if (platform.signedIn()) {
    if (hostedFor !== app.boardsKey) { hostedFor = app.boardsKey; hosted = undefined; void platform.hostedBoard(false).then((r) => { hosted = r; }); }
    para(hosted ? T("StarHermit leaderboard") : T("Global (Journey)"), w, "h3", "board-global-h");
    if (hosted === undefined) para(T("Loading…"), w, "muted", "board-loading");
    else if (hosted === null) para(T("Board error: {error}", { error: "no-board" }), w, "muted", "board-error");
    else if (!hosted.length) para(T("No entries yet. Be the first."), w, "muted", "board-empty");
    else table("board-global", w, ["#", T("Name"), T("Score")], hosted.slice(0, 20).map((e, i) => [String(i + 1), e.name || "—", String(e.score)]), [true, false, true]);
  } else {
    para(T("Local bests (Journey)"), w, "h3", "board-global-h");
    const rows = Content.JOURNEY_LEVELS.filter((l) => p.bests[l.id]);
    if (!rows.length) para(T("No local journey bests yet."), w, "muted", "board-empty");
    else table("board-local", w, [T("Chamber"), T("Best")], rows.map((l) => [levelName(l), String(p.bests[l.id])]), [false, true]);
  }
  para(T("Daily"), w, "h3", "board-daily-h");
  const days = Object.keys(p.dailyAttempts).sort().reverse().slice(0, 10);
  if (!days.length) para(T("No local daily runs yet."), w, "muted", "daily-empty");
  else table("board-daily", w, [T("Day"), T("Score")], days.map((d) => [d, String(p.dailyAttempts[d]?.score ?? 0)]), [false, true]);
  backBtn(w, goTitle);
}

// ------------------------------------------------------------------ results
function resultsScreen(w: number): void {
  const r = app.results;
  if (!r) return;
  para(r.won ? T("Delivery complete") : T("Run failed"), w, "h2", "results-h");
  para(T("Reason: {reason}", { reason: terminalText(r.reason) }), w, "muted", "results-reason");
  const c = r.score.components;
  const tw = Math.min(480, w);
  ui.column("score-table", () => {
    ui.row("score-caption", () => para(T("Score breakdown"), tw, "caption"), { width: tw, justify: "center" });
    const rows: [string, number][] = [
      [T("Goal"), c.goal], [T("Time bonus"), c.timeBonus], [T("Material efficiency"), c.materialEfficiency],
      [T("Spawn efficiency"), c.spawnEfficiency], [T("Invalid-action penalty"), c.invalidPenalty],
    ];
    rows.forEach(([k, v], i) => ui.row(`score-${i}`, () => {
      ui.column(`score-${i}-k`, () => para(k, tw - 110, "th"), { width: tw - 100 });
      ui.column(`score-${i}-v`, () => ui.style("td").id(`score-${i}-n`).label(String(v)), { width: 80, align: "end" });
    }, { style: "score-row", width: tw, spacing: 0, align: "center" }));
    ui.row("score-total", () => {
      ui.column("score-total-k", () => para(T("Total"), tw - 110, "total"), { width: tw - 100 });
      ui.column("score-total-v", () => ui.style("total-num").id("score-total").label(String(r.score.total)), { width: 80, align: "end" });
    }, { style: "score-row", width: tw, spacing: 0, align: "center" });
  }, { width: tw, spacing: 0 });
  para(r.newBest ? T("New local best! (previous {n})", { n: r.prevBest }) : T("Local best: {n}", { n: Math.max(r.prevBest, r.score.total) }), w, "muted", "results-best");
  const earned = r.earned.map((k) => Content.ACHIEVEMENTS[k]).filter((a) => !!a);
  if (earned.length) para(T("Achievements: {list}", { list: earned.map((a) => T(a!.name)).join(", ") }), w, "muted", "results-ach");
  if (r.ranked) para(leaderboardLine() ?? T("Ranked run recorded on this device."), w, "muted", "results-lb");
  else para(T("Unranked session — no leaderboard submission."), w, "muted", "results-lb");
  const btns: Btn[] = [{ id: "btn-retry", text: T("Retry"), act: () => { restartCurrent(); } }];
  if (app.mode === "learn") btns.push({ id: "btn-next", text: T("Next lesson"), style: "btn-primary", act: nextLesson });
  if (app.mode === "journey") {
    const idx = Content.JOURNEY_LEVELS.findIndex((l) => l.id === app.level?.id);
    if (idx >= 0 && idx + 1 < Content.JOURNEY_LEVELS.length) btns.push({ id: "btn-next", text: T("Next chamber"), style: "btn-primary", act: () => startJourney(idx + 1) });
  }
  btns.push({ id: "btn-modes", text: T("Modes"), style: "btn-secondary", act: () => { goTitle(); openModes(); } });
  flow("results-btns", btns, w, 10);
  void nextJourneyIndex;
}
