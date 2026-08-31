// Bootstrap: capability detection, storage, module wiring, lifecycle.

import * as audio from "./audio.js";
import * as platform from "./platform.js";
import { init as initUi } from "./ui.js";

// ---------------------------------------------------------------- storage
// Versioned, checksummed localStorage docs (settings and progression are
// separate documents). Checksum: FNV-1a over the JSON payload. On mismatch or
// parse failure we fall back to defaults.

const SETTINGS_KEY = "pf-settings-v1";
const PROGRESS_KEY = "pf-progress-v1";
const DOC_VERSION = 1;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function defaultSettings() {
  return {
    version: DOC_VERSION,
    music: 0.5, effects: 0.8, ambience: 0.4, voice: 0.5, muted: false,
    quality: "high", reducedMotion: false, highContrast: false, largeText: false,
    leftHanded: false, cameraDefault: "frame", jointMode: "toggle", haptics: false,
    consentAnalytics: false, playerName: "",
  };
}

function defaultProgress() {
  return {
    version: DOC_VERSION,
    playerId: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "anon-" + Date.now().toString(36),
    completed: {}, stars: {}, lessonsDone: {}, achievements: [],
    counters: { spawns: 0, wins: 0, streak: 0 },
    bests: {}, dailyAttempts: {},
    lastMode: "journey",
  };
}

function readDoc(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults();
    const doc = JSON.parse(raw);
    if (!doc || doc.version !== DOC_VERSION || typeof doc.payload !== "string") return defaults();
    if (doc.checksum !== fnv(doc.payload)) return defaults();
    return { ...defaults(), ...JSON.parse(doc.payload) };
  } catch {
    return defaults();
  }
}

function writeDoc(key, value) {
  try {
    const payload = JSON.stringify(value);
    localStorage.setItem(key, JSON.stringify({ version: DOC_VERSION, checksum: fnv(payload), payload }));
  } catch { /* storage full or blocked; play session continues without persistence */ }
}

const storage = {
  loadSettings: () => readDoc(SETTINGS_KEY, defaultSettings),
  saveSettings: (s) => writeDoc(SETTINGS_KEY, s),
  loadProgress: () => readDoc(PROGRESS_KEY, defaultProgress),
  saveProgress: (p) => writeDoc(PROGRESS_KEY, p),
};

// ---------------------------------------------------------------- analytics
// Anonymous funnel events only (start, tutorial step, round end, retry,
// settings change, error). Consent-gated; console collector, no network.

const analyticsSettings = storage.loadSettings();
function analytics(event, data) {
  if (!analyticsSettings.consentAnalytics) return;
  try {
    console.info("[pf-analytics]", event, JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------- WebGL check

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- mount

function mount() {
  const settings = storage.loadSettings();

  // honor OS-level preferences on first run
  if (!localStorage.getItem(SETTINGS_KEY)) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) settings.reducedMotion = true;
    if (window.matchMedia && window.matchMedia("(prefers-contrast: more)").matches) settings.highContrast = true;
  }

  // apply persisted audio volumes
  audio.setBusVolume("music", settings.music);
  audio.setBusVolume("effects", settings.effects);
  audio.setBusVolume("ambience", settings.ambience);
  audio.setBusVolume("voice", settings.voice);
  audio.setMuted(settings.muted);

  // unlock audio on the first user gesture
  const unlockOnce = () => { audio.unlock(); };
  window.addEventListener("pointerdown", unlockOnce, { once: true });
  window.addEventListener("keydown", unlockOnce, { once: true });

  const hasGL = webglAvailable();
  let createRenderer = null;
  if (hasGL) {
    createRenderer = (canvas, opts) => {
      // lazy import keeps the DOM shell alive when three.js fails
      return rendererFactory(canvas, opts);
    };
  } else {
    const note = document.createElement("div");
    note.className = "pf-compat";
    note.setAttribute("role", "alert");
    note.textContent = "WebGL is unavailable in this browser, so the 3D chamber view is disabled. All menus and the rules remain usable; enable hardware acceleration or try another browser for the full experience.";
    document.body.prepend(note);
  }

  initUi({ audio, platform, storage, createRenderer, analytics });
}

// renderer factory kept separate so a WebGL failure cannot kill the UI
let rendererFactory = () => null;
import("./render.js")
  .then((mod) => { rendererFactory = (canvas, opts) => mod.initRenderer(canvas, opts); })
  .catch(() => { rendererFactory = () => null; });

// ---------------------------------------------------------------- host integration points
// Presence/activity hooks are host-integration no-ops in this build:
// - activity start/end would be reported to the host shell here
// - throttled presence heartbeats while actively playing would go here
// Intentionally inert: solo game, no realtime transport required.

window.addEventListener("error", (ev) => analytics("error", { message: String(ev.message || "unknown").slice(0, 80) }));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
