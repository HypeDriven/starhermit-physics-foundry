// Semantic-HTML SPA shell for Physics Foundry.
// Builds its own DOM inside #pf-shell. The Three.js canvas fills the play
// region but is never the only UI: every canvas action has a DOM equivalent.

import {
  MATERIALS, JOINT_TYPES, SCHEMA_VERSION, DT, CHAMBER,
  dailySeed as fnvDailySeed,
} from "./rules.js";
import {
  CONTENT_VERSION, THEMES, LEARN_LESSONS, JOURNEY_LEVELS, CHALLENGE_LEVELS,
  ACHIEVEMENTS, dailyLevel, getLevel,
} from "./content.js";
import { createGameSession } from "./session.js";

const MATERIAL_KEYS = Object.keys(MATERIALS);
const TERMINAL_TEXT = {
  "goal-complete": "All payloads delivered",
  "time-expired": "Time expired",
  "payload-destroyed": "Payload destroyed",
};

const MODE_DEFS = [
  { id: "learn", name: "Learn", desc: "Six interactive lessons; one rule at a time.", duration: "2-4 min each", ranked: false },
  { id: "journey", name: "Journey", desc: "44 authored chambers with rising complexity.", duration: "1-3 min per level", ranked: true },
  { id: "daily", name: "Daily", desc: "One shared chamber per UTC day, one ranked attempt.", duration: "~2 min", ranked: true },
  { id: "practice", name: "Practice", desc: "Any unlocked level, free restart and undo, unranked.", duration: "open-ended", ranked: false },
  { id: "challenge", name: "Challenge", desc: "Four constrained chambers: limits, clocks, altered gravity.", duration: "2-5 min", ranked: true },
  { id: "score", name: "Score chase", desc: "Global and daily leaderboards with verified replays.", duration: "-", ranked: true },
];

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "disabled") n.disabled = !!v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

export function init(deps) {
  const { audio, platform, storage, createRenderer, analytics } = deps;

  // ------------------------------------------------------------ persisted state
  const settings = storage.loadSettings();
  const progress = storage.loadProgress();

  function saveSettings() {
    storage.saveSettings(settings);
    analytics("settings-change", { consent: settings.consentAnalytics });
  }
  function saveProgress() { storage.saveProgress(progress); }

  // ------------------------------------------------------------ root DOM
  const root = document.getElementById("pf-shell") || document.body;
  root.innerHTML = "";
  root.classList.add("pf-app");

  const live = el("div", { class: "pf-sr-only", "aria-live": "polite", id: "pf-live" });
  const alertLive = el("div", { class: "pf-sr-only", "aria-live": "assertive", id: "pf-alert" });
  const toastRegion = el("div", { class: "pf-toasts", "aria-live": "polite" });

  const header = el("header", { class: "pf-top" }, [
    el("h1", { class: "pf-logo", text: "Physics Foundry" }),
    el("span", { class: "pf-net-status", id: "pf-net", text: platform.isOffline() ? "offline" : "" }),
  ]);
  const main = el("main", { class: "pf-main", id: "pf-main" });
  root.append(header, main, live, alertLive, toastRegion);

  function announce(msg) { live.textContent = ""; live.textContent = msg; }
  function announceError(msg) { alertLive.textContent = ""; alertLive.textContent = msg; }

  function toast(msg, kind = "info") {
    const t = el("div", { class: "pf-toast pf-toast-" + kind, role: "status", text: msg });
    toastRegion.append(t);
    setTimeout(() => t.remove(), 4500);
  }

  function applyA11yClasses() {
    document.body.classList.toggle("pf-hc", settings.highContrast);
    document.body.classList.toggle("pf-lg", settings.largeText);
    document.body.classList.toggle("pf-lh", settings.leftHanded);
    document.body.classList.toggle("pf-rm", settings.reducedMotion);
  }
  applyA11yClasses();

  function vibrate(ms) {
    if (settings.haptics && typeof navigator !== "undefined" && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch { /* unsupported */ }
    }
  }

  // ------------------------------------------------------------ runtime state
  let renderer = null;
  let session = null;
  let currentLevel = null;
  let currentMode = null;
  let currentCtx = {}; // {practice, lessonIndex, daily}
  let cursor = { x: CHAMBER.w / 2, y: CHAMBER.h / 2 };
  let selectedMaterial = "wood";
  let selectedJoint = "pin";
  let selectedBody = null;
  let jointMode = false;
  let jointAnchor = null;
  let lessonStep = 0;
  let runStartWall = 0;
  let runAccum = 0;
  let lastTickWarned = null;
  let rafId = 0;
  let lastFrame = 0;
  let pauseOverlay = null;
  let settingsOverlay = null;
  let dailyInfo = null;
  let timeOffset = 0;

  const canvasWrap = el("div", { class: "pf-canvas-wrap" });
  const canvas = el("canvas", { class: "pf-canvas", "aria-label": "Test chamber view. Use the action tray or keyboard for all actions." });
  canvasWrap.append(canvas);

  // ------------------------------------------------------------ renderer
  function ensureRenderer() {
    if (renderer || !createRenderer) return renderer;
    renderer = createRenderer(canvas, { onPick: handlePick });
    if (renderer) {
      renderer.setQuality(settings.quality);
      renderer.setReducedMotion(settings.reducedMotion);
      if (renderer.setFraming) renderer.setFraming(settings.cameraDefault === "tight" ? 0.02 : 0.1);
    }
    return renderer;
  }

  // ------------------------------------------------------------ screens
  const screens = {};
  function showScreen(name) {
    for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
    const s = screens[name];
    if (s) {
      const h = s.querySelector("h2, h3, button");
      if (h) h.focus({ preventScroll: true });
    }
  }

  function makeScreen(name) {
    const s = el("section", { class: "pf-screen pf-screen-" + name, "aria-label": name });
    s.hidden = true;
    screens[name] = s;
    main.append(s);
    return s;
  }

  // ------------------------------------------------------------ TITLE
  const titleScreen = makeScreen("title");

  function journeyProgressSummary() {
    const done = JOURNEY_LEVELS.filter((l) => progress.completed[l.id]).length;
    return done + " / " + JOURNEY_LEVELS.length + " chambers";
  }

  function renderTitle() {
    titleScreen.innerHTML = "";
    const playBtn = el("button", {
      class: "pf-btn pf-btn-primary pf-btn-big",
      text: "Play",
      onclick: () => { audio.play("ui-select"); quickPlay(); },
    });
    titleScreen.append(
      el("h2", { class: "pf-title-head", text: "Industrial physics sandbox" }),
      el("p", { class: "pf-tag", text: "Cast materials, rig joints, run the chamber, deliver every payload." }),
      playBtn,
      el("div", { class: "pf-title-grid" }, [
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); startDaily(); } }, [
          el("strong", { text: "Daily challenge" }),
          el("span", { text: dailyInfo ? "Today's cast: " + dailyInfo.date : "One shared chamber per day" }),
          el("span", { class: "pf-daily-countdown", id: "pf-daily-cd", text: "" }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); renderProgression(); showScreen("progression"); } }, [
          el("strong", { text: "Journey" }),
          el("span", { text: journeyProgressSummary() }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); openSettings(); } }, [
          el("strong", { text: "Profile & settings" }),
          el("span", { text: progress.achievements.length + " achievements, audio & accessibility" }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); renderModes(); showScreen("modes"); } }, [
          el("strong", { text: "All modes" }),
          el("span", { text: "Learn, Practice, Challenge, Score chase" }),
        ]),
      ]),
      el("div", { class: "pf-title-foot" }, [
        el("button", { class: "pf-btn pf-btn-secondary", text: "How to play", onclick: () => { renderHelp(); showScreen("help"); } }),
        el("button", { class: "pf-btn pf-btn-secondary", text: "Leaderboards", onclick: () => { renderScores(); showScreen("scores"); } }),
      ])
    );
    updateDailyCountdown();
  }

  // Returning players reach the playfield in at most two actions:
  // Play -> last mode (or daily if not yet attempted today).
  function quickPlay() {
    analytics("start", { mode: progress.lastMode });
    const lm = progress.lastMode || "journey";
    if (lm === "learn") return startLearn(nextLessonIndex());
    if (lm === "daily") return startDaily();
    if (lm === "challenge") return renderModeSetup("challenge"), showScreen("modes");
    if (lm === "practice") return renderModeSetup("practice"), showScreen("modes");
    return startJourney(nextJourneyIndex());
  }

  function nextJourneyIndex() {
    for (let i = 0; i < JOURNEY_LEVELS.length; i++) {
      if (!progress.completed[JOURNEY_LEVELS[i].id]) return i;
    }
    return JOURNEY_LEVELS.length - 1;
  }
  function nextLessonIndex() {
    for (let i = 0; i < LEARN_LESSONS.length; i++) {
      if (!progress.lessonsDone[LEARN_LESSONS[i].id]) return i;
    }
    return LEARN_LESSONS.length - 1;
  }

  // ------------------------------------------------------------ MODES
  const modesScreen = makeScreen("modes");

  function renderModes() {
    modesScreen.innerHTML = "";
    modesScreen.append(
      el("h2", { text: "Choose a mode" }),
      el("div", { class: "pf-mode-grid" },
        MODE_DEFS.map((m) => el("button", {
          class: "pf-card pf-mode-card",
          onclick: () => { audio.play("ui-select"); selectMode(m.id); },
        }, [
          el("strong", { text: m.name }),
          el("span", { text: m.desc }),
        ]))),
      el("div", { class: "pf-setup", id: "pf-setup", hidden: true }),
      el("button", { class: "pf-btn pf-btn-secondary", text: "Back", onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } })
    );
  }

  function selectMode(id) {
    if (id === "learn") return startLearn(nextLessonIndex());
    if (id === "journey") return startJourney(nextJourneyIndex());
    if (id === "daily") return startDaily();
    if (id === "score") { renderScores(); showScreen("scores"); return; }
    renderModeSetup(id);
  }

  function renderModeSetup(id) {
    const setup = modesScreen.querySelector("#pf-setup");
    if (!setup) { renderModes(); return renderModeSetup(id); }
    setup.innerHTML = "";
    setup.hidden = false;
    const def = MODE_DEFS.find((m) => m.id === id);
    setup.append(el("h3", { text: def.name + " setup" }),
      el("dl", { class: "pf-setup-facts" }, [
        el("dt", { text: "Rules" }), el("dd", { text: def.desc }),
        el("dt", { text: "Expected duration" }), el("dd", { text: def.duration }),
        el("dt", { text: "Ranked" }), el("dd", { text: def.ranked ? "Yes — verified replays" : "No — unranked" }),
      ]));

    if (id === "practice") {
      const filter = el("select", { class: "pf-input", "aria-label": "Difficulty filter" },
        [el("option", { value: "0", text: "All difficulties" })]
          .concat([1, 2, 3, 4, 5].map((d) => el("option", { value: String(d), text: "Difficulty " + d }))));
      const list = el("div", { class: "pf-level-list" });
      const renderList = () => {
        list.innerHTML = "";
        const maxD = Number(filter.value);
        const unlocked = JOURNEY_LEVELS.filter((l, i) =>
          (i === 0 || progress.completed[JOURNEY_LEVELS[i - 1].id]) &&
          (!maxD || l.difficulty === maxD));
        for (const l of unlocked) {
          list.append(el("button", {
            class: "pf-chip", text: l.name,
            onclick: () => { audio.play("ui-select"); startLevel(l, "practice", { practice: true }); },
          }));
        }
        if (!unlocked.length) list.append(el("p", { text: "No unlocked levels at this difficulty yet." }));
      };
      filter.addEventListener("change", renderList);
      renderList();
      setup.append(filter, list);
    }

    if (id === "challenge") {
      const list = el("div", { class: "pf-level-list" });
      for (const l of CHALLENGE_LEVELS) {
        list.append(el("button", {
          class: "pf-chip",
          text: l.name + (progress.completed[l.id] ? " ✓" : ""),
          onclick: () => { audio.play("ui-select"); startLevel(l, "challenge", {}); },
        }));
      }
      setup.append(list);
    }
    setup.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------ PLAY SCREEN
  const playScreen = makeScreen("play");
  const hudObjective = el("h2", { class: "pf-objective", id: "pf-objective" });
  const hudProgress = el("p", { class: "pf-hud-line", id: "pf-progress" });
  const hudBudget = el("p", { class: "pf-hud-line", id: "pf-budget" });
  const hudTime = el("p", { class: "pf-hud-line pf-time", id: "pf-time", hidden: true });
  const hudPhase = el("p", { class: "pf-hud-line pf-phase", id: "pf-phase" });
  const hudError = el("p", { class: "pf-error", id: "pf-error", role: "status" });
  const lessonBanner = el("div", { class: "pf-lesson", id: "pf-lesson", hidden: true });

  const tray = el("div", { class: "pf-tray", role: "toolbar", "aria-label": "Chamber actions" });

  playScreen.append(
    el("aside", { class: "pf-rail pf-rail-left" }, [
      hudObjective, hudProgress, hudBudget, hudTime, hudPhase, hudError,
      el("button", { class: "pf-btn pf-btn-secondary", text: "Pause (Esc)", onclick: () => pauseGame() }),
      el("button", { class: "pf-btn pf-btn-secondary", text: "Help", onclick: () => { renderHelp(); showScreen("help"); } }),
    ]),
    canvasWrap,
    el("aside", { class: "pf-rail pf-rail-right" }, [lessonBanner, tray])
  );

  function fmtTime(ticks) {
    const s = Math.max(0, Math.ceil(ticks * DT));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function refreshHud() {
    if (!session) return;
    const st = session.state;
    hudObjective.textContent = currentLevel.name + " — deliver " + st.goals.total + " payload" + (st.goals.total > 1 ? "s" : "");
    hudProgress.textContent = "Delivered: " + st.goals.delivered + " / " + st.goals.total;
    hudBudget.textContent = "Spawns left: " + (st.spawnBudget - st.movesUsed) + " / " + st.spawnBudget;
    hudPhase.textContent = "Phase: " + st.phase + (session.paused ? " (paused)" : "");
    if (st.phase === "run" && st.runStartTick !== null) {
      hudTime.hidden = false;
      hudTime.textContent = "Time left: " + fmtTime(currentLevel.timeLimitTicks - (st.tick - st.runStartTick));
    } else {
      hudTime.hidden = st.phase !== "run";
    }
    renderTray();
  }

  function flashError(msg) {
    hudError.textContent = msg;
    announceError(msg);
    audio.play("ui-error");
    vibrate(40);
    clearTimeout(flashError._t);
    flashError._t = setTimeout(() => { hudError.textContent = ""; }, 3500);
  }

  // ------------------------------------------------------------ action tray
  function guard(btn) {
    // brief disable so one gesture cannot double-commit a command
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 160);
  }

  function renderTray() {
    if (!session) return;
    const st = session.state;
    const legal = {};
    for (const a of session.legal()) legal[a.type + ":" + (a.material || a.joint || "")] = a;
    tray.innerHTML = "";
    const building = st.phase === "build";

    const matRow = el("div", { class: "pf-tray-row", role: "group", "aria-label": "Materials" });
    currentLevel.allowedMaterials.forEach((m, i) => {
      const a = legal["spawn:" + m] || { ok: false };
      const b = el("button", {
        class: "pf-btn pf-mat" + (selectedMaterial === m ? " pf-selected" : ""),
        text: MATERIALS[m].name + " (" + (i + 1) + ")",
        "aria-pressed": selectedMaterial === m ? "true" : "false",
        title: a.ok ? "Select " + MATERIALS[m].name : (a.reason || ""),
        onclick: (ev) => { selectedMaterial = m; audio.play("ui-select"); renderTray(); ev.currentTarget.focus(); },
      });
      b.style.setProperty("--mat-color", MATERIALS[m].color);
      matRow.append(b);
    });

    const spawnBtn = el("button", {
      class: "pf-btn pf-btn-primary",
      text: "Spawn at cursor (Enter)",
      disabled: !building,
      onclick: (ev) => { guard(ev.currentTarget); trySpawn(cursor.x, cursor.y); },
    });

    const actRow = el("div", { class: "pf-tray-row", role: "group", "aria-label": "Actions" });
    if (currentLevel.allowedJoints.length) {
      for (const j of currentLevel.allowedJoints) {
        actRow.append(el("button", {
          class: "pf-btn" + (jointMode && selectedJoint === j ? " pf-selected" : ""),
          text: JOINT_TYPES[j].name + " (J)",
          "aria-pressed": jointMode && selectedJoint === j ? "true" : "false",
          onclick: () => {
            selectedJoint = j;
            jointMode = !(jointMode && selectedJoint === j);
            jointAnchor = null;
            audio.play("ui-select");
            announce(jointMode ? JOINT_TYPES[j].name + " mode: select two bodies" : "Joint mode off");
            renderTray();
          },
        }));
      }
    }
    actRow.append(
      el("button", {
        class: "pf-btn", text: "Delete selected (Del)",
        disabled: !building || !selectedBody,
        onclick: (ev) => { guard(ev.currentTarget); deleteSelected(); },
      }),
      el("button", {
        class: "pf-btn", text: "Undo (U)",
        disabled: !session.canUndo,
        onclick: (ev) => { guard(ev.currentTarget); doUndo(); },
      }),
      el("button", {
        class: "pf-btn pf-btn-go", text: building ? "Run (R)" : "Running…",
        disabled: !building,
        onclick: (ev) => { guard(ev.currentTarget); doRun(); },
      })
    );

    const cursorRow = el("div", { class: "pf-tray-row pf-cursor-ctl", role: "group", "aria-label": "Move spawn cursor" });
    const move = (dx, dy) => () => { moveCursor(dx, dy); };
    cursorRow.append(
      el("button", { class: "pf-btn pf-btn-sm", text: "↑", "aria-label": "Cursor up", onclick: move(0, 1) }),
      el("div", { class: "pf-tray-row" }, [
        el("button", { class: "pf-btn pf-btn-sm", text: "←", "aria-label": "Cursor left", onclick: move(-1, 0) }),
        el("button", { class: "pf-btn pf-btn-sm", text: "↓", "aria-label": "Cursor down", onclick: move(0, -1) }),
        el("button", { class: "pf-btn pf-btn-sm", text: "→", "aria-label": "Cursor right", onclick: move(1, 0) }),
      ])
    );

    tray.append(matRow, spawnBtn, actRow, cursorRow);
  }

  function moveCursor(dx, dy) {
    cursor.x = Math.max(0.5, Math.min(CHAMBER.w - 0.5, cursor.x + dx * 0.5));
    cursor.y = Math.max(0.5, Math.min(CHAMBER.h - 0.5, cursor.y + dy * 0.5));
    if (renderer) {
      renderer.setCursor(cursor.x, cursor.y);
      updateGhost();
    }
    announce("Cursor " + cursor.x.toFixed(1) + ", " + cursor.y.toFixed(1));
  }

  function updateGhost() {
    if (!renderer || !session || session.state.phase !== "build") {
      if (renderer) renderer.setGhost(null);
      return;
    }
    const a = session.legal().find((x) => x.type === "spawn" && x.material === selectedMaterial);
    renderer.setGhost({ x: cursor.x, y: cursor.y, ok: !!(a && a.ok) });
  }

  // ------------------------------------------------------------ commands
  function trySpawn(x, y) {
    if (!session || session.state.phase !== "build") return;
    const res = session.dispatch({ type: "spawn", material: selectedMaterial, x: Math.round(x * 4) / 4, y: Math.round(y * 4) / 4 });
    if (res.error) flashError("Cannot spawn: " + res.error.message);
    return res;
  }

  function deleteSelected() {
    if (!session || !selectedBody) return;
    const res = session.dispatch({ type: "delete", target: selectedBody });
    if (res.error) flashError("Cannot delete: " + res.error.message);
    else selectedBody = null;
  }

  function doUndo() {
    if (!session) return;
    const r = session.undo();
    if (!r.ok) flashError("Nothing to undo");
    else { audio.play("undo"); announce("Undid " + r.undone.type); refreshHud(); }
  }

  function doRun() {
    if (!session) return;
    const res = session.dispatch({ type: "run" });
    if (res.error) { flashError("Cannot run: " + res.error.message); return; }
    runStartWall = performance.now();
    runAccum = 0;
    lastTickWarned = null;
    selectedBody = null;
    jointMode = false;
    jointAnchor = null;
    audio.play("run-start");
    audio.setPhase("run");
    announce("Simulation running");
  }

  // ------------------------------------------------------------ picking
  function handlePick(pick, ev) {
    if (!session || session.state.phase !== "build") return;
    audio.unlock();
    if (pick.type === "body") {
      if (jointMode) {
        if (!jointAnchor) {
          jointAnchor = pick.id;
          selectedBody = pick.id;
          if (renderer) renderer.setSelection(pick.id);
          audio.play("ui-select");
          announce("First body selected; pick a second body");
        } else {
          const res = session.dispatch({ type: "joint", joint: selectedJoint, a: jointAnchor, b: pick.id });
          if (res.error) flashError("Cannot joint: " + res.error.message);
          else { audio.play("joint"); }
          jointAnchor = null;
          if (settings.jointMode !== "hold") { /* stay in joint mode for chaining */ }
          renderTray();
        }
      } else {
        selectedBody = pick.id;
        if (renderer) renderer.setSelection(pick.id);
        audio.play("ui-select");
        const b = session.state.bodies.find((x) => x.id === pick.id);
        announce("Selected " + (b ? MATERIALS[b.material].name : "body") + (b && b.kind === "payload" ? " payload" : ""));
        renderTray();
      }
      return;
    }
    // floor tap: move cursor and spawn
    cursor.x = pick.world.x; cursor.y = pick.world.y;
    if (renderer) renderer.setCursor(cursor.x, cursor.y);
    if (jointMode) return; // in joint mode, taps on empty space do nothing
    trySpawn(cursor.x, cursor.y);
  }

  // pointer move updates ghost (pointer capture not needed for hover;
  // drags use capture set implicitly by the browser on the canvas)
  canvas.addEventListener("pointermove", (ev) => {
    if (!renderer || !session || session.state.phase !== "build") return;
    const w = renderer.screenToWorld(ev.clientX, ev.clientY);
    cursor.x = Math.max(0.5, Math.min(CHAMBER.w - 0.5, w.x));
    cursor.y = Math.max(0.5, Math.min(CHAMBER.h - 0.5, w.y));
    renderer.setCursor(cursor.x, cursor.y);
    updateGhost();
  });
  canvas.addEventListener("pointercancel", () => { jointAnchor = null; });

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (ev) => {
    if (screens.play.hidden) {
      if (ev.key === "Escape" && !pauseOverlay && !settingsOverlay && !screens.play.hidden) return;
      return;
    }
    if (pauseOverlay || settingsOverlay) {
      if (ev.key === "Escape") { ev.preventDefault(); closeOverlays(); if (session && session.paused) resumeGame(); }
      return;
    }
    const k = ev.key.toLowerCase();
    const handled = () => { ev.preventDefault(); audio.unlock(); };
    if (k === "arrowup" || k === "w") { handled(); moveCursor(0, 1); }
    else if (k === "arrowdown" || k === "s") { handled(); moveCursor(0, -1); }
    else if (k === "arrowleft" || k === "a") { handled(); moveCursor(-1, 0); }
    else if (k === "arrowright" || k === "d") { handled(); moveCursor(1, 0); }
    else if (k === "enter" || k === " ") { handled(); trySpawn(cursor.x, cursor.y); }
    else if (k === "j") {
      handled();
      if (currentLevel.allowedJoints.length) {
        jointMode = true;
        jointAnchor = null;
        announce(JOINT_TYPES[selectedJoint].name + " mode: select two bodies");
        renderTray();
      }
    }
    else if (k === "delete" || k === "backspace") { handled(); deleteSelected(); }
    else if (k === "r") { handled(); doRun(); }
    else if (k === "u") { handled(); doUndo(); }
    else if (k === "escape") {
      handled();
      if (jointMode) { jointMode = false; jointAnchor = null; renderTray(); }
      else pauseGame();
    }
    else if (k === "c") { handled(); if (renderer && renderer.frameChamber) renderer.frameChamber(); announce("Camera re-framed"); }
    else if (["1", "2", "3", "4"].includes(k)) {
      const i = Number(k) - 1;
      if (currentLevel.allowedMaterials[i]) {
        handled();
        selectedMaterial = currentLevel.allowedMaterials[i];
        audio.play("ui-select");
        renderTray();
      }
    }
  });
  document.addEventListener("keyup", (ev) => {
    if (ev.key.toLowerCase() === "j" && settings.jointMode === "hold") {
      jointMode = false;
      jointAnchor = null;
      if (!screens.play.hidden) renderTray();
    }
  });

  // ------------------------------------------------------------ session events
  function wireSession(s) {
    s.on((ev) => {
      if (ev.type === "command") {
        for (const e of ev.events) {
          if (renderer) renderer.emitEvent(e);
          if (e.type === "spawn") {
            audio.play("spawn", { material: e.material });
            progress.counters.spawns += 1;
            if (progress.counters.spawns >= 500) unlockAchievement("marathon-builder");
            saveProgress();
          } else if (e.type === "joint") audio.play("joint");
          else if (e.type === "delete") audio.play("delete");
          else if (e.type === "reset") announce("Reset to build phase");
        }
        checkLessonProgress(ev.cmd);
        refreshHud();
        updateGhost();
      } else if (ev.type === "command-error") {
        flashError("Illegal action: " + ev.error.message);
        refreshHud(); // invalid action counter changed
      } else if (ev.type === "step") {
        for (const e of ev.events) {
          if (renderer) renderer.emitEvent(e);
          if (e.type === "shatter") audio.play("shatter");
          else if (e.type === "destroyed") audio.play("impact", { material: "steel", strength: 8, avSeed: s.state.tick });
          else if (e.type === "delivered") { audio.play("goal"); announce("Payload delivered"); }
        }
      } else if (ev.type === "terminal") {
        onTerminal(ev);
      }
    });
  }

  function checkLessonProgress(cmd) {
    if (currentMode !== "learn" || !currentLevel.steps) return;
    const step = currentLevel.steps[lessonStep];
    if (!step) return;
    const req = step.requireCommand;
    if (cmd.type !== req.type) return;
    if (req.material && cmd.material !== req.material) return;
    if (req.joint && cmd.joint !== req.joint) return;
    lessonStep += 1;
    analytics("tutorial-step", { lesson: currentLevel.id, step: lessonStep });
    audio.play("ui-select");
    if (lessonStep >= currentLevel.steps.length) {
      lessonBanner.innerHTML = "";
      lessonBanner.append(el("p", { text: "Lesson complete! Finish the delivery or move on." }),
        el("button", { class: "pf-btn pf-btn-primary", text: "Next lesson", onclick: () => startLearn((currentCtx.lessonIndex + 1) % LEARN_LESSONS.length) }));
      if (!progress.lessonsDone[currentLevel.id]) {
        progress.lessonsDone[currentLevel.id] = true;
        saveProgress();
        toast("Lesson complete: " + currentLevel.name, "ok");
        if (LEARN_LESSONS.every((l) => progress.lessonsDone[l.id])) unlockAchievement("mechanic-mastery");
      }
    } else {
      renderLessonBanner();
    }
  }

  function renderLessonBanner() {
    const step = currentLevel.steps[lessonStep];
    lessonBanner.hidden = !step;
    lessonBanner.innerHTML = "";
    if (step) {
      lessonBanner.append(
        el("strong", { text: "Lesson " + (currentCtx.lessonIndex + 1) + "/" + LEARN_LESSONS.length }),
        el("p", { text: step.text }));
      announce(step.text);
    }
  }

  // ------------------------------------------------------------ terminal / results
  function onTerminal(ev) {
    const st = session.state;
    const won = st.phase === "won";
    const score = ev.score;
    audio.setPhase("none");
    audio.play(won ? "win" : "lose");
    vibrate(won ? 80 : 120);

    const durationMs = Math.round(performance.now() - runStartWall);
    const elapsedTicks = st.runStartTick === null ? 0 : st.tick - st.runStartTick;

    // progression
    const levelId = currentLevel.id;
    const firstWin = won && !progress.completed[levelId];
    if (won) {
      progress.completed[levelId] = true;
      const metPar = st.movesUsed <= currentLevel.par.spawns && elapsedTicks <= currentLevel.par.timeTicks;
      if (metPar) progress.stars[levelId] = true;
      progress.counters.wins += 1;
      progress.counters.streak += 1;
      if (currentCtx.daily) progress.dailyAttempts[currentCtx.daily.date] = { score: score.total };
      unlockAchievement("first-completion");
      if (progress.counters.streak >= 3) unlockAchievement("streak-3");
      const masteryDone = JOURNEY_LEVELS.filter((l) => l.tutorialFlags && l.tutorialFlags.mastery)
        .every((l) => progress.completed[l.id]);
      if (masteryDone) unlockAchievement("mastery-milestone");
    } else {
      progress.counters.streak = 0;
      if (currentCtx.daily && !progress.dailyAttempts[currentCtx.daily.date]) {
        progress.dailyAttempts[currentCtx.daily.date] = { score: score.total };
      }
    }
    const prevBest = progress.bests[levelId] || 0;
    const newBest = score.total > prevBest;
    if (newBest) progress.bests[levelId] = score.total;
    saveProgress();
    analytics("round-end", { level: levelId, won, score: score.total });

    renderResults({ won, score, durationMs, prevBest, newBest, firstWin, reason: st.terminalReason });
    setTimeout(() => showScreen("results"), 900);
  }

  function unlockAchievement(key) {
    if (progress.achievements.includes(key)) return;
    progress.achievements.push(key);
    saveProgress();
    const a = ACHIEVEMENTS[key];
    toast("Achievement unlocked: " + (a ? a.name : key), "ok");
    audio.play("achievement");
    // idempotent server-side too; failure is fine offline
    platform.unlockAchievement(key, progress.playerId).then(() => {});
  }

  const resultsScreen = makeScreen("results");

  function renderResults(r) {
    resultsScreen.innerHTML = "";
    const st = session.state;
    const c = r.score.components;
    const rows = [
      ["Goal", c.goal], ["Time bonus", c.timeBonus],
      ["Material efficiency", c.materialEfficiency], ["Spawn efficiency", c.spawnEfficiency],
      ["Invalid-action penalty", c.invalidPenalty],
    ];
    const table = el("table", { class: "pf-score-table" }, [
      el("caption", { text: "Score breakdown" }),
      ...rows.map(([k, v]) => el("tr", {}, [el("th", { scope: "row", text: k }), el("td", { text: String(v) })])),
      el("tr", { class: "pf-total" }, [el("th", { scope: "row", text: "Total" }), el("td", { text: String(r.score.total) })]),
    ]);

    const earned = progress.achievements.slice(-3).map((k) => ACHIEVEMENTS[k]).filter(Boolean);

    const ranked = (currentMode === "journey" || currentMode === "daily" || currentMode === "challenge")
      && !currentCtx.practice;
    const submitWrap = el("div", { class: "pf-submit" });
    if (ranked && (currentMode === "journey" || currentMode === "daily")) {
      const nameInput = el("input", {
        class: "pf-input", type: "text", minlength: "3", maxlength: "24",
        placeholder: "Name for leaderboard", "aria-label": "Leaderboard name",
        value: settings.playerName || "",
      });
      const submitBtn = el("button", {
        class: "pf-btn pf-btn-primary", text: "Verify & share replay",
        onclick: async () => {
          const name = nameInput.value.trim();
          if (name.length < 3) { flashError("Name must be at least 3 characters"); return; }
          submitBtn.disabled = true;
          settings.playerName = name;
          saveSettings();
          const replay = session.getReplay();
          const payload = {
            board: currentMode === "daily" ? "daily" : "global",
            name,
            contentVersion: CONTENT_VERSION,
            rulesetVersion: SCHEMA_VERSION,
            commands: replay.commands,
            stateHashes: replay.stateHashes,
            seed: session.state.seed,
            durationMs: r.durationMs,
            assists: 0,
          };
          if (currentMode === "daily") payload.date = currentCtx.daily.date;
          else payload.levelId = currentLevel.id;
          const res = await platform.submitScore(payload);
          if (res.error) {
            flashError("Submit failed: " + res.error);
            submitBtn.disabled = false;
          } else {
            toast("Rank " + res.rank + " with " + res.score + " points", "ok");
            submitBtn.textContent = "Submitted — rank " + res.rank;
          }
        },
      });
      submitWrap.append(nameInput, submitBtn);
    } else {
      submitWrap.append(el("p", { class: "pf-note", text: "Unranked session — no leaderboard submission." }));
    }

    resultsScreen.append(
      el("h2", { text: r.won ? "Delivery complete" : "Run failed" }),
      el("p", { class: "pf-note", text: "Reason: " + (TERMINAL_TEXT[r.reason] || r.reason || "unknown") }),
      table,
      el("p", { class: "pf-note", text: r.newBest ? "New local best! (previous " + r.prevBest + ")" : "Local best: " + Math.max(r.prevBest, r.score.total) }),
      earned.length ? el("p", { class: "pf-note", text: "Achievements: " + earned.map((a) => a.name).join(", ") }) : null,
      submitWrap,
      el("div", { class: "pf-btn-row" }, [
        el("button", {
          class: "pf-btn", text: "Retry",
          onclick: () => { analytics("retry", { level: currentLevel.id }); audio.play("ui-select"); restartCurrent(); },
        }),
        nextActionButton(),
        el("button", {
          class: "pf-btn pf-btn-secondary", text: "Modes",
          onclick: () => { audio.play("ui-back"); teardownPlay(); renderModes(); showScreen("modes"); },
        }),
      ])
    );
    announce((r.won ? "Won" : "Lost") + " with " + r.score.total + " points");
  }

  function nextActionButton() {
    if (currentMode === "learn") {
      return el("button", {
        class: "pf-btn pf-btn-primary", text: "Next lesson",
        onclick: () => startLearn((currentCtx.lessonIndex + 1) % LEARN_LESSONS.length),
      });
    }
    if (currentMode === "journey") {
      const idx = JOURNEY_LEVELS.findIndex((l) => l.id === currentLevel.id);
      if (idx >= 0 && idx + 1 < JOURNEY_LEVELS.length) {
        return el("button", {
          class: "pf-btn pf-btn-primary", text: "Next chamber",
          onclick: () => startJourney(idx + 1),
        });
      }
    }
    return null;
  }

  // ------------------------------------------------------------ start flows
  function startLearn(i) {
    const level = LEARN_LESSONS[i];
    currentCtx = { lessonIndex: i };
    startLevel(level, "learn", currentCtx);
  }

  function startJourney(i) {
    startLevel(JOURNEY_LEVELS[i], "journey", {});
  }

  async function startDaily() {
    let date, seed;
    const d = await platform.getDaily();
    if (!d.error) {
      date = d.date; seed = d.seed;
      dailyInfo = d;
    } else {
      // local fallback: derive from local UTC date
      date = new Date(Date.now() + timeOffset).toISOString().slice(0, 10);
      seed = fnvDailySeed(date);
      dailyInfo = { date, seed, offline: true };
    }
    const level = dailyLevel(date);
    if (progress.dailyAttempts[date]) {
      toast("Daily already attempted today — playing unranked practice run", "info");
      return startLevel(level, "daily", { daily: { date }, practice: true });
    }
    startLevel(level, "daily", { daily: { date } });
  }

  function restartCurrent() {
    startLevel(currentLevel, currentMode, currentCtx);
  }

  function startLevel(level, mode, ctx) {
    teardownPlay();
    currentLevel = level;
    currentMode = mode;
    currentCtx = ctx || {};
    progress.lastMode = mode;
    saveProgress();
    session = createGameSession({ level, seed: level.seed, mode: level.mode });
    wireSession(session);
    cursor = { x: CHAMBER.w / 2, y: CHAMBER.h * 0.6 };
    selectedMaterial = level.allowedMaterials[0];
    selectedJoint = level.allowedJoints[0] || "pin";
    selectedBody = null;
    jointMode = false;
    jointAnchor = null;
    lessonStep = 0;
    lessonBanner.hidden = true;
    lessonBanner.innerHTML = "";

    const r = ensureRenderer();
    if (r) {
      r.setTheme(THEMES[level.theme]);
      r.setSnapshot(session.state, 1);
      r.setSelection(null);
      r.setCursor(cursor.x, cursor.y);
      updateGhost();
    }
    if (mode === "learn") renderLessonBanner();
    audio.setPhase("build");
    refreshHud();
    showScreen("play");
    announce(level.name + ". " + (level.intro || ""));
    startLoop();
  }

  function teardownPlay() {
    stopLoop();
    closeOverlays();
    if (session) session.setPaused(false);
    session = null;
    audio.setPhase("none");
  }

  // ------------------------------------------------------------ sim loop (fixed 60 Hz accumulator)
  function startLoop() {
    stopLoop();
    lastFrame = 0;
    const frame = (t) => {
      rafId = requestAnimationFrame(frame);
      if (!session) return;
      const dt = lastFrame ? Math.min(0.25, (t - lastFrame) / 1000) : DT;
      lastFrame = t;
      const st = session.state;
      if (st.phase === "run" && !session.paused) {
        runAccum += dt;
        let stepped = 0;
        while (runAccum >= DT && stepped < 10) {
          session.step(1);
          runAccum -= DT;
          stepped += 1;
          if (session.state.phase !== "run") { runAccum = 0; break; }
        }
        if (stepped === 10) runAccum = 0; // drop backlog, never spiral
        // tick warnings in the final 5 seconds
        const s2 = session.state;
        if (s2.phase === "run") {
          const remain = Math.ceil((currentLevel.timeLimitTicks - (s2.tick - s2.runStartTick)) * DT);
          if (remain <= 5 && remain >= 1 && remain !== lastTickWarned) {
            lastTickWarned = remain;
            audio.play("tick");
          }
        }
        if (renderer) renderer.setSnapshot(session.state, runAccum / DT);
        refreshHud();
      } else if (renderer) {
        renderer.setSnapshot(session.state, 1);
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ------------------------------------------------------------ pause
  function pauseGame() {
    if (!session) return;
    session.setPaused(true);
    audio.play("pause");
    if (renderer) renderer.setPaused(true);
    openPause();
  }

  function resumeGame() {
    if (!session) return;
    session.setPaused(false);
    if (renderer) renderer.setPaused(false);
    closeOverlays();
    audio.play("ui-select");
    refreshHud();
  }

  // auto-pause when the tab is backgrounded mid-session
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && session && session.state.phase === "run" && !session.paused) pauseGame();
  });

  function closeOverlays() {
    if (pauseOverlay) { pauseOverlay.remove(); pauseOverlay = null; }
    if (settingsOverlay) { settingsOverlay.remove(); settingsOverlay = null; }
  }

  function openPause() {
    closeOverlays();
    pauseOverlay = el("div", { class: "pf-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Paused" }, [
      el("div", { class: "pf-panel" }, [
        el("h2", { text: "Paused" }),
        el("button", { class: "pf-btn pf-btn-primary pf-btn-big", text: "Resume", onclick: resumeGame }),
        el("button", { class: "pf-btn", text: "Settings", onclick: openSettings }),
        el("button", { class: "pf-btn", text: "Help", onclick: () => { renderHelp(); showScreen("help"); closeOverlays(); if (session) resumeGame(); } }),
        el("button", {
          class: "pf-btn pf-btn-secondary", text: "Leave chamber",
          onclick: () => { teardownPlay(); renderTitle(); showScreen("title"); },
        }),
      ]),
    ]);
    root.append(pauseOverlay);
    pauseOverlay.querySelector("button").focus();
  }

  // ------------------------------------------------------------ settings
  function openSettings() {
    closeOverlays();
    const s = settings;

    const slider = (label, bus) => {
      const input = el("input", {
        type: "range", min: "0", max: "1", step: "0.05",
        value: String(audio.getBusVolume(bus)), "aria-label": label + " volume",
      });
      input.addEventListener("input", () => {
        audio.unlock();
        audio.setBusVolume(bus, Number(input.value));
        s[bus] = Number(input.value);
        saveSettings();
      });
      return el("label", { class: "pf-field" }, [el("span", { text: label }), input]);
    };

    const toggle = (label, key, onchange) => {
      const input = el("input", { type: "checkbox", "aria-label": label });
      input.checked = !!s[key];
      input.addEventListener("change", () => {
        s[key] = input.checked;
        saveSettings();
        applyA11yClasses();
        if (onchange) onchange(input.checked);
        audio.play("ui-select");
      });
      return el("label", { class: "pf-field pf-check" }, [input, el("span", { text: label })]);
    };

    const qualitySel = el("select", { class: "pf-input", "aria-label": "Graphics quality" },
      ["low", "medium", "high"].map((q) => el("option", { value: q, text: q, selected: s.quality === q ? "" : null })));
    qualitySel.value = s.quality;
    qualitySel.addEventListener("change", () => {
      s.quality = qualitySel.value;
      saveSettings();
      if (renderer) renderer.setQuality(s.quality);
    });

    const camSel = el("select", { class: "pf-input", "aria-label": "Camera default" },
      [el("option", { value: "frame", text: "Full chamber" }), el("option", { value: "tight", text: "Tight frame" })]);
    camSel.value = s.cameraDefault;
    camSel.addEventListener("change", () => {
      s.cameraDefault = camSel.value;
      saveSettings();
      if (renderer && renderer.setFraming) renderer.setFraming(camSel.value === "tight" ? 0.02 : 0.1);
    });

    const jointSel = el("select", { class: "pf-input", "aria-label": "Joint mode behavior" },
      [el("option", { value: "toggle", text: "Toggle (press J)" }), el("option", { value: "hold", text: "Hold (hold J)" })]);
    jointSel.value = s.jointMode;
    jointSel.addEventListener("change", () => { s.jointMode = jointSel.value; saveSettings(); });

    settingsOverlay = el("div", { class: "pf-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Settings" }, [
      el("div", { class: "pf-panel pf-settings" }, [
        el("h2", { text: "Settings" }),
        el("h3", { text: "Audio" }),
        slider("Music", "music"), slider("Effects", "effects"), slider("Ambience", "ambience"), slider("Voice", "voice"),
        toggle("Mute all", "muted", (v) => audio.setMuted(v)),
        el("h3", { text: "Graphics" }),
        el("label", { class: "pf-field" }, [el("span", { text: "Quality tier" }), qualitySel]),
        el("label", { class: "pf-field" }, [el("span", { text: "Camera default" }), camSel]),
        toggle("Reduced motion", "reducedMotion", (v) => { if (renderer) renderer.setReducedMotion(v); }),
        toggle("High contrast", "highContrast"),
        toggle("Larger text", "largeText"),
        el("h3", { text: "Controls" }),
        toggle("Left-handed action tray", "leftHanded"),
        el("label", { class: "pf-field" }, [el("span", { text: "Joint mode" }), jointSel]),
        toggle("Haptics (vibration)", "haptics"),
        el("h3", { text: "Other" }),
        toggle("Share anonymous usage events", "consentAnalytics"),
        el("button", {
          class: "pf-btn", text: "Replay tutorial",
          onclick: () => { progress.lessonsDone = {}; saveProgress(); closeOverlays(); startLearn(0); },
        }),
        el("button", { class: "pf-btn pf-btn-primary", text: "Done", onclick: () => { closeOverlays(); if (session && session.paused) openPause(); } }),
      ]),
    ]);
    root.append(settingsOverlay);
    settingsOverlay.querySelector("input, select, button").focus();
  }

  // ------------------------------------------------------------ progression screen
  const progressionScreen = makeScreen("progression");

  function renderProgression() {
    progressionScreen.innerHTML = "";
    const list = el("ol", { class: "pf-journey" });
    JOURNEY_LEVELS.forEach((l, i) => {
      const unlocked = i === 0 || progress.completed[JOURNEY_LEVELS[i - 1].id];
      const done = !!progress.completed[l.id];
      const star = !!progress.stars[l.id];
      const mastery = l.tutorialFlags && l.tutorialFlags.mastery;
      const item = el("li", { class: "pf-jlevel" + (done ? " pf-done" : "") + (mastery ? " pf-mastery" : "") }, [
        el("button", {
          class: "pf-chip",
          disabled: !unlocked,
          text: (i + 1) + ". " + l.name + (star ? " ★" : "") + (mastery ? " ◆" : ""),
          onclick: () => { audio.play("ui-select"); startJourney(i); },
        }),
      ]);
      list.append(item);
    });
    const lessons = el("div", { class: "pf-level-list" },
      LEARN_LESSONS.map((l, i) => el("button", {
        class: "pf-chip",
        text: "Lesson " + (i + 1) + (progress.lessonsDone[l.id] ? " ✓" : ""),
        onclick: () => { audio.play("ui-select"); startLearn(i); },
      })));
    const achList = el("ul", { class: "pf-ach" },
      Object.values(ACHIEVEMENTS).map((a) => el("li", {
        class: progress.achievements.includes(a.key) ? "pf-ach-on" : "pf-ach-off",
        text: (progress.achievements.includes(a.key) ? "★ " : "☆ ") + a.name + " — " + a.description,
      })));
    progressionScreen.append(
      el("h2", { text: "Progression" }),
      el("h3", { text: "Journey (" + journeyProgressSummary() + ")" }),
      list,
      el("h3", { text: "Lessons" }),
      lessons,
      el("h3", { text: "Achievements" }),
      achList,
      el("p", { class: "pf-note", text: "Lifetime spawns: " + progress.counters.spawns + " · Wins: " + progress.counters.wins + " · Current streak: " + progress.counters.streak }),
      el("button", { class: "pf-btn pf-btn-secondary", text: "Back", onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } })
    );
  }

  // ------------------------------------------------------------ help screen
  const helpScreen = makeScreen("help");

  function renderHelp() {
    helpScreen.innerHTML = "";
    const keys = [
      ["Arrows / WASD", "Move the spawn cursor"],
      ["Enter / Space", "Spawn selected material at cursor"],
      ["1-4", "Select material"],
      ["J", "Joint mode (" + (settings.jointMode === "hold" ? "hold" : "toggle") + "), then pick two bodies"],
      ["Delete", "Remove selected body"],
      ["R", "Run the simulation"],
      ["U", "Undo last build action"],
      ["C", "Re-frame camera"],
      ["Esc", "Pause / cancel joint mode"],
    ];
    helpScreen.append(
      el("h2", { text: "How to play" }),
      el("p", { text: "Build phase: spawn balls and connect them with joints. Run phase: gravity takes over — deliver every payload (outlined ball) into a pulsing target ring. Glass shatters on hard impacts; hazard strips destroy anything." }),
      el("h3", { text: "Controls" }),
      el("div", { class: "pf-cards" }, keys.map(([k, v]) =>
        el("div", { class: "pf-card" }, [el("strong", { text: k }), el("span", { text: v })]))),
      el("h3", { text: "Materials" }),
      el("div", { class: "pf-cards" }, Object.values(MATERIALS).map((m) =>
        el("div", { class: "pf-card" }, [
          el("strong", { text: m.name }),
          el("span", { text: "Density " + m.density + ", bounce " + m.restitution + (m.shatterSpeed ? ", shatters above impact " + m.shatterSpeed : "") }),
        ]))),
      el("h3", { text: "Joints" }),
      el("div", { class: "pf-cards" }, Object.values(JOINT_TYPES).map((j) =>
        el("div", { class: "pf-card" }, [
          el("strong", { text: j.name }),
          el("span", { text: "Max length " + j.maxLength + (j.stiffness ? ", stiffness " + j.stiffness : ", rigid distance lock") }),
        ]))),
      el("button", { class: "pf-btn pf-btn-secondary", text: "Back", onclick: () => { audio.play("ui-back"); backFromHelp(); } })
    );
  }

  let helpReturn = "title";
  function backFromHelp() {
    if (helpReturn === "play" && session) showScreen("play");
    else { renderTitle(); showScreen("title"); }
  }

  // ------------------------------------------------------------ score chase / leaderboards
  const scoresScreen = makeScreen("scores");

  async function renderScores() {
    scoresScreen.innerHTML = "";
    scoresScreen.append(el("h2", { text: "Leaderboards" }));
    const boards = el("div", { class: "pf-boards" });
    scoresScreen.append(boards,
      el("button", { class: "pf-btn pf-btn-secondary", text: "Back", onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } }));
    for (const board of ["global", "daily"]) {
      const wrap = el("section", { class: "pf-board" }, [el("h3", { text: board === "global" ? "Global (Journey)" : "Daily" })]);
      boards.append(wrap);
      const res = await platform.getLeaderboard(board);
      if (res.error) {
        wrap.append(el("p", { class: "pf-note", text: res.error === "offline" ? "Offline — board unavailable. Play and submit when connected." : "Board error: " + res.error }));
        continue;
      }
      if (!res.entries || !res.entries.length) {
        wrap.append(el("p", { class: "pf-note", text: "No entries yet. Be the first." }));
        continue;
      }
      const t = el("table", { class: "pf-score-table" }, [
        el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Name" }), el("th", { text: "Score" }), el("th", { text: "Goal" })]),
        ...res.entries.slice(0, 20).map((e, i) => el("tr", {}, [
          el("td", { text: String(i + 1) }), el("td", { text: e.name }),
          el("td", { text: String(e.score) }), el("td", { text: String(e.components?.goal ?? 0) }),
        ])),
      ]);
      wrap.append(t);
    }
  }

  // ------------------------------------------------------------ daily countdown
  function updateDailyCountdown() {
    const node = titleScreen.querySelector("#pf-daily-cd");
    if (!node) return;
    const now = Date.now() + timeOffset;
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    const ms = next.getTime() - now;
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    node.textContent = "Next daily in " + h + "h " + m + "m";
  }
  setInterval(() => { if (!titleScreen.hidden) updateDailyCountdown(); }, 30000);

  // server time for the daily boundary (local fallback already in place)
  platform.getServerTime().then((r) => {
    if (!r.error) timeOffset = r.offset;
    const net = document.getElementById("pf-net");
    if (net) net.textContent = r.error ? "offline" : "online";
  });
  platform.getDaily().then((d) => { if (!d.error) dailyInfo = d; });

  // ------------------------------------------------------------ boot into title
  renderTitle();
  showScreen("title");

  return {
    showScreen,
    getSession: () => session,
    openSettings,
  };
}
