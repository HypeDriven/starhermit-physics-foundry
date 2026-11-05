// The look per graphics level. The engine's level (levelSettings()) owns the
// effects: shadow map, AO, bloom, grade and anti-aliasing. The browser build's
// art per preset (src/gfx.js TABLE / BUDGETS: materials, textures, segments,
// detail) stays keyed by the quality tier, with the spark pool and the dust
// motes scaled by the level's particle budget against the tier's anchor level
// (at most 2×) and the textures held to the level's maximum. The runtime owns
// the rest of what the old Graphics panel did: Auto and the level choice,
// render scale and the pixel-ratio cap, adaptive resolution, the frame-rate
// limit and readout. The old panel's per-effect overrides are not offered
// (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
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

/** gfx.js TABLE, without the effects. */
type Art = Omit<Look, "preset" | "budget" | "shadows" | "ao" | "bloom" | "grade" | "antialias">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, particles: "low", animated: false, detailed: false },
  balanced: { reflections: true, particles: "high", animated: true, detailed: true },
  high: { reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { reflections: true, particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", wallTex: 256, bodyTex: 64, sphere: [16, 12], sparks: 300, dust: 40 },
  balanced: { material: "standard", wallTex: 512, bodyTex: 128, sphere: [24, 16], sparks: 800, dust: 80 },
  high: { material: "physical", wallTex: 1024, bodyTex: 256, sphere: [40, 28], sparks: 2000, dust: 140 },
  ultra: { material: "physical", wallTex: 2048, bodyTex: 512, sphere: [56, 40], sparks: 3000, dust: 240 },
};
/** The level whose particle budget is each tier's own. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const SPARK_MAX = 6000, DUST_MAX = 480;

/** The look at a graphics level. Plain data: applyLook compares it by JSON. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset], sphere: [...BUDGETS[preset].sphere] as [number, number] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  b.wallTex = Math.min(b.wallTex, s.maxTextureSize);
  b.bodyTex = Math.min(b.bodyTex, s.maxTextureSize);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** gfx.js sparkCap: the preset's pool at Particles high, ≤ 300 at low. */
export function sparkCap(l: Look): number { return l.particles === "high" ? l.budget.sparks : Math.min(300, l.budget.sparks); }
