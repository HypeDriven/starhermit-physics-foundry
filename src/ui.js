// Semantic-HTML SPA shell for Physics Foundry.
// Builds its own DOM inside #pf-shell. The Three.js canvas fills the play
// region but is never the only UI: every canvas action has a DOM equivalent.

import {
  MATERIALS, JOINT_TYPES, DT, CHAMBER,
} from "./rules.js";
import {
  THEMES, LEARN_LESSONS, JOURNEY_LEVELS, CHALLENGE_LEVELS,
  ACHIEVEMENTS, dailyLevel, getLevel,
} from "./content.js";
import { createGameSession } from "./session.js";
import { PRESETS, CATEGORIES, SHADOW_MAP, detectLevel, presetForLevel, resolve as resolveGfx, presetTier, choosePreset } from "./gfx.js";
import { translator, describeLocalized } from "./gfx-i18n.js";
import { platformStrings, pickPlatformLocale } from "./platform-i18n.js";
import { mergeProgress } from "./platform.js";
import { t, getLocale, onLocaleChange, levelName, reasonText } from "./i18n.js";

// GPU name from WEBGL_debug_renderer_info (probed once on a throwaway context).
let gpuProbe = null;
function probeGpu() {
  if (gpuProbe) return gpuProbe;
  let name = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  } catch { /* no GPU info; Auto falls back to Balanced */ }
  const mobile = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches)
    || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  // StarHermit hardware level (gpu-level.js): renderer string + device facts (phone/tablet, cores, memory).
  let sys = { mobile };
  try {
    const G = globalThis.StarHermitGpu;
    if (G) { const d = G.detectSystem(); sys = { ...d, mobile: mobile || d.mobile }; }
  } catch { /* defaults */ }
  const level = detectLevel(name, sys);
  gpuProbe = { name: String(name || ""), level, detected: presetForLevel(level) };
  return gpuProbe;
}

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
    // i18n / i18nAria: a string key re-applied in place on a language change.
    else if (k === "i18n") { n.dataset.i18n = v; n.textContent = t(v); }
    else if (k === "i18nAria") { n.dataset.i18nAria = v; n.setAttribute("aria-label", t(v)); }
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
    platform.cloudSave(currentDoc());
    platform.syncSettings(settings);
    updateNetStatus();
    analytics("settings-change", { consent: settings.consentAnalytics });
  }
  function saveProgress() {
    storage.saveProgress(progress);
    platform.cloudSave(currentDoc());
    updateNetStatus();
  }

  // Cloud mirror snapshot (settings + progress); the platform module debounces.
  function currentDoc() {
    return JSON.parse(JSON.stringify({ settings, progress }));
  }

  // Net / identity / sync status shown in the header status slot.
  function updateNetStatus() {
    const net = document.getElementById("pf-net");
    if (!net) return;
    const bits = [];
    if (platform.isHosted()) bits.push(platform.getNickname() || t("Player"));
    bits.push(platform.isOffline() ? t("local") : t("online"));
    if (platform.isHosted()) bits.push(t("sync." + platform.getSyncStatus()));
    net.textContent = bits.join(" · ");
  }

  // Cloud restore: the cloud doc mirrors settings+progress; localStorage stays
  // the offline cache. Progress is merged (never dropped from either side);
  // remote settings win at boot, this device's settings win on a save conflict.
  function applyRemoteDoc(doc, { keepLocalSettings = false } = {}) {
    if (!doc || typeof doc !== "object") return;
    if (!keepLocalSettings && doc.settings && typeof doc.settings === "object") Object.assign(settings, doc.settings);
    if (doc.progress && typeof doc.progress === "object") Object.assign(progress, mergeProgress(doc.progress, progress));
    saveSettings();
    saveProgress();
    audio.setBusVolume("music", settings.music);
    audio.setBusVolume("effects", settings.effects);
    audio.setBusVolume("ambience", settings.ambience);
    audio.setBusVolume("voice", settings.voice);
    audio.setMuted(settings.muted);
    applyA11yClasses();
    applyGraphics();
    if (renderer) {
      renderer.setReducedMotion(settings.reducedMotion);
      if (renderer.setFraming) renderer.setFraming(settings.cameraDefault === "tight" ? 0.02 : 0.1);
    }
    if (!screens.title.hidden) renderTitle();
  }

  // ------------------------------------------------------------ root DOM
  const root = document.getElementById("pf-shell") || document.body;
  root.innerHTML = "";
  root.classList.add("pf-app");

  const live = el("div", { class: "pf-sr-only", "aria-live": "polite", id: "pf-live" });
  const alertLive = el("div", { class: "pf-sr-only", "aria-live": "assertive", id: "pf-alert" });
  const toastRegion = el("div", { class: "pf-toasts", "aria-live": "polite" });

  const header = el("header", { class: "pf-top" }, [
    el("h1", { class: "pf-logo", text: "Physics Foundry" }),
    el("span", { class: "pf-net-status", id: "pf-net", text: platform.isOffline() ? t("local") : "" }),
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

  // ------------------------------------------------------------ graphics settings
  const tg = (key, vars) => translator(getLocale())(key, vars);
  function gfxSaved() {
    if (!settings.graphics || typeof settings.graphics !== "object") settings.graphics = { preset: "auto" };
    return settings.graphics;
  }
  function applyGraphics() {
    const r = resolveGfx(gfxSaved(), probeGpu().detected, probeGpu().level);
    document.body.dataset.gfxPreset = r.preset;
    document.body.dataset.gfxAuto = r.auto ? "1" : "0";
    if (renderer && renderer.setGraphics) renderer.setGraphics(gfxSaved(), probeGpu().detected, probeGpu().level);
    return r;
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

  applyGraphics(); // body data attributes before the chamber exists

  const canvasWrap = el("div", { class: "pf-canvas-wrap" });
  const canvas = el("canvas", { class: "pf-canvas", i18nAria: "Test chamber view. Use the action tray or keyboard for all actions." });
  canvasWrap.append(canvas);

  // ------------------------------------------------------------ renderer
  function ensureRenderer() {
    if (renderer || !createRenderer) return renderer;
    renderer = createRenderer(canvas, { onPick: handlePick });
    applyGraphics();
    if (renderer) {
      renderer.setReducedMotion(settings.reducedMotion);
      if (renderer.setFraming) renderer.setFraming(settings.cameraDefault === "tight" ? 0.02 : 0.1);
    }
    return renderer;
  }

  // ------------------------------------------------------------ screens
  const screens = {};
  function showScreen(name) {
    for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
    // run-end toasts (lesson complete, achievements) are listed on the results
    // screen itself; drop them so they don't cover its score table or buttons
    if (name === "results") toastRegion.replaceChildren();
    const s = screens[name];
    if (s) {
      const h = s.querySelector("h2, h3, button");
      // headings are not focusable by default; make them programmatically
      // focusable so screen changes move focus (and screen-reader position)
      if (h) {
        if (h.tagName === "H2" || h.tagName === "H3") h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    }
  }

  function makeScreen(name) {
    const s = el("section", { class: "pf-screen pf-screen-" + name, i18nAria: "screen." + name });
    s.hidden = true;
    screens[name] = s;
    main.append(s);
    return s;
  }

  // ------------------------------------------------------------ TITLE
  const titleScreen = makeScreen("title");

  function journeyProgressSummary() {
    const done = JOURNEY_LEVELS.filter((l) => progress.completed[l.id]).length;
    return t("{done} / {total} chambers", { done, total: JOURNEY_LEVELS.length });
  }

  function renderTitle() {
    titleScreen.innerHTML = "";
    const playBtn = el("button", {
      class: "pf-btn pf-btn-primary pf-btn-big",
      text: t("Play"),
      onclick: () => { audio.play("ui-select"); quickPlay(); },
    });
    titleScreen.append(
      el("h2", { class: "pf-title-head", text: t("Industrial physics sandbox") }),
      el("p", { class: "pf-tag", text: t("Cast materials, rig joints, run the chamber, deliver every payload.") }),
      playBtn,
      el("div", { class: "pf-title-grid" }, [
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); startDaily(); } }, [
          el("strong", { text: t("Daily challenge") }),
          el("span", { text: dailyInfo ? t("Today's cast: {date}", { date: dailyInfo.date }) : t("One shared chamber per day") }),
          el("span", { class: "pf-daily-countdown", id: "pf-daily-cd", text: "" }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); renderProgression(); showScreen("progression"); } }, [
          el("strong", { text: t("Journey") }),
          el("span", { text: journeyProgressSummary() }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); openSettings(); } }, [
          el("strong", { text: t("Profile & settings") }),
          el("span", { text: t("{n} achievements, audio & accessibility", { n: progress.achievements.length }) }),
        ]),
        el("button", { class: "pf-card", onclick: () => { audio.play("ui-select"); renderModes(); showScreen("modes"); } }, [
          el("strong", { text: t("All modes") }),
          el("span", { text: t("Learn, Practice, Challenge, Score chase") }),
        ]),
      ]),
      el("div", { class: "pf-title-foot" }, [
        el("button", { class: "pf-btn pf-btn-secondary", text: t("How to play"), onclick: () => openHelp("title") }),
        el("button", { class: "pf-btn pf-btn-secondary", text: t("Leaderboards"), onclick: () => { renderScores(); showScreen("scores"); } }),
        platform.inviteLink() ? el("button", { class: "pf-btn pf-btn-secondary", id: "pf-invite", text: ps.invite, onclick: () => inviteFriend() }) : null,
        platform.canSignIn() ? el("button", { class: "pf-btn pf-btn-secondary", id: "pf-signin", text: ps.signIn, onclick: () => platform.signIn() }) : null,
      ])
    );
    updateDailyCountdown();
  }

  // StarHermit invite link (signed in only) -> clipboard + confirmation toast.
  // Account strings follow the game language (read at use time).
  const ps = new Proxy({}, { get: (_, key) => platformStrings(pickPlatformLocale(getLocale()))[key] });
  async function inviteFriend() {
    const link = platform.inviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast(ps.inviteCopied);
    } catch {
      toast(ps.inviteFailed.replace("{link}", link));
    }
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

  let openSetup = null; // mode whose setup panel is showing (re-rendered on a language change)

  function renderModes() {
    modesScreen.innerHTML = "";
    openSetup = null;
    modesScreen.append(
      el("h2", { text: t("Choose a mode") }),
      el("div", { class: "pf-mode-grid" },
        MODE_DEFS.map((m) => el("button", {
          class: "pf-card pf-mode-card",
          onclick: () => { audio.play("ui-select"); selectMode(m.id); },
        }, [
          el("strong", { text: t(m.name) }),
          el("span", { text: t(m.desc) }),
        ]))),
      el("div", { class: "pf-setup", id: "pf-setup", hidden: true }),
      el("button", { class: "pf-btn pf-btn-secondary", text: t("Back"), onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } })
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
    openSetup = id;
    const def = MODE_DEFS.find((m) => m.id === id);
    setup.append(el("h3", { text: t("{mode} setup", { mode: t(def.name) }) }),
      el("dl", { class: "pf-setup-facts" }, [
        el("dt", { text: t("Rules") }), el("dd", { text: t(def.desc) }),
        el("dt", { text: t("Expected duration") }), el("dd", { text: t(def.duration) }),
        el("dt", { text: t("Ranked") }), el("dd", { text: def.ranked ? t("Yes — verified replays") : t("No — unranked") }),
      ]));

    if (id === "practice") {
      const filter = el("select", { class: "pf-input", "aria-label": t("Difficulty filter") },
        [el("option", { value: "0", text: t("All difficulties") })]
          .concat([1, 2, 3, 4, 5].map((d) => el("option", { value: String(d), text: t("Difficulty {n}", { n: d }) }))));
      const list = el("div", { class: "pf-level-list" });
      const renderList = () => {
        list.innerHTML = "";
        const maxD = Number(filter.value);
        const unlocked = JOURNEY_LEVELS.filter((l, i) =>
          (i === 0 || progress.completed[JOURNEY_LEVELS[i - 1].id]) &&
          (!maxD || l.difficulty === maxD));
        for (const l of unlocked) {
          list.append(el("button", {
            class: "pf-chip", text: levelName(l),
            onclick: () => { audio.play("ui-select"); startLevel(l, "practice", { practice: true }); },
          }));
        }
        if (!unlocked.length) list.append(el("p", { text: t("No unlocked levels at this difficulty yet.") }));
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
          text: levelName(l) + (progress.completed[l.id] ? " ✓" : ""),
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

  const tray = el("div", { class: "pf-tray", role: "toolbar", i18nAria: "Chamber actions" });

  playScreen.append(
    el("aside", { class: "pf-rail pf-rail-left" }, [
      hudObjective, hudProgress, hudBudget, hudTime, hudPhase, hudError,
      el("button", { class: "pf-btn pf-btn-secondary", i18n: "Pause (Esc)", onclick: () => pauseGame() }),
      el("button", { class: "pf-btn pf-btn-secondary", i18n: "Help", onclick: () => openHelp("play") }),
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
    hudObjective.textContent = t(st.goals.total > 1 ? "{level} — deliver {n} payloads" : "{level} — deliver 1 payload", { level: levelName(currentLevel), n: st.goals.total });
    hudProgress.textContent = t("Delivered: {done} / {total}", { done: st.goals.delivered, total: st.goals.total });
    hudBudget.textContent = t("Spawns left: {left} / {total}", { left: st.spawnBudget - st.movesUsed, total: st.spawnBudget });
    hudPhase.textContent = t(session.paused ? "Phase: {phase} (paused)" : "Phase: {phase}", { phase: t("phase." + st.phase) });
    if (st.phase === "run" && st.runStartTick !== null) {
      hudTime.hidden = false;
      hudTime.textContent = t("Time left: {time}", { time: fmtTime(currentLevel.timeLimitTicks - (st.tick - st.runStartTick)) });
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
    const building = st.phase === "build";

    const matRow = el("div", { class: "pf-tray-row", role: "group", "aria-label": t("Materials") });
    currentLevel.allowedMaterials.forEach((m, i) => {
      const a = legal["spawn:" + m] || { ok: false };
      const b = el("button", {
        class: "pf-btn pf-mat" + (selectedMaterial === m ? " pf-selected" : ""),
        text: t(MATERIALS[m].name) + " (" + (i + 1) + ")",
        "aria-pressed": selectedMaterial === m ? "true" : "false",
        title: a.ok ? t("Select {material}", { material: t(MATERIALS[m].name) }) : (a.reason ? reasonText(a.reason) : ""),
        onclick: (ev) => { selectedMaterial = m; audio.play("ui-select"); renderTray(); ev.currentTarget.focus(); },
      });
      b.style.setProperty("--mat-color", MATERIALS[m].color);
      matRow.append(b);
    });

    const spawnBtn = el("button", {
      class: "pf-btn pf-btn-primary",
      text: t("Spawn at cursor (Enter)"),
      disabled: !building,
      onclick: (ev) => { guard(ev.currentTarget); trySpawn(cursor.x, cursor.y); },
    });

    const actRow = el("div", { class: "pf-tray-row", role: "group", "aria-label": t("Actions") });
    if (currentLevel.allowedJoints.length) {
      for (const j of currentLevel.allowedJoints) {
        actRow.append(el("button", {
          class: "pf-btn" + (jointMode && selectedJoint === j ? " pf-selected" : ""),
          text: t(JOINT_TYPES[j].name) + " (J)",
          "aria-pressed": jointMode && selectedJoint === j ? "true" : "false",
          onclick: () => {
            selectedJoint = j;
            jointMode = !(jointMode && selectedJoint === j);
            jointAnchor = null;
            audio.play("ui-select");
            announce(jointMode ? t("{joint} mode: select two bodies", { joint: t(JOINT_TYPES[j].name) }) : t("Joint mode off"));
            renderTray();
          },
        }));
      }
    }
    actRow.append(
      el("button", {
        class: "pf-btn", text: t("Delete selected (Del)"),
        disabled: !building || !selectedBody,
        onclick: (ev) => { guard(ev.currentTarget); deleteSelected(); },
      }),
      el("button", {
        class: "pf-btn", text: t("Undo (U)"),
        disabled: !session.canUndo,
        onclick: (ev) => { guard(ev.currentTarget); doUndo(); },
      }),
      el("button", {
        class: "pf-btn pf-btn-go", text: building ? t("Run (R)") : t("Running…"),
        disabled: !building,
        onclick: (ev) => { guard(ev.currentTarget); doRun(); },
      })
    );

    const cursorRow = el("div", { class: "pf-tray-row pf-cursor-ctl", role: "group", "aria-label": t("Move spawn cursor") });
    const move = (dx, dy) => () => { moveCursor(dx, dy); };
    // DOM order left, up, down, right; CSS places them as a d-pad (or one row on phones)
    cursorRow.append(
      el("button", { class: "pf-btn pf-btn-sm pf-cur-l", text: "←", "aria-label": t("Cursor left"), onclick: move(-1, 0) }),
      el("button", { class: "pf-btn pf-btn-sm pf-cur-u", text: "↑", "aria-label": t("Cursor up"), onclick: move(0, 1) }),
      el("button", { class: "pf-btn pf-btn-sm pf-cur-d", text: "↓", "aria-label": t("Cursor down"), onclick: move(0, -1) }),
      el("button", { class: "pf-btn pf-btn-sm pf-cur-r", text: "→", "aria-label": t("Cursor right"), onclick: move(1, 0) }),
    );

    // The HUD refreshes every frame of a run: swap the tray only when its
    // controls changed. A swap between press and release would lose the click
    // (the release lands on a new button), so an unchanged tray keeps its nodes.
    const next = el("div", {}, [matRow, spawnBtn, actRow, cursorRow]);
    if (next.innerHTML === tray.innerHTML) return;
    const focusAt = [...tray.querySelectorAll("button")].indexOf(document.activeElement);
    tray.replaceChildren(...next.childNodes);
    // keyboard focus stays on the control in the same place
    if (focusAt >= 0) tray.querySelectorAll("button")[focusAt]?.focus({ preventScroll: true });
  }

  function moveCursor(dx, dy) {
    cursor.x = Math.max(0.5, Math.min(CHAMBER.w - 0.5, cursor.x + dx * 0.5));
    cursor.y = Math.max(0.5, Math.min(CHAMBER.h - 0.5, cursor.y + dy * 0.5));
    if (renderer) {
      renderer.setCursor(cursor.x, cursor.y);
      updateGhost();
    }
    announce(t("Cursor {x}, {y}", { x: cursor.x.toFixed(1), y: cursor.y.toFixed(1) }));
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
    if (res.error) flashError(t("Cannot spawn: {reason}", { reason: reasonText(res.error.message) }));
    return res;
  }

  function deleteSelected() {
    if (!session || !selectedBody) return;
    const res = session.dispatch({ type: "delete", target: selectedBody });
    if (res.error) flashError(t("Cannot delete: {reason}", { reason: reasonText(res.error.message) }));
    else selectedBody = null;
  }

  function doUndo() {
    if (!session) return;
    const r = session.undo();
    if (!r.ok) flashError(t("Nothing to undo"));
    else { audio.play("undo"); announce(t("Undid {action}", { action: t("action." + r.undone.type) })); refreshHud(); }
  }

  function doRun() {
    if (!session) return;
    const res = session.dispatch({ type: "run" });
    if (res.error) { flashError(t("Cannot run: {reason}", { reason: reasonText(res.error.message) })); return; }
    runStartWall = performance.now();
    runAccum = 0;
    lastTickWarned = null;
    selectedBody = null;
    jointMode = false;
    jointAnchor = null;
    audio.play("run-start");
    audio.setPhase("run");
    announce(t("Simulation running"));
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
          announce(t("First body selected; pick a second body"));
        } else {
          const res = session.dispatch({ type: "joint", joint: selectedJoint, a: jointAnchor, b: pick.id });
          if (res.error) flashError(t("Cannot connect: {reason}", { reason: reasonText(res.error.message) }));
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
        announce(t(b && b.kind === "payload" ? "Selected {body} payload" : "Selected {body}", { body: b ? t(MATERIALS[b.material].name) : t("body") }));
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
  // Keep Tab focus inside an open modal dialog.
  function trapTab(overlay, ev) {
    const items = [...overlay.querySelectorAll("button, input, select, textarea, a[href]")]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !overlay.contains(active);
    if (ev.shiftKey && (outside || active === first)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (outside || active === last)) { ev.preventDefault(); first.focus(); }
  }

  // Any real pointer gesture anywhere (menus included) unlocks audio, so UI
  // taps sound immediately without waiting for a canvas pick.
  document.addEventListener("pointerdown", () => audio.unlock());

  // Keyboard bindings: declared as control.* in starhermit.txt; the player's
  // StarHermit overrides replace these defaults when signed in.
  const DEFAULT_BINDINGS = {
    cursor_up: ["ArrowUp", "KeyW"],
    cursor_down: ["ArrowDown", "KeyS"],
    cursor_left: ["ArrowLeft", "KeyA"],
    cursor_right: ["ArrowRight", "KeyD"],
    spawn: ["Enter", "NumpadEnter", "Space"],
    material_1: ["Digit1", "Numpad1"],
    material_2: ["Digit2", "Numpad2"],
    material_3: ["Digit3", "Numpad3"],
    material_4: ["Digit4", "Numpad4"],
    joint: ["KeyJ"],
    delete: ["Delete", "Backspace"],
    run: ["KeyR"],
    undo: ["KeyU"],
    reframe: ["KeyC"],
    pause: ["Escape"],
  };
  let bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  function actionFor(code) {
    for (const [action, codes] of Object.entries(bindings)) if (codes.includes(code)) return action;
    return null;
  }
  function keyName(code) {
    const named = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Space: "Space", NumpadEnter: "Num Enter" };
    if (named[code]) return named[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return "Num " + code.slice(6);
    return code;
  }
  const keysFor = (...actions) => actions.map((a) => (bindings[a] || []).map(keyName).join(" / ")).join(" · ");

  document.addEventListener("keydown", (ev) => {
    // Overlays are modal and can be open over any screen (settings is also
    // reachable from the title), so they are handled before the play checks.
    const overlay = settingsOverlay || pauseOverlay;
    if (overlay) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (overlay === settingsOverlay) {
          closeOverlays();
          if (session && session.paused) openPause();
        } else {
          resumeGame();
        }
      } else if (ev.key === "Tab") {
        trapTab(overlay, ev);
      }
      return;
    }
    if (screens.play.hidden) {
      // Escape backs out of the secondary screens.
      if (ev.key === "Escape") {
        if (!screens.help.hidden) { ev.preventDefault(); audio.play("ui-back"); backFromHelp(); }
        else if (!screens.modes.hidden || !screens.progression.hidden || !screens.scores.hidden) {
          ev.preventDefault(); audio.play("ui-back"); renderTitle(); showScreen("title");
        }
      }
      return;
    }
    const k = actionFor(ev.code);
    const handled = () => { ev.preventDefault(); audio.unlock(); };
    if (k === "cursor_up") { handled(); moveCursor(0, 1); }
    else if (k === "cursor_down") { handled(); moveCursor(0, -1); }
    else if (k === "cursor_left") { handled(); moveCursor(-1, 0); }
    else if (k === "cursor_right") { handled(); moveCursor(1, 0); }
    else if (k === "spawn") { handled(); trySpawn(cursor.x, cursor.y); }
    else if (k === "joint") {
      handled();
      if (currentLevel.allowedJoints.length) {
        jointMode = true;
        jointAnchor = null;
        announce(t("{joint} mode: select two bodies", { joint: t(JOINT_TYPES[selectedJoint].name) }));
        renderTray();
      }
    }
    else if (k === "delete") { handled(); deleteSelected(); }
    else if (k === "run") { handled(); doRun(); }
    else if (k === "undo") { handled(); doUndo(); }
    else if (k === "pause") {
      handled();
      if (jointMode) { jointMode = false; jointAnchor = null; renderTray(); }
      else pauseGame();
    }
    else if (k === "reframe") { handled(); if (renderer && renderer.frameChamber) renderer.frameChamber(); announce(t("Camera re-framed")); }
    else if (/^material_[1-4]$/.test(k || "")) {
      const i = Number(k.slice(-1)) - 1;
      if (currentLevel.allowedMaterials[i]) {
        handled();
        selectedMaterial = currentLevel.allowedMaterials[i];
        audio.play("ui-select");
        renderTray();
      }
    }
  });
  document.addEventListener("keyup", (ev) => {
    if (actionFor(ev.code) === "joint" && settings.jointMode === "hold") {
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
          else if (e.type === "reset") announce(t("Reset to build phase"));
        }
        checkLessonProgress(ev.cmd);
        refreshHud();
        updateGhost();
      } else if (ev.type === "command-error") {
        flashError(t("Illegal action: {reason}", { reason: reasonText(ev.error.message) }));
        refreshHud(); // invalid action counter changed
      } else if (ev.type === "step") {
        for (const e of ev.events) {
          if (renderer) renderer.emitEvent(e);
          if (e.type === "shatter") audio.play("shatter");
          else if (e.type === "destroyed") audio.play("impact", { material: "steel", strength: 8, avSeed: s.state.tick });
          else if (e.type === "delivered") { audio.play("goal"); announce(t("Payload delivered")); }
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
      renderLessonBanner();
      if (!progress.lessonsDone[currentLevel.id]) {
        progress.lessonsDone[currentLevel.id] = true;
        saveProgress();
        toast(t("Lesson complete: {name}", { name: levelName(currentLevel) }), "ok");
        if (LEARN_LESSONS.every((l) => progress.lessonsDone[l.id])) unlockAchievement("mechanic-mastery");
      }
    } else {
      renderLessonBanner();
    }
  }

  function renderLessonBanner(quiet) {
    const step = currentLevel.steps[lessonStep];
    lessonBanner.innerHTML = "";
    if (lessonStep >= currentLevel.steps.length) {
      lessonBanner.hidden = false;
      lessonBanner.append(el("p", { text: t("Lesson complete! Finish the delivery or move on.") }),
        el("button", { class: "pf-btn pf-btn-primary", text: t("Next lesson"), onclick: () => startLearn((currentCtx.lessonIndex + 1) % LEARN_LESSONS.length) }));
      return;
    }
    lessonBanner.hidden = !step;
    if (step) {
      lessonBanner.append(
        el("strong", { text: t("Lesson {n}/{total}", { n: currentCtx.lessonIndex + 1, total: LEARN_LESSONS.length }) }),
        el("p", { text: t(step.text) }));
      if (!quiet) announce(t(step.text));
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

    lastResults = { won, score, durationMs, prevBest, newBest, firstWin, reason: st.terminalReason, lb: null };
    submitResult(lastResults);
    renderResults(lastResults);
    setTimeout(() => showScreen("results"), 900);
  }

  function unlockAchievement(key) {
    if (progress.achievements.includes(key)) return;
    progress.achievements.push(key);
    saveProgress();
    const a = ACHIEVEMENTS[key];
    toast(t("Achievement unlocked: {name}", { name: a ? t(a.name) : key }), "ok");
    audio.play("achievement");
  }

  const resultsScreen = makeScreen("results");
  let lastResults = null; // the shown results (re-rendered on a language change)

  function isRankedPost() {
    const ranked = (currentMode === "journey" || currentMode === "daily" || currentMode === "challenge")
      && !currentCtx.practice;
    return ranked && (currentMode === "journey" || currentMode === "daily");
  }

  // Signed in: post the total to the platform board once; the results line
  // reads r.lb so a re-render never posts again.
  function submitResult(r) {
    if (!isRankedPost() || !platform.isHosted() || typeof platform.submitScore !== "function") return;
    r.lb = { state: "posting" };
    platform.submitScore(r.score.total).then((res) => {
      r.lb = !res.posted ? { state: "notPosted" } : res.rank ? { state: "rank", rank: res.rank } : { state: "posted" };
      const line = r === lastResults && resultsScreen.querySelector(".pf-lb");
      if (line) line.textContent = lbText(r.lb);
    });
  }
  function lbText(lb) {
    if (lb.state === "posting") return ps.lbPosting;
    if (lb.state === "notPosted") return ps.lbNotPosted;
    if (lb.state === "rank") return ps.lbRank.replace("{rank}", lb.rank);
    return ps.lbPosted;
  }

  function renderResults(r) {
    resultsScreen.innerHTML = "";
    const c = r.score.components;
    const rows = [
      ["Goal", c.goal], ["Time bonus", c.timeBonus],
      ["Material efficiency", c.materialEfficiency], ["Spawn efficiency", c.spawnEfficiency],
      ["Invalid-action penalty", c.invalidPenalty],
    ];
    const table = el("table", { class: "pf-score-table" }, [
      el("caption", { text: t("Score breakdown") }),
      ...rows.map(([k, v]) => el("tr", {}, [el("th", { scope: "row", text: t(k) }), el("td", { text: String(v) })])),
      el("tr", { class: "pf-total" }, [el("th", { scope: "row", text: t("Total") }), el("td", { text: String(r.score.total) })]),
    ]);

    const earned = progress.achievements.slice(-3).map((k) => ACHIEVEMENTS[k]).filter(Boolean);

    const submitWrap = el("div", { class: "pf-submit" });
    if (isRankedPost()) {
      if (r.lb) submitWrap.append(el("p", { class: "pf-note pf-lb", text: lbText(r.lb) }));
      else submitWrap.append(el("p", { class: "pf-note", text: t("Ranked run recorded on this device.") }));
    } else {
      submitWrap.append(el("p", { class: "pf-note", text: t("Unranked session — no leaderboard submission.") }));
    }

    resultsScreen.append(
      el("h2", { text: r.won ? t("Delivery complete") : t("Run failed") }),
      el("p", { class: "pf-note", text: t("Reason: {reason}", { reason: TERMINAL_TEXT[r.reason] ? t(TERMINAL_TEXT[r.reason]) : (r.reason || t("unknown")) }) }),
      table,
      el("p", { class: "pf-note", text: r.newBest ? t("New local best! (previous {n})", { n: r.prevBest }) : t("Local best: {n}", { n: Math.max(r.prevBest, r.score.total) }) }),
      earned.length ? el("p", { class: "pf-note", text: t("Achievements: {list}", { list: earned.map((a) => t(a.name)).join(", ") }) }) : null,
      submitWrap,
      el("div", { class: "pf-btn-row" }, [
        el("button", {
          class: "pf-btn", text: t("Retry"),
          onclick: () => { analytics("retry", { level: currentLevel.id }); audio.play("ui-select"); restartCurrent(); },
        }),
        nextActionButton(),
        el("button", {
          class: "pf-btn pf-btn-secondary", text: t("Modes"),
          onclick: () => { audio.play("ui-back"); teardownPlay(); renderModes(); showScreen("modes"); },
        }),
      ])
    );
    if (!r.announced) { r.announced = true; announce(t(r.won ? "Won with {n} points" : "Lost with {n} points", { n: r.score.total })); }
  }

  function nextActionButton() {
    if (currentMode === "learn") {
      return el("button", {
        class: "pf-btn pf-btn-primary", text: t("Next lesson"),
        onclick: () => startLearn((currentCtx.lessonIndex + 1) % LEARN_LESSONS.length),
      });
    }
    if (currentMode === "journey") {
      const idx = JOURNEY_LEVELS.findIndex((l) => l.id === currentLevel.id);
      if (idx >= 0 && idx + 1 < JOURNEY_LEVELS.length) {
        return el("button", {
          class: "pf-btn pf-btn-primary", text: t("Next chamber"),
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
    date = d.date; seed = d.seed;
    dailyInfo = d;
    const level = dailyLevel(date);
    if (progress.dailyAttempts[date]) {
      toast(t("Daily already attempted today — playing unranked practice run"), "info");
      return startLevel(level, "daily", { daily: { date }, practice: true });
    }
    startLevel(level, "daily", { daily: { date } });
  }

  function restartCurrent() {
    // The daily allows one ranked attempt; any retry after it is scored
    // locally but never submitted.
    const ctx = { ...currentCtx };
    if (ctx.daily && progress.dailyAttempts[ctx.daily.date]) ctx.practice = true;
    startLevel(currentLevel, currentMode, ctx);
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
    announce(levelName(level) + ". " + (level.intro ? t(level.intro) : ""));
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
    refreshHud();
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
    pauseOverlay = el("div", { class: "pf-overlay", role: "dialog", "aria-modal": "true", i18nAria: "Paused" }, [
      el("div", { class: "pf-panel" }, [
        el("h2", { i18n: "Paused" }),
        el("button", { class: "pf-btn pf-btn-primary pf-btn-big", i18n: "Resume", onclick: resumeGame }),
        el("button", { class: "pf-btn", i18n: "Settings", onclick: openSettings }),
        el("button", { class: "pf-btn", i18n: "Help", onclick: () => openHelp("pause") }),
        el("button", {
          class: "pf-btn", i18n: "Restart chamber",
          onclick: () => { audio.play("ui-select"); closeOverlays(); restartCurrent(); },
        }),
        el("button", {
          class: "pf-btn pf-btn-secondary", i18n: "Leave chamber",
          onclick: () => { teardownPlay(); renderTitle(); showScreen("title"); },
        }),
      ]),
    ]);
    root.append(pauseOverlay);
    pauseOverlay.querySelector("button").focus();
  }

  // ------------------------------------------------------------ settings
  // Profile line for the settings panel: platform account when hosted, local
  // guest otherwise. Identity always comes from the account profile.
  function profileNote() {
    if (platform.isHosted()) {
      return t("Playing as {name} — progress syncs to your account ({status}).",
        { name: platform.getNickname() || "…", status: t("sync." + platform.getSyncStatus()) });
    }
    return t("Local guest profile — progress stays in this browser.");
  }

  // Graphics section: quality preset, render scale, per-effect overrides,
  // adaptive resolution, frame-rate readout and a GPU / cost summary line.
  // Every change applies live and is saved with the other settings.
  function buildGraphicsSection() {
    const g = gfxSaved();
    const gpu = probeGpu();
    const tierName = (p) => tg(p);
    const section = el("section", { class: "pf-gfx", id: "pf-gfx-section", "aria-labelledby": "pf-gfx-head" });

    const presetSel = el("select", { class: "pf-input", id: "pf-gfx-preset", "data-gfx": "preset", "aria-label": tg("quality"), "data-tg-aria": "quality" });
    const scaleIn = el("input", { type: "range", id: "pf-gfx-scale", "data-gfx": "render_scale", min: "50", max: "200", step: "5", "aria-label": tg("renderScale"), "data-tg-aria": "renderScale" });
    const scaleOut = el("output", { class: "pf-gfx-val", for: "pf-gfx-scale" });
    const catSels = {};
    const adaptiveIn = el("input", { type: "checkbox", id: "pf-gfx-adaptive", "data-gfx": "adaptive", "aria-label": tg("adaptive"), "data-tg-aria": "adaptive" });
    const fpsIn = el("input", { type: "checkbox", id: "pf-gfx-fps", "data-gfx": "show_fps", "aria-label": tg("showFps"), "data-tg-aria": "showFps" });
    const summary = el("p", { class: "pf-note pf-gfx-summary", id: "pf-gfx-summary", "aria-live": "polite" });
    const note = el("p", { class: "pf-note pf-gfx-note", id: "pf-gfx-note", text: tg("postFailed"), "data-tg": "postFailed" });
    note.hidden = true;

    function fillOptions() {
      const r = resolveGfx(g, gpu.detected, gpu.level);
      presetSel.replaceChildren(
        el("option", { value: "auto", text: tg("auto", { tier: tierName(gpu.detected) }) }),
        ...PRESETS.map((p) => el("option", { value: p, text: tierName(p) })));
      presetSel.value = PRESETS.includes(g.preset) ? g.preset : "auto";
      for (const [cat, sel] of Object.entries(catSels)) {
        const tiers = CATEGORIES[cat];
        sel.replaceChildren(
          el("option", { value: "preset", text: tg("fromPreset", { tier: tg("t_" + presetTier(r.preset, cat)) }) }),
          ...tiers.map((t) => el("option", { value: t, text: tg("t_" + t) })));
        sel.value = tiers.includes(g[cat]) ? g[cat] : "preset";
      }
      const pct = Math.round((Number(g.render_scale) || 1) * 100);
      scaleIn.value = String(Math.min(200, Math.max(50, pct)));
      scaleOut.textContent = scaleIn.value + "%";
      adaptiveIn.checked = g.adaptive !== false;
      fpsIn.checked = !!g.show_fps;
    }

    function refreshSummary() {
      const r = resolveGfx(g, gpu.detected, gpu.level);
      let pixels;
      let postFailed = false;
      // live numbers only while the chamber canvas is on screen
      const info = renderer && renderer.graphicsInfo && canvas.clientWidth > 0 ? renderer.graphicsInfo() : null;
      if (info && info.pixels[0] > 0) { pixels = info.pixels; postFailed = info.postFailed; }
      else {
        const ratio = Math.min(window.devicePixelRatio || 1, r.dprCap) * r.scale;
        pixels = [Math.round(window.innerWidth * ratio), Math.round(window.innerHeight * ratio)];
      }
      summary.textContent = (gpu.name || tg("unknownGpu")) + " · " + tg("level", { n: gpu.level }) + " · " + describeLocalized(tg, r, SHADOW_MAP, pixels)
        + (info && info.fps ? " · " + info.fps + " fps" : "");
      note.hidden = !(postFailed && r.post);
    }

    function commit() {
      saveSettings();
      applyGraphics();
      refreshSummary();
    }

    presetSel.addEventListener("change", () => {
      // choosing a preset clears the per-effect overrides
      const next = choosePreset(g, presetSel.value);
      for (const k of Object.keys(g)) delete g[k];
      Object.assign(g, next);
      fillOptions();
      commit();
      audio.play("ui-select");
    });
    scaleIn.addEventListener("input", () => {
      g.render_scale = Number(scaleIn.value) / 100;
      scaleOut.textContent = scaleIn.value + "%";
      commit();
    });
    adaptiveIn.addEventListener("change", () => { g.adaptive = adaptiveIn.checked; commit(); });
    fpsIn.addEventListener("change", () => { g.show_fps = fpsIn.checked; commit(); });

    const rows = [];
    for (const cat of Object.keys(CATEGORIES)) {
      const sel = el("select", { class: "pf-input", id: "pf-gfx-" + cat, "data-gfx-cat": cat, "aria-label": tg("cat_" + cat), "data-tg-aria": "cat_" + cat });
      sel.addEventListener("change", () => {
        if (sel.value === "preset") delete g[cat];
        else g[cat] = sel.value;
        commit();
      });
      catSels[cat] = sel;
      rows.push(el("label", { class: "pf-field pf-gfx-row" }, [el("span", { text: tg("cat_" + cat), "data-tg": "cat_" + cat }), sel]));
    }

    section.append(
      el("h3", { id: "pf-gfx-head", text: tg("graphics"), "data-tg": "graphics" }),
      el("label", { class: "pf-field pf-gfx-row" }, [el("span", { text: tg("quality"), "data-tg": "quality" }), presetSel]),
      el("label", { class: "pf-field pf-gfx-row pf-gfx-scale" }, [el("span", { text: tg("renderScale"), "data-tg": "renderScale" }), scaleIn, scaleOut]),
      ...rows,
      el("label", { class: "pf-field pf-check" }, [adaptiveIn, el("span", { text: tg("adaptive"), "data-tg": "adaptive" })]),
      el("label", { class: "pf-field pf-check" }, [fpsIn, el("span", { text: tg("showFps"), "data-tg": "showFps" })]),
      summary,
      note,
    );
    fillOptions();
    refreshSummary();
    // Language change: relabel this section's own controls in place (the shared
    // Sound / Language / Report sections mounted inside it relabel themselves).
    section.relabel = () => {
      for (const n of section.querySelectorAll("[data-tg]")) n.textContent = tg(n.dataset.tg);
      for (const n of section.querySelectorAll("[data-tg-aria]")) n.setAttribute("aria-label", tg(n.dataset.tgAria));
      fillOptions();
      refreshSummary();
    };
    const timer = setInterval(() => {
      if (!section.isConnected) { clearInterval(timer); return; }
      refreshSummary();
    }, 1000);
    return section;
  }

  function openSettings() {
    closeOverlays();
    const s = settings;

    const slider = (label, bus) => {
      const input = el("input", {
        type: "range", min: "0", max: "1", step: "0.05",
        value: String(audio.getBusVolume(bus)), i18nAria: label + " volume",
      });
      input.addEventListener("input", () => {
        audio.unlock();
        audio.setBusVolume(bus, Number(input.value));
        s[bus] = Number(input.value);
        saveSettings();
      });
      return el("label", { class: "pf-field" }, [el("span", { i18n: label }), input]);
    };

    const toggle = (label, key, onchange) => {
      const input = el("input", { type: "checkbox", i18nAria: label });
      input.checked = !!s[key];
      input.addEventListener("change", () => {
        s[key] = input.checked;
        saveSettings();
        applyA11yClasses();
        if (onchange) onchange(input.checked);
        audio.play("ui-select");
      });
      return el("label", { class: "pf-field pf-check" }, [input, el("span", { i18n: label })]);
    };

    const gfxSection = buildGraphicsSection();

    const camSel = el("select", { class: "pf-input", i18nAria: "Camera default" },
      [el("option", { value: "frame", i18n: "Full chamber" }), el("option", { value: "tight", i18n: "Tight frame" })]);
    camSel.value = s.cameraDefault;
    camSel.addEventListener("change", () => {
      s.cameraDefault = camSel.value;
      saveSettings();
      if (renderer && renderer.setFraming) renderer.setFraming(camSel.value === "tight" ? 0.02 : 0.1);
    });

    const jointSel = el("select", { class: "pf-input", i18nAria: "Joint mode behavior" },
      [el("option", { value: "toggle", i18n: "Toggle (press J)" }), el("option", { value: "hold", i18n: "Hold (hold J)" })]);
    jointSel.value = s.jointMode;
    jointSel.addEventListener("change", () => { s.jointMode = jointSel.value; saveSettings(); });

    settingsOverlay = el("div", { class: "pf-overlay", role: "dialog", "aria-modal": "true", i18nAria: "Settings" }, [
      el("div", { class: "pf-panel pf-settings" }, [
        el("h2", { i18n: "Settings" }),
        el("h3", { i18n: "Profile" }),
        el("p", { class: "pf-note pf-profile-note", text: profileNote() }),
        el("h3", { i18n: "Audio" }),
        slider("Music", "music"), slider("Effects", "effects"), slider("Ambience", "ambience"), slider("Voice", "voice"),
        toggle("Mute all", "muted", (v) => audio.setMuted(v)),
        gfxSection,
        el("h3", { i18n: "Display" }),
        el("label", { class: "pf-field" }, [el("span", { i18n: "Camera default" }), camSel]),
        toggle("Reduced motion", "reducedMotion", (v) => { if (renderer) renderer.setReducedMotion(v); }),
        toggle("High contrast", "highContrast"),
        toggle("Larger text", "largeText"),
        el("h3", { i18n: "Controls" }),
        toggle("Left-handed action tray", "leftHanded"),
        el("label", { class: "pf-field" }, [el("span", { i18n: "Joint mode" }), jointSel]),
        toggle("Haptics (vibration)", "haptics"),
        el("h3", { i18n: "Other" }),
        toggle("Share anonymous usage events", "consentAnalytics"),
        el("button", {
          class: "pf-btn", i18n: "Replay tutorial",
          onclick: () => { progress.lessonsDone = {}; saveProgress(); closeOverlays(); startLearn(0); },
        }),
        el("button", { class: "pf-btn pf-btn-primary", i18n: "Done", onclick: () => { closeOverlays(); if (session && session.paused) openPause(); } }),
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
          text: (i + 1) + ". " + levelName(l) + (star ? " ★" : "") + (mastery ? " ◆" : ""),
          onclick: () => { audio.play("ui-select"); startJourney(i); },
        }),
      ]);
      list.append(item);
    });
    const lessons = el("div", { class: "pf-level-list" },
      LEARN_LESSONS.map((l, i) => el("button", {
        class: "pf-chip",
        text: t("Lesson {n}", { n: i + 1 }) + (progress.lessonsDone[l.id] ? " ✓" : ""),
        onclick: () => { audio.play("ui-select"); startLearn(i); },
      })));
    const achList = el("ul", { class: "pf-ach" },
      Object.values(ACHIEVEMENTS).map((a) => el("li", {
        class: progress.achievements.includes(a.key) ? "pf-ach-on" : "pf-ach-off",
        text: (progress.achievements.includes(a.key) ? "★ " : "☆ ") + t(a.name) + " — " + t(a.description),
      })));
    progressionScreen.append(
      el("h2", { text: t("Progression") }),
      el("h3", { text: t("Journey ({summary})", { summary: journeyProgressSummary() }) }),
      list,
      el("h3", { text: t("Lessons") }),
      lessons,
      el("h3", { text: t("Achievements") }),
      achList,
      el("p", { class: "pf-note", text: t("Lifetime spawns: {spawns} · Wins: {wins} · Current streak: {streak}", progress.counters) }),
      el("button", { class: "pf-btn pf-btn-secondary", text: t("Back"), onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } })
    );
  }

  // ------------------------------------------------------------ help screen
  const helpScreen = makeScreen("help");

  function renderHelp() {
    helpScreen.innerHTML = "";
    const keys = [
      [keysFor("cursor_up", "cursor_left", "cursor_down", "cursor_right"), t("Move the spawn cursor")],
      [keysFor("spawn"), t("Spawn selected material at cursor")],
      [keysFor("material_1", "material_2", "material_3", "material_4"), t("Select material 1-4")],
      [keysFor("joint"), t(settings.jointMode === "hold" ? "Joint mode (hold), then pick two bodies" : "Joint mode (toggle), then pick two bodies")],
      [keysFor("delete"), t("Remove selected body")],
      [keysFor("run"), t("Run the simulation")],
      [keysFor("undo"), t("Undo last build action")],
      [keysFor("reframe"), t("Re-frame camera")],
      [keysFor("pause"), t("Pause / cancel joint mode")],
    ];
    helpScreen.append(
      el("h2", { text: t("How to play") }),
      el("p", { text: t("Build phase: spawn balls and connect them with joints. Run phase: gravity takes over — deliver every payload (outlined ball) into a pulsing target ring. Glass shatters on hard impacts; hazard strips destroy anything.") }),
      el("h3", { text: t("Controls") }),
      el("div", { class: "pf-cards" }, keys.map(([k, v]) =>
        el("div", { class: "pf-card" }, [el("strong", { text: k }), el("span", { text: v })]))),
      el("h3", { text: t("Materials") }),
      el("div", { class: "pf-cards" }, Object.values(MATERIALS).map((m) =>
        el("div", { class: "pf-card" }, [
          el("strong", { text: t(m.name) }),
          el("span", { text: t(m.shatterSpeed ? "Density {d}, bounce {b}, shatters above impact {s}" : "Density {d}, bounce {b}", { d: m.density, b: m.restitution, s: m.shatterSpeed }) }),
        ]))),
      el("h3", { text: t("Joints") }),
      el("div", { class: "pf-cards" }, Object.values(JOINT_TYPES).map((j) =>
        el("div", { class: "pf-card" }, [
          el("strong", { text: t(j.name) }),
          el("span", { text: t(j.stiffness ? "Max length {n}, stiffness {s}" : "Max length {n}, rigid distance lock", { n: j.maxLength, s: j.stiffness }) }),
        ]))),
      el("button", { class: "pf-btn pf-btn-secondary", text: t("Back"), onclick: () => { audio.play("ui-back"); backFromHelp(); } })
    );
  }

  // Help is reachable from the title, from the play HUD, and from the pause
  // panel; each entry point must be returned to. Opening it mid-run pauses the
  // simulation so the clock cannot expire while the player reads.
  let helpReturn = "title";
  let helpPaused = false;

  function openHelp(from) {
    helpReturn = session && (from === "play" || from === "pause") ? from : "title";
    if (helpReturn === "play" && !session.paused) {
      helpPaused = true;
      session.setPaused(true);
      if (renderer) renderer.setPaused(true);
      refreshHud();
    }
    closeOverlays();
    renderHelp();
    showScreen("help");
  }

  function backFromHelp() {
    if (helpReturn === "pause" && session) {
      showScreen("play");
      openPause();
    } else if (helpReturn === "play" && session) {
      showScreen("play");
      if (helpPaused) {
        helpPaused = false;
        session.setPaused(false);
        if (renderer) renderer.setPaused(false);
      }
      refreshHud();
    } else {
      renderTitle();
      showScreen("title");
    }
    helpReturn = "title";
    helpPaused = false;
  }

  // ------------------------------------------------------------ score chase / leaderboards
  const scoresScreen = makeScreen("scores");
  let scoresSeq = 0;

  // Local daily attempts (the offline cache) when no board is reachable.
  function renderLocalDaily(wrap) {
    const days = Object.keys(progress.dailyAttempts || {}).sort().reverse().slice(0, 10);
    if (!days.length) {
      wrap.append(el("p", { class: "pf-note", text: t("No local daily runs yet.") }));
      return;
    }
    wrap.append(el("table", { class: "pf-score-table" }, [
      el("tr", {}, [el("th", { text: t("Day") }), el("th", { text: t("Score") })]),
      ...days.map((d) => el("tr", {}, [
        el("td", { text: d }), el("td", { text: String((progress.dailyAttempts[d] || {}).score ?? 0) }),
      ])),
    ]));
  }

  // Local journey bests when not signed in (no own-server boards).
  function renderLocalBests(wrap) {
    const rows = JOURNEY_LEVELS.filter((l) => progress.bests[l.id]);
    if (!rows.length) {
      wrap.append(el("p", { class: "pf-note", text: t("No local journey bests yet.") }));
      return;
    }
    wrap.append(el("table", { class: "pf-score-table" }, [
      el("tr", {}, [el("th", { text: t("Chamber") }), el("th", { text: t("Best") })]),
      ...rows.map((l) => el("tr", {}, [el("td", { text: levelName(l) }), el("td", { text: String(progress.bests[l.id]) })])),
    ]));
  }

  async function renderScores() {
    scoresScreen.innerHTML = "";
    const seq = ++scoresSeq;
    scoresScreen.append(el("h2", { text: t("Leaderboards") }));
    const boards = el("div", { class: "pf-boards" });
    scoresScreen.append(boards,
      el("button", { class: "pf-btn pf-btn-secondary", text: t("Back"), onclick: () => { audio.play("ui-back"); renderTitle(); showScreen("title"); } }));
    for (const board of ["global", "daily"]) {
      const head = el("h3", { text: board === "global" ? t("Global (Journey)") : t("Daily") });
      const wrap = el("section", { class: "pf-board" }, [head]);
      boards.append(wrap);
      const res = await platform.getLeaderboard(board);
      if (seq !== scoresSeq) return; // a newer render (language change) replaced this one
      if (res.error) {
        if (board === "daily") { renderLocalDaily(wrap); continue; }
        if (res.error === "local") { head.textContent = t("Local bests (Journey)"); renderLocalBests(wrap); continue; }
        wrap.append(el("p", { class: "pf-note", text: t("Board error: {error}", { error: res.error }) }));
        continue;
      }
      // the platform exposes a single read-only board; per-day views stay local
      if (res.hosted && board === "daily") { renderLocalDaily(wrap); continue; }
      if (res.hosted) head.textContent = t("StarHermit leaderboard");
      if (!res.entries || !res.entries.length) {
        wrap.append(el("p", { class: "pf-note", text: t("No entries yet. Be the first.") }));
        continue;
      }
      const t = el("table", { class: "pf-score-table" }, [
        el("tr", {}, [el("th", { text: "#" }), el("th", { text: t("Name") }), el("th", { text: t("Score") }), el("th", { text: t("Goal") })]),
        ...res.entries.map((e, i) => el("tr", {}, [
          el("td", { text: String(i + 1) }), el("td", { text: e.name }),
          el("td", { text: String(e.score) }), el("td", { text: String(e.goal) }),
        ])),
      ]);
      wrap.append(t);
    }
  }

  // ------------------------------------------------------------ daily countdown
  function updateDailyCountdown() {
    const node = titleScreen.querySelector("#pf-daily-cd");
    if (!node) return;
    const now = Date.now();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    const ms = next.getTime() - now;
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    node.textContent = t("Next daily in {h}h {m}m", { h, m });
  }
  setInterval(() => { if (!titleScreen.hidden) updateDailyCountdown(); }, 30000);

  // Platform identity, cloud restore, server time and daily info; every call
  // degrades gracefully when there is no launch token (local play).
  updateNetStatus();
  platform.loadBindings(DEFAULT_BINDINGS).then((b) => { bindings = b; if (!screens.help.hidden) renderHelp(); });
  platform.onAuthChange(({ signedIn }) => {
    if (!signedIn) toast(ps.signedOut);
    updateNetStatus();
    if (!screens.title.hidden) renderTitle();
  });
  platform.fetchProfile().then(updateNetStatus);
  platform.cloudLoad().then(async (doc) => {
    if (doc) applyRemoteDoc(doc);
    // Platform settings KV wins over local values for known preference keys
    // (platform-owned ui.* keys such as ui.language are not game settings).
    const remote = await platform.loadRemoteSettings();
    const picked = {};
    for (const [k, v] of Object.entries(remote)) {
      if (k !== "version" && !k.startsWith("ui.") && k in settings && v != null && typeof v === typeof settings[k]) picked[k] = v;
    }
    if (Object.keys(picked).length) applyRemoteDoc({ settings: picked });
    else platform.syncSettings(settings);
    updateNetStatus();
  });
  platform.getDaily().then((d) => { dailyInfo = d; });

  // Another device saved first: merge its document with ours (progress from
  // both sides, this device's settings and run) and save the merged copy.
  platform.onSaveConflict((remote) => {
    if (remote) applyRemoteDoc(remote, { keepLocalSettings: true });
    else saveProgress();
    updateNetStatus();
  });

  // ------------------------------------------------------------ live language switching
  // Static nodes carry data-i18n / data-i18n-aria; screens built in code are
  // re-rendered in place. The session, run clock and overlays stay as they are.
  onLocaleChange(() => {
    for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
    for (const n of document.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", t(n.dataset.i18nAria));
    updateNetStatus();
    if (session && !screens.play.hidden) {
      refreshHud();
      if (currentMode === "learn" && currentLevel.steps) renderLessonBanner(true);
    }
    if (settingsOverlay) {
      const note = settingsOverlay.querySelector(".pf-profile-note");
      if (note) note.textContent = profileNote();
      const gfx = settingsOverlay.querySelector("#pf-gfx-section");
      if (gfx && gfx.relabel) gfx.relabel();
    }
    if (!screens.title.hidden) renderTitle();
    else if (!screens.modes.hidden) { const id = openSetup; renderModes(); if (id) renderModeSetup(id); }
    else if (!screens.progression.hidden) renderProgression();
    else if (!screens.help.hidden) renderHelp();
    else if (!screens.scores.hidden) renderScores();
    else if (!screens.results.hidden && lastResults) renderResults(lastResults);
  });

  // ------------------------------------------------------------ boot into title
  renderTitle();
  showScreen("title");

  return {
    showScreen,
    getSession: () => session,
    openSettings,
  };
}
