// Graphics quality model: presets, per-category overrides, StarHermit hardware-level
// detection, per-preset budgets and a cost summary. Pure (no three.js, no DOM) so the settings panel, the renderer
// and the unit tests agree on what every setting means.

export const PRESETS = ["low", "balanced", "high", "ultra"];

// Category -> allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ["off", "low", "medium", "high"],
  ao: ["off", "on", "high"],
  bloom: ["off", "on"],
  grade: ["off", "on"],
  antialias: ["off", "fxaa", "smaa", "msaa"],
  reflections: ["off", "on"],
  particles: ["low", "high"],
  background: ["static", "animated"],
  detail: ["plain", "detailed"],
};

// Each preset is a row of tiers, a render-scale multiplier and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: "off", ao: "off", bloom: "off", grade: "off", antialias: "msaa", reflections: "off", particles: "low", background: "static", detail: "plain" },
  balanced: { scale: 1, dprCap: 1.5, shadows: "low", ao: "off", bloom: "on", grade: "on", antialias: "fxaa", reflections: "on", particles: "high", background: "animated", detail: "detailed" },
  high: { scale: 1, dprCap: 2, shadows: "medium", ao: "on", bloom: "on", grade: "on", antialias: "smaa", reflections: "on", particles: "high", background: "animated", detail: "detailed" },
  ultra: { scale: 1.25, dprCap: 2, shadows: "high", ao: "high", bloom: "on", grade: "on", antialias: "msaa", reflections: "on", particles: "high", background: "animated", detail: "detailed" },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_CAP = { low: 300, high: 2000 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || "") };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || "low";
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Chamber, bodies,
 * picking and rules are identical on every preset — only visuals change.
 *   material  body shading: lambert (Low) / standard (Balanced) / clear-coated physical (High, Ultra)
 *   wallTex   back-wall panel texture width in px (Surface detail on; height 2/3)
 *   bodyTex   body surface-map width in px (height ½; Surface detail on)
 *   sphere    detailed body sphere segments [width, height]
 *   sparks    spark pool at Particles high (low: ≤ 300), scaled with the level
 *   dust      dust motes (Background animated), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: "lambert", wallTex: 256, bodyTex: 64, sphere: [16, 12], sparks: 300, dust: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", wallTex: 512, bodyTex: 128, sphere: [24, 16], sparks: 800, dust: 80, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", wallTex: 1024, bodyTex: 256, sphere: [40, 28], sparks: 2000, dust: 140, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", wallTex: 2048, bodyTex: 512, sphere: [56, 40], sparks: 3000, dust: 240, bloomRes: 1, aoRes: 1 },
};
export const SPARK_MAX = 6000;
export const DUST_MAX = 480;

/** A preset's concrete budget for a hardware level (spark and dust counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  return b;
}

/** Live spark cap for a resolved setting: the preset's pool at Particles high, ≤ 300 at low. */
export function sparkCap(r) {
  return r.particles === "high" ? r.budget.sparks : Math.min(PARTICLE_CAP.low, r.budget.sparks);
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : "balanced") : s.preset;
  const row = TABLE[preset];
  const out = {
    preset,
    auto,
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    dprCap: row.dprCap,
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== "off" || out.bloom === "on" || out.grade === "on" || out.antialias === "fxaa" || out.antialias === "smaa";
  return out;
}

/** Saved settings after choosing a preset: overrides are cleared, scale/adaptive/fps kept. */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : "auto" };
  for (const k of ["render_scale", "adaptive", "show_fps"]) if (k in s) out[k] = s[k];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

/** Short cost summary; `pixels` = [w, h] of the drawing buffer. */
export function describe(r, pixels) {
  const parts = [
    r.shadows === "off" ? "no shadows" : `${SHADOW_MAP[r.shadows]}² shadows`,
    r.ao === "off" ? null : r.ao === "high" ? "full ambient occlusion" : "ambient occlusion",
    r.bloom === "on" ? "bloom" : null,
    r.reflections === "on" ? "reflections" : null,
    r.antialias === "off" ? "no anti-aliasing" : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
