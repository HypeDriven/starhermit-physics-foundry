import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
// gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function("window", "module", readFileSync(new URL("../gpu-level.js", import.meta.url), "utf8"))(globalThis, undefined);
const { PRESETS, CATEGORIES, LEVELS, BUDGETS, SPARK_MAX, DUST_MAX, detectPreset, detectLevel, presetForLevel, budgetFor, sparkCap, resolve, presetTier, choosePreset, describe } = await import("../src/gfx.js");
const { LOCALES, translator, pickLocale } = await import("../src/gfx-i18n.js");

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test("hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)", () => {
  assert.equal(detectPreset("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", DESK), "low");
  assert.equal(detectLevel("llvmpipe (LLVM 15.0.7, 256 bits)", DESK), 0);
  assert.equal(detectPreset("", DESK), "low", "no WebGL");
  assert.equal(detectPreset("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", DESK), "low");
  assert.equal(detectPreset("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", DESK), "low");
  assert.equal(detectPreset("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)", DESK), "balanced");
  assert.equal(detectPreset("ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)", DESK), "high");
  assert.equal(detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)", DESK), "ultra");
  assert.equal(detectLevel("ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)", DESK), 20);
  assert.equal(detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)", DESK), "ultra");
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), "low");
  assert.equal(presetForLevel(16), "high");
});

test("phones and tablets are Balanced at most; software GPUs stay Low", () => {
  assert.equal(detectPreset("Adreno (TM) 740", PHONE), "balanced");
  assert.ok(detectLevel("Adreno (TM) 740", PHONE) <= 9);
  assert.equal(detectPreset("Apple M2", PHONE), "balanced");
  assert.equal(detectPreset("SwiftShader", PHONE), "low");
});

test("per-preset budgets are explicit, grow from Low to Ultra and scale with the level", () => {
  const keys = ["material", "wallTex", "bodyTex", "sphere", "sparks", "dust", "bloomRes", "aoRes"];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === "number") assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ["lambert", "standard", "physical", "physical"]);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], "half-res bloom below Ultra");
  assert.deepEqual(resolve({ preset: "high" }, "low", 10).budget, BUDGETS.high, "floor level = the tuned budget");
  assert.deepEqual(resolve({ preset: "ultra" }, "low", 0).budget, resolve({ preset: "ultra" }, "ultra", 17).budget);
  assert.ok(budgetFor("balanced", 9).dust > budgetFor("balanced", 4).dust, "counts scale up within the preset");
  assert.ok(budgetFor("ultra", 20).sparks <= SPARK_MAX && budgetFor("ultra", 20).dust <= DUST_MAX);
  assert.equal(sparkCap(resolve({ preset: "high" }, "low", 10)), BUDGETS.high.sparks);
  assert.equal(sparkCap(resolve({ preset: "low" }, "low", 0)), 300, "Low: low particles");
  assert.equal(resolve({}, "low", 0).budget.material, "lambert", "headless SwiftShader: Low, Lambert");
});

test("resolve: auto uses the detected preset; explicit preset wins", () => {
  const a = resolve({ preset: "auto" }, "high");
  assert.equal(a.preset, "high");
  assert.equal(a.auto, true);
  assert.equal(a.shadows, presetTier("high", "shadows"));
  const b = resolve({ preset: "low" }, "high");
  assert.equal(b.preset, "low");
  assert.equal(b.auto, false);
  assert.equal(b.shadows, "off");
  assert.equal(b.post, false, "Low needs no post chain");
  assert.equal(resolve({}, undefined).preset, "balanced");
  assert.equal(resolve(null, "bogus").preset, "balanced");
});

test("resolve: per-category overrides apply; invalid tiers fall back to the preset", () => {
  const r = resolve({ preset: "high", bloom: "off", shadows: "nonsense", particles: "low" }, "low");
  assert.equal(r.bloom, "off");
  assert.equal(r.shadows, presetTier("high", "shadows"));
  assert.equal(r.particles, "low");
  for (const [cat, tiers] of Object.entries(CATEGORIES)) assert.ok(tiers.includes(r[cat]), cat);
  const lowPost = resolve({ preset: "low", antialias: "smaa" }, "low");
  assert.equal(lowPost.post, true, "SMAA override needs the post chain");
});

test("resolve: render scale clamps to 50-200% and multiplies the preset scale", () => {
  assert.equal(resolve({ preset: "high", render_scale: 5 }).renderScale, 2);
  assert.equal(resolve({ preset: "high", render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: "high", render_scale: 1.5 }).scale, 1.5);
  assert.equal(resolve({ preset: "ultra" }).scale, 1.25);
  assert.equal(resolve({ preset: "high" }).adaptive, true);
  assert.equal(resolve({ preset: "high", adaptive: false, show_fps: true }).adaptive, false);
  assert.equal(resolve({ preset: "high", show_fps: true }).showFps, true);
});

test("choosePreset clears overrides but keeps scale / adaptive / fps", () => {
  const next = choosePreset({ preset: "high", bloom: "off", ao: "high", render_scale: 1.5, adaptive: false, show_fps: true }, "low");
  assert.deepEqual(next, { preset: "low", render_scale: 1.5, adaptive: false, show_fps: true });
  assert.deepEqual(choosePreset({ bloom: "on" }, "auto"), { preset: "auto" });
});

test("presets are ordered cheapest first and describe() summarises cost", () => {
  assert.deepEqual(PRESETS, ["low", "balanced", "high", "ultra"]);
  const d = describe(resolve({ preset: "high" }), [1920, 1080]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /1920×1080 px/);
  assert.match(describe(resolve({ preset: "low" })), /no shadows/);
});

test("graphics strings exist in every required locale", () => {
  for (const loc of ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"]) {
    assert.ok(LOCALES[loc], loc);
    for (const k of Object.keys(LOCALES["en-US"])) assert.ok(LOCALES[loc][k], `${loc}.${k}`);
  }
  assert.equal(pickLocale("de"), "de-DE");
  assert.equal(pickLocale("es-MX"), "es-419");
  assert.equal(pickLocale("xx"), "en-US");
  assert.equal(translator("en-US")("auto", { tier: "Low" }), "Auto (detected: Low)");
});
