// Every player-facing key used by the engine client (native/*.ts) and content
// (level names, intros, lesson steps, achievements, materials, joints) exists
// in all nine locales, with the same {placeholders} as the en-US text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LEARN_LESSONS, JOURNEY_LEVELS, CHALLENGE_LEVELS, ACHIEVEMENTS, dailyLevel } from "../src/content.js";
import { MATERIALS, JOINT_TYPES } from "../src/rules.js";

const NATIVE = new URL("../native/", import.meta.url);
const STRINGS = JSON.parse(readFileSync(new URL("../assets/strings.json", import.meta.url), "utf8"));
const LOCALES = Object.keys(STRINGS);
/** The symbolic keys (their en-US text differs from the key). */
const EN = Object.fromEntries(Object.entries(STRINGS["en-US"]).filter(([k, v]) => k !== v));

/** Every key the engine client translates (T / N in native/*.ts) plus the content's names and texts. */
function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(NATIVE).filter((n) => n.endsWith(".ts"))) {
    const s = readFileSync(new URL(f, NATIVE), "utf8");
    for (const m of s.matchAll(/\b[TN]\("((?:[^"\\]|\\.)*)"/g)) keys.add(m[1]);
    // T(cond ? "a" : "b", …)
    for (const m of s.matchAll(/\bT\([^()"]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"/g)) { keys.add(m[1]); keys.add(m[2]); }
  }
  const main = readFileSync(new URL("main.ts", NATIVE), "utf8");
  for (const m of main.slice(main.indexOf("TERMINAL_TEXT"), main.indexOf("export function terminalText")).matchAll(/: "([^"]+)"/g)) keys.add(m[1]);
  // keys built by concatenation are covered by EN (sync./phase./action./screen./reason.)
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
  assert.ok(keys.size > 250, "key scan found " + keys.size);
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
    assert.ok(keys.has(k), "en-GB override for unknown key " + k);
  }
});

test("the tables keep their translations and symbolic keys", () => {
  assert.equal(STRINGS["de-DE"]["Daily Cast {date}"], "Tagesguss {date}");
  assert.equal(STRINGS["de-DE"]["reason.budget-exhausted"], "keine Platzierungen mehr übrig");
  assert.equal(STRINGS["en-US"]["phase.build"], "build");
});
