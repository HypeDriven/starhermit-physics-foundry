// Every player-facing key used in code (ui.js, bootstrap.js) and content
// (level names, intros, lesson steps, achievements, materials, joints) exists
// in all nine locales, with the same {placeholders} as the en-US text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS } from "../src/strings.js";
import { EN, LOCALES, t, setLocale, getLocale, onLocaleChange, levelName, reasonText } from "../src/i18n.js";
import { LEARN_LESSONS, JOURNEY_LEVELS, CHALLENGE_LEVELS, ACHIEVEMENTS, dailyLevel } from "../src/content.js";
import { MATERIALS, JOINT_TYPES } from "../src/rules.js";

const src = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");

function usedKeys() {
  const keys = new Set();
  for (const f of ["ui.js", "bootstrap.js"]) {
    const s = src(f);
    for (const m of s.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/i18n(?:Aria)?: "((?:[^"\\]|\\.)*)"/g)) keys.add(m[1]);
    // t(cond ? "a" : "b", …)
    for (const m of s.matchAll(/\bt\([^()"]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"/g)) { keys.add(m[1]); keys.add(m[2]); }
    for (const m of s.matchAll(/(?<![.\w])(?:toggle|slider)\("([^"]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/slider\("([^"]+)"/g)) keys.add(m[1] + " volume");
  }
  const ui = src("ui.js");
  for (const m of ui.matchAll(/name: "([^"]+)", desc: "([^"]+)", duration: "([^"]+)"/g)) { keys.add(m[1]); keys.add(m[2]); keys.add(m[3]); }
  for (const m of ui.slice(ui.indexOf("TERMINAL_TEXT"), ui.indexOf("MODE_DEFS")).matchAll(/: "([^"]+)"/g)) keys.add(m[1]);
  for (const m of ui.matchAll(/\["([^"]+)", c\./g)) keys.add(m[1]);
  // keys built by concatenation are covered by EN (sync./phase./action./screen./reason.)
  for (const k of [...keys]) if (/^(sync|phase|action|screen|reason)\.$/.test(k)) keys.delete(k);
  for (const k of Object.keys(EN)) keys.add(k);
  keys.add("Daily Cast {date}");
  for (const l of [...LEARN_LESSONS, ...JOURNEY_LEVELS, ...CHALLENGE_LEVELS, dailyLevel("2026-01-01")]) {
    if (!l.name.startsWith("Daily Cast ")) keys.add(l.name);
    if (l.intro) keys.add(l.intro);
    for (const st of l.steps || []) keys.add(st.text);
  }
  for (const a of Object.values(ACHIEVEMENTS)) { keys.add(a.name); keys.add(a.description); }
  for (const m of Object.values(MATERIALS)) keys.add(m.name);
  for (const j of Object.values(JOINT_TYPES)) keys.add(j.name);
  return keys;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("nine locales ship", () => {
  assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort());
  assert.equal(LOCALES.length, 9);
});

test("every used key exists in every translated locale with matching placeholders", () => {
  const keys = usedKeys();
  assert.ok(keys.size > 300, "key scan found " + keys.size);
  const missing = [];
  for (const loc of LOCALES) {
    if (loc.startsWith("en-")) continue;
    for (const k of keys) {
      const v = STRINGS[loc][k];
      if (typeof v !== "string" || !v) missing.push(loc + ": " + k);
      else if (placeholders(v) !== placeholders(EN[k] ?? k)) missing.push(loc + " placeholders: " + k);
    }
  }
  assert.deepEqual(missing, []);
});

test("en-GB only overrides real keys", () => {
  const keys = usedKeys();
  for (const k of Object.keys(STRINGS["en-GB"])) {
    if (k === "Color grade") continue; // gfx-i18n term kept for parity
    assert.ok(keys.has(k), "en-GB override for unknown key " + k);
  }
});

test("t() fills placeholders and switches live", () => {
  const seen = [];
  const off = onLocaleChange((l) => seen.push(l));
  setLocale("de-DE");
  assert.equal(getLocale(), "de-DE");
  assert.equal(t("Delivered: {done} / {total}", { done: 1, total: 2 }), "Geliefert: 1 / 2");
  assert.equal(levelName({ name: "Daily Cast 2026-10-17" }), "Tagesguss 2026-10-17");
  assert.equal(reasonText("budget-exhausted"), "keine Platzierungen mehr übrig");
  setLocale("xx-YY");
  assert.equal(getLocale(), "en-US");
  assert.equal(t("Phase: {phase}", { phase: t("phase.build") }), "Phase: build");
  off();
  assert.deepEqual(seen, ["de-DE", "en-US"]);
});
