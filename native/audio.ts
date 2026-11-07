// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the quiet furnace hum
// (brown noise lowpassed at 240 Hz) and the two-stem adaptive music (a calm
// pad arpeggio in the build phase, an eighth-note pulse bass while the
// chamber runs). The browser build ran the hum and the stems live (a noise
// loop and oscillators on a 250 ms timer); here they are rendered once at
// start (OfflineAudioContext, one a stem) and looped on the music bus — the
// runtime has no ambience bus — with the stems' phase mix as fades (build
// 0.5 / 0.25 idle / 0.08 running; run 0.5 running, else 0). The browser
// build's ambience bus sat at 0.4 against music's 0.5: the hum's gain is
// their ratio. The oscillator fallbacks it played while a sample decoded
// are not ported (a live synthesis graph makes clip loads fail on the web
// runtime): a clip still loading is silent. The runtime's Options own the
// volumes, the mute and the voice limit. Clips all load at once in onStart;
// the hum and the stems wait for the mixer (natively at once, in a browser
// after the first press).
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const SFX = ["ui-select", "ui-back", "ui-error", "spawn", "joint", "delete", "undo", "run-start", "impact", "shatter", "goal",
  "win", "lose", "tick", "pause", "achievement"] as const;
export type Sfx = (typeof SFX)[number];
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of SFX) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  const failed = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
  renderAmbience().then((c) => { ambClip = c; }, failed);
  renderBuild().then((c) => { buildClip = c; }, failed);
  renderRun().then((c) => { runClip = c; }, failed);
}

export function play(name: Sfx): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { /* the mixer is full this frame: skip it */ }
}

// -- the hum and the music ------------------------------------------------------------------------
const RATE = 22050;
const AMB_LEVEL = 0.7; // the old stem's rms 0.147 (leaky brown × 3, one-pole), measured
/** audio.js startAmbience: brown noise, the 240 Hz lowpass; filtered periodic noise is periodic once settled, so the loop joins. */
async function renderAmbience(): Promise<AudioClip> {
  const n = RATE * 2, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 0xa3b1, seconds: 2 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
  const g = off.createGain(); g.gain.value = AMB_LEVEL;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}

/** audio.js startMusic: 250 ms steps; build: a sine pad note every 4 steps (4 notes); run: a triangle pulse each step (8 notes). */
const STEP = 0.25, STEPS = 16;
const LOOP_N = Math.round(RATE * STEPS * STEP);
const BUILD_NOTES = [220, 261.6, 329.6, 392];
const RUN_NOTES = [110, 110, 130.8, 110, 164.8, 110, 130.8, 98];
const TAIL_N = Math.round(RATE * 2);
/** Oscillator notes with audio.js's exponential envelope (0.0001 → peak at `rise` → 0.0001 at `end`); what passes the end wraps round the loop. */
async function renderStem(notes: readonly { t0: number; f: number }[], peak: number, rise: number, end: number, type: "sine" | "triangle"): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, LOOP_N + TAIL_N, RATE);
  for (const n of notes) {
    const osc = off.createOscillator(); osc.type = type; osc.frequency.value = n.f;
    const g = off.createGain();
    g.gain.setValueAtTime(0.0001, n.t0); g.gain.exponentialRampToValueAtTime(peak, n.t0 + rise); g.gain.exponentialRampToValueAtTime(0.0001, n.t0 + end);
    osc.connect(g).connect(off.destination); osc.start(n.t0); osc.stop(n.t0 + end);
  }
  const data = (await off.startRendering()).getChannelData(0);
  const out = data.slice(0, LOOP_N);
  for (let i = 0; i < TAIL_N; i++) out[i]! += data[LOOP_N + i]!;
  return createClip([out], RATE);
}
const renderBuild = (): Promise<AudioClip> => renderStem(BUILD_NOTES.map((f, i) => ({ t0: i * 4 * STEP, f })), 0.12, 0.4, 1.9, "sine");
const renderRun = (): Promise<AudioClip> => renderStem(Array.from({ length: STEPS }, (_, r) => ({ t0: r * STEP, f: RUN_NOTES[r % 8]! })), 0.16, 0.01, 0.22, "triangle");

let ambClip: AudioClip | null = null, buildClip: AudioClip | null = null, runClip: AudioClip | null = null;
let ambVoice: Sound | null = null, buildVoice: Sound | null = null, runVoice: Sound | null = null;
const AMB_GAIN = 0.4 / 0.5;
let phase: "build" | "run" | "none" = "none";
const stemGains = (): [number, number] => [phase === "build" ? 0.5 : phase === "none" ? 0.25 : 0.08, phase === "run" ? 0.5 : 0];
/** audio.js setPhase: the stems' mix for the build phase, a running chamber, or menus. */
export function setPhase(p: "build" | "run" | "none"): void {
  if (p === phase) return;
  phase = p;
  if (suspended) return;
  const [b, r] = stemGains();
  try { buildVoice?.fade(b, p === "run" ? 0.4 : 0.6); runVoice?.fade(r, 0.4); } catch { /* gone */ }
}
/** A hidden window (and the pause card) silences the loops. */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  const [b, r] = stemGains();
  try {
    ambVoice?.fade(on ? 0 : AMB_GAIN, 0.2);
    buildVoice?.fade(on ? 0 : b, 0.2);
    runVoice?.fade(on ? 0 : r, 0.2);
  } catch { /* gone */ }
}

/** Each frame, once the mixer runs and the renders are in: the hum and the stems start. */
export function update(): void {
  if (context.state !== "running") return;
  const [b, r] = stemGains();
  try {
    if (ambClip && !ambVoice) ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true });
    if (buildClip && !buildVoice) buildVoice = playClip(buildClip, { bus: "music", gain: suspended ? 0 : b, loop: true });
    if (runClip && !runVoice) runVoice = playClip(runClip, { bus: "music", gain: suspended ? 0 : r, loop: true });
  } catch { /* the mixer is full this frame: next frame */ }
}
