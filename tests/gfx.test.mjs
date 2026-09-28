import test from "node:test";
import assert from "node:assert/strict";

import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, describe } from "../src/gfx.js";
import { LOCALES, translator, pickLocale } from "../src/gfx-i18n.js";

test("detectPreset: software -> low, discrete / Apple M -> high, else balanced", () => {
  assert.equal(detectPreset("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"), "low");
  assert.equal(detectPreset("llvmpipe (LLVM 15.0.7, 256 bits)"), "low");
  assert.equal(detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)"), "high");
  assert.equal(detectPreset("ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"), "high");
  assert.equal(detectPreset("Apple M2"), "high");
  assert.equal(detectPreset("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"), "balanced");
  assert.equal(detectPreset("Adreno (TM) 730"), "balanced");
  assert.equal(detectPreset(""), "balanced");
  assert.equal(detectPreset(null), "balanced");
});

test("detectPreset: touch/mobile devices are capped at balanced", () => {
  assert.equal(detectPreset("Apple M1", { mobile: true }), "balanced");
  assert.equal(detectPreset("SwiftShader", { mobile: true }), "low");
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
