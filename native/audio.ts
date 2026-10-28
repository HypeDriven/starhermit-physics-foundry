// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the quiet furnace hum
// (brown noise lowpassed at 240 Hz) and the two-stem adaptive music (a calm
// pad arpeggio in the build phase, an eighth-note pulse bass while the
// chamber runs). The browser build ran the hum and the stems live (a noise
// loop and oscillators on a 250 ms timer); here they are rendered once into
// clips (createClip, a slice a frame) and looped on the music bus — the
// runtime has no ambience bus — with the stems' phase mix as fades (build
// 0.5 / 0.25 idle / 0.08 running; run 0.5 running, else 0). The browser
// build's ambience bus sat at 0.4 against music's 0.5: the hum's gain is
// their ratio. The oscillator fallbacks it played while a sample decoded
// are not ported (a live synthesis graph makes clip loads fail on the web
// runtime): a clip still loading is silent. The runtime's Options own the
// volumes, the mute and the voice limit. Clips load once the mixer runs
// (natively at once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { Rules } from "./game.ts";

const SFX = ["ui-select", "ui-back", "ui-error", "spawn", "joint", "delete", "undo", "run-start", "impact", "shatter", "goal",
  "win", "lose", "tick", "pause", "achievement"] as const;
export type Sfx = (typeof SFX)[number];
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

export function play(name: Sfx): void {
  if (suspended) return;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// -- the hum and the music ------------------------------------------------------------------------
const RATE = 22050;
const AMB_N = RATE * 2;
const amb = new Float32Array(AMB_N);
let ambPos = 0, ambLast = 0, ambY = 0;
const ambRng = Rules.makeRng(0xa3b1);
/** audio.js startAmbience: brown-ish noise ×3, then the 240 Hz lowpass (run twice round so the loop joins). */
function renderAmbience(count: number): boolean {
  const k = 1 - Math.exp((-2 * Math.PI * 240) / RATE);
  const end = Math.min(2 * AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % AMB_N;
    if (ambPos < AMB_N) {
      ambLast = (ambLast + 0.02 * (ambRng.next() * 2 - 1)) / 1.02;
      amb[i] = ambLast * 3;
    } else {
      ambY += k * (amb[i]! - ambY);
      amb[i] = ambY;
    }
  }
  return ambPos >= 2 * AMB_N;
}

/** audio.js startMusic: 250 ms steps; build: a sine pad note every 4 steps (4 notes); run: a triangle pulse each step (8 notes). */
const STEP = 0.25, STEPS = 16;
const LOOP_N = Math.round(RATE * STEPS * STEP);
const BUILD_NOTES = [220, 261.6, 329.6, 392];
const RUN_NOTES = [110, 110, 130.8, 110, 164.8, 110, 130.8, 98];
const buildBuf = new Float32Array(LOOP_N), runBuf = new Float32Array(LOOP_N);
let note = 0;
/** One oscillator note with audio.js's exponential envelope (0.0001 → peak at `rise` → 0.0001 at `end`), wrapping round the loop. */
function renderNote(buf: Float32Array, t0: number, f: number, peak: number, rise: number, end: number, tri: boolean): void {
  const len = Math.round(end * RATE), start = Math.round(t0 * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = t < rise ? 0.0001 * Math.pow(peak / 0.0001, t / rise) : peak * Math.pow(0.0001 / peak, (t - rise) / (end - rise));
    const ph = (f * t) % 1;
    const w = tri ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(ph * 2 * Math.PI);
    buf[(start + i) % LOOP_N] = buf[(start + i) % LOOP_N]! + w * env;
  }
}
function renderMusic(): boolean {
  if (note < STEPS / 4) { renderNote(buildBuf, note * 4 * STEP, BUILD_NOTES[note % 4]!, 0.12, 0.4, 1.9, false); note++; return false; }
  const r = note - STEPS / 4;
  if (r < STEPS) { renderNote(runBuf, r * STEP, RUN_NOTES[r % 8]!, 0.16, 0.01, 0.22, true); note++; return false; }
  return true;
}

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

/** Each frame: the clips once the mixer runs (one at a time), then the hum and the stems. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of SFX) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(8000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (!buildClip || !runClip) {
    if (!renderMusic()) return;
    try { buildClip = createClip([buildBuf], RATE); runClip = createClip([runBuf], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); }
    return;
  }
  const [b, r] = stemGains();
  if (!buildVoice) {
    try { buildVoice = playClip(buildClip, { bus: "music", gain: suspended ? 0 : b, loop: true }); } catch { buildVoice = null; }
    return;
  }
  if (!runVoice) {
    try { runVoice = playClip(runClip, { bus: "music", gain: suspended ? 0 : r, loop: true }); } catch { runVoice = null; }
  }
}
