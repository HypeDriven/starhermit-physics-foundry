// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the spark pool and the dust motes scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Body shading: Lambert (Low), Standard (Balanced), clear-coated Physical (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Back-wall panel texture width (height ⅔). */
  wallTex: number;
  /** Body surface-map width (height ½). */
  bodyTex: number;
  /** Detailed body sphere segments. */
  sphere: [number, number];
  /** Spark pool at Particles high (low: ≤ 300). */
  sparks: number;
  /** Dust motes (Background animated). */
  dust: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "low" | "high";
  /** Background animated: dust, lamp shimmer, the gauge needle. */
  animated: boolean;
  /** Surface detail: spheres with surface maps, wall panels, tread plate, lamps and pools, the gauge, target glows. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE (Low rendered with the canvas's MSAA). */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", animated: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", wallTex: 256, bodyTex: 64, sphere: [16, 12], sparks: 300, dust: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", wallTex: 512, bodyTex: 128, sphere: [24, 16], sparks: 800, dust: 80, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", wallTex: 1024, bodyTex: 256, sphere: [40, 28], sparks: 2000, dust: 140, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", wallTex: 2048, bodyTex: 512, sphere: [56, 40], sparks: 3000, dust: 240, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const SPARK_MAX = 6000, DUST_MAX = 480;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset], sphere: [...BUDGETS[preset].sphere] as [number, number] };
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js sparkCap: the preset's pool at Particles high, ≤ 300 at low. */
export function sparkCap(l: Look): number { return l.particles === "high" ? l.budget.sparks : Math.min(300, l.budget.sparks); }
