// Procedural WebAudio for Physics Foundry. No external assets.
// Buses: music, effects, ambience, voice (voice reserved; slider exists), master mute.
// Short synthesized transients per logical event; quiet filtered-noise ambience;
// a subtle two-stem adaptive music loop (build-phase calm / run-phase pulse).
// AudioContext unlocks on first user gesture and suspends while the tab is hidden.

import { makeRng } from "./rules.js";

let ctx = null;
let unlocked = false;
let muted = false;

const buses = {}; // name -> { gain, volume }
const BUS_NAMES = ["music", "effects", "ambience", "voice"];
const DEFAULT_VOLUMES = { music: 0.5, effects: 0.8, ambience: 0.4, voice: 0.5 };

let phase = "none"; // "build" | "run" | "none"
let musicTimer = null;
let musicStep = 0;
let ambienceNodes = null;
let buildStem = null;
let runStem = null;

function master() { return buses._master; }

function createGraph() {
  const g = ctx.createGain();
  g.gain.value = muted ? 0 : 1;
  g.connect(ctx.destination);
  buses._master = { gain: g, volume: 1 };
  for (const name of BUS_NAMES) {
    const bg = ctx.createGain();
    bg.gain.value = buses[name] ? buses[name].volume : DEFAULT_VOLUMES[name];
    bg.connect(g);
    buses[name] = { gain: bg, volume: bg.gain.value };
  }
}

export function unlock() {
  if (typeof window === "undefined") return; // headless: no-op
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      createGraph();
      startAmbience();
      startMusic();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    unlocked = true;
  } catch { /* audio unavailable; game remains fully playable */ }
}

// Suspend when hidden, resume when visible (if previously unlocked).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });
}

export function setBusVolume(bus, v) {
  const vol = Math.max(0, Math.min(1, Number(v) || 0));
  if (bus === "master") {
    if (buses._master) buses._master.volume = vol;
    return;
  }
  if (!BUS_NAMES.includes(bus)) return;
  DEFAULT_VOLUMES[bus] = vol;
  if (buses[bus]) {
    buses[bus].volume = vol;
    if (ctx) buses[bus].gain.setTargetAtTime(vol, ctx.currentTime, 0.03);
  }
}

export function getBusVolume(bus) {
  if (bus === "master") return buses._master ? buses._master.volume : 1;
  return buses[bus] ? buses[bus].volume : DEFAULT_VOLUMES[bus] ?? 0.5;
}

export function setMuted(v) {
  muted = !!v;
  if (ctx && master()) master().gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
}

export function setPhase(p) {
  phase = p === "build" || p === "run" ? p : "none";
  applyStemMix();
}

function applyStemMix() {
  if (!ctx || !buildStem || !runStem) return;
  const t = ctx.currentTime;
  buildStem.gain.setTargetAtTime(phase === "build" ? 0.5 : phase === "none" ? 0.25 : 0.08, t, 0.6);
  runStem.gain.setTargetAtTime(phase === "run" ? 0.5 : 0.0, t, 0.4);
}

// ---------------------------------------------------------------- synth helpers

function env(gainNode, t0, peak, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.008);
  g.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function tone(bus, { type = "sine", freq = 440, freqEnd = null, dur = 0.2, vol = 0.2, delay = 0 }) {
  if (!ctx || !buses[bus]) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
  env(g, t0, vol, dur);
  o.connect(g).connect(buses[bus].gain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

let noiseBuffer = null;
function getNoiseBuffer() {
  if (!noiseBuffer) {
    const len = ctx.sampleRate * 0.5;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function noise(bus, { dur = 0.15, vol = 0.2, filterFreq = 2000, q = 1, delay = 0 }) {
  if (!ctx || !buses[bus]) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, vol, dur);
  src.connect(f).connect(g).connect(buses[bus].gain);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ---------------------------------------------------------------- sample clips
// Authored one-shots in sfx/ (see sfx/manifest.json). Each event below prefers
// its mapped clip; the synthesized players remain as fallback while a clip is
// still loading or if fetching/decoding fails, so the game is never silent.

const SAMPLE_BY_EVENT = {
  "ui-select": "ui-select",
  "ui-back": "ui-back",
  "ui-error": "ui-error",
  spawn: "spawn",
  joint: "joint",
  delete: "delete",
  undo: "undo",
  "run-start": "run-start",
  impact: "impact",
  shatter: "shatter",
  goal: "goal",
  win: "win",
  lose: "lose",
  tick: "tick",
  pause: "pause",
  achievement: "achievement",
};

// name -> AudioBuffer | Promise<AudioBuffer|null> | null (failed)
const sampleCache = new Map();

function loadSample(name) {
  let entry = sampleCache.get(name);
  if (entry !== undefined) return entry;
  entry = fetch("sfx/" + name + ".opus")
    .then((r) => {
      if (!r.ok) throw new Error("sfx http " + r.status);
      return r.arrayBuffer();
    })
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => { sampleCache.set(name, buf); return buf; })
    .catch(() => { sampleCache.set(name, null); return null; });
  sampleCache.set(name, entry);
  return entry;
}

// Returns true when a decoded clip was played through the effects bus.
function playSample(name) {
  const entry = loadSample(name);
  if (!entry || typeof entry.then === "function") return false; // failed or still loading
  const src = ctx.createBufferSource();
  src.buffer = entry;
  src.connect(buses.effects.gain);
  src.start();
  return true;
}

// ---------------------------------------------------------------- events

const MATERIAL_TONE = {
  steel: { freq: 220, type: "square", noiseFreq: 3500 },
  wood: { freq: 330, type: "triangle", noiseFreq: 1200 },
  glass: { freq: 880, type: "sine", noiseFreq: 5200 },
  rubber: { freq: 180, type: "sine", noiseFreq: 700 },
};

const players = {
  "ui-select": () => tone("effects", { freq: 660, freqEnd: 880, dur: 0.09, vol: 0.12 }),
  "ui-back": () => tone("effects", { freq: 520, freqEnd: 380, dur: 0.09, vol: 0.1 }),
  "ui-error": () => {
    tone("effects", { type: "square", freq: 160, dur: 0.12, vol: 0.12 });
    tone("effects", { type: "square", freq: 120, dur: 0.16, vol: 0.12, delay: 0.1 });
  },
  spawn: (opts) => {
    const m = MATERIAL_TONE[opts.material] || MATERIAL_TONE.wood;
    tone("effects", { type: m.type, freq: m.freq, freqEnd: m.freq * 1.4, dur: 0.14, vol: 0.16 });
    noise("effects", { dur: 0.06, vol: 0.06, filterFreq: m.noiseFreq });
  },
  joint: () => {
    tone("effects", { freq: 440, dur: 0.06, vol: 0.12 });
    tone("effects", { freq: 660, dur: 0.1, vol: 0.12, delay: 0.05 });
  },
  delete: () => noise("effects", { dur: 0.18, vol: 0.14, filterFreq: 500, q: 0.8 }),
  undo: () => tone("effects", { freq: 500, freqEnd: 300, dur: 0.12, vol: 0.1 }),
  "run-start": () => tone("effects", { type: "sawtooth", freq: 180, freqEnd: 720, dur: 0.35, vol: 0.1 }),
  impact: (opts) => {
    // Layered by material with a seeded pitch variant (av seed) for replay consistency.
    const m = MATERIAL_TONE[opts.material] || MATERIAL_TONE.wood;
    const rng = makeRng((opts.avSeed ?? 1) >>> 0);
    const variant = 0.9 + rng.next() * 0.2;
    const strength = Math.min(1, (opts.strength ?? 4) / 10);
    noise("effects", { dur: 0.08, vol: 0.1 * strength + 0.03, filterFreq: m.noiseFreq * variant, q: 1.5 });
    tone("effects", { type: m.type, freq: m.freq * variant, freqEnd: m.freq * 0.6, dur: 0.12, vol: 0.12 * strength + 0.03 });
  },
  shatter: () => {
    for (let i = 0; i < 4; i++) {
      noise("effects", { dur: 0.12, vol: 0.1, filterFreq: 3000 + i * 1200, q: 3, delay: i * 0.03 });
    }
    tone("effects", { freq: 1200, freqEnd: 300, dur: 0.25, vol: 0.08 });
  },
  goal: () => {
    tone("effects", { freq: 660, dur: 0.12, vol: 0.14 });
    tone("effects", { freq: 880, dur: 0.16, vol: 0.14, delay: 0.09 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone("effects", { freq: f, dur: 0.22, vol: 0.13, delay: i * 0.11 }));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone("effects", { type: "triangle", freq: f, dur: 0.3, vol: 0.12, delay: i * 0.16 }));
  },
  tick: () => tone("effects", { freq: 990, dur: 0.05, vol: 0.09 }),
  pause: () => tone("effects", { freq: 440, freqEnd: 330, dur: 0.1, vol: 0.08 }),
  achievement: () => {
    [784, 988, 1175].forEach((f, i) => tone("effects", { freq: f, dur: 0.18, vol: 0.11, delay: i * 0.08 }));
  },
};

export function play(name, opts = {}) {
  if (!ctx || !unlocked || muted) return;
  const fn = players[name];
  if (!fn) return;
  const sampleName = SAMPLE_BY_EVENT[name];
  if (sampleName) {
    try { if (playSample(sampleName)) return; } catch { /* fall through to synth */ }
  }
  try { fn(opts); } catch { /* never let audio break gameplay */ }
}

// ---------------------------------------------------------------- ambience

function startAmbience() {
  const src = ctx.createBufferSource();
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // brown-ish noise for a deep furnace hum
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3;
  }
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 240;
  src.connect(f).connect(buses.ambience.gain);
  src.start();
  ambienceNodes = { src, f };
}

// ---------------------------------------------------------------- music

const BUILD_NOTES = [220, 261.6, 329.6, 392]; // calm pad arpeggio
const RUN_NOTES = [110, 110, 130.8, 110, 164.8, 110, 130.8, 98]; // pulse bass

function startMusic() {
  buildStem = ctx.createGain();
  runStem = ctx.createGain();
  buildStem.gain.value = 0.25;
  runStem.gain.value = 0;
  buildStem.connect(buses.music.gain);
  runStem.connect(buses.music.gain);
  applyStemMix();
  musicStep = 0;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    // build stem: slow soft pad note every 4 steps
    if (musicStep % 4 === 0) {
      const f = BUILD_NOTES[(musicStep / 4) % BUILD_NOTES.length];
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
      o.connect(g).connect(buildStem);
      o.start(t0);
      o.stop(t0 + 2);
    }
    // run stem: eighth-note pulse
    const rf = RUN_NOTES[musicStep % RUN_NOTES.length];
    const ro = ctx.createOscillator();
    const rg = ctx.createGain();
    ro.type = "triangle";
    ro.frequency.value = rf;
    rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
    rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    ro.connect(rg).connect(runStem);
    ro.start(t0);
    ro.stop(t0 + 0.25);
    musicStep += 1;
  }, 250);
}
