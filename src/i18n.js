// Physics Foundry UI language: every player-facing string (strings.js) keyed
// by its en-US text; EN holds the few symbolic keys. The engine client
// (native/i18n.ts) sets the locale from the runtime's interface language
// (Options › Language, else the account's preferred language or the
// device's); every string is drawn through t() each frame, so a change shows
// on the next frame without restarting anything.

import { STRINGS } from "./strings.js";

export const LOCALES = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];

// Symbolic keys (status words, phases, rule reasons, screen names) in en-US.
export const EN = {
  "sync.synced": "synced", "sync.saving": "saving", "sync.offline": "offline",
  "phase.build": "build", "phase.run": "run", "phase.won": "won", "phase.lost": "lost",
  "action.spawn": "spawn", "action.joint": "joint", "action.delete": "delete",
  "screen.title": "Title", "screen.modes": "Modes", "screen.play": "Chamber", "screen.results": "Results",
  "screen.progression": "Progression", "screen.help": "How to play", "screen.scores": "Leaderboards",
  "reason.already-running": "the simulation is already running",
  "reason.session-over": "the session is over",
  "reason.material-unknown": "unknown material",
  "reason.material-not-allowed": "that material is not allowed here",
  "reason.budget-exhausted": "no spawns left",
  "reason.joint-unknown": "unknown joint",
  "reason.joint-not-allowed": "that joint is not allowed here",
  "reason.need-two-bodies": "needs two bodies",
  "reason.nothing-to-delete": "nothing to delete",
  "reason.nothing-to-undo": "nothing to undo",
  "reason.bad-bodies": "pick two different bodies",
  "reason.bad-position": "invalid position",
  "reason.not-found": "body not found",
  "reason.out-of-bounds": "outside the chamber",
  "reason.payload-locked": "payloads cannot be removed",
  "reason.too-far": "the bodies are too far apart",
  "reason.malformed-command": "malformed command",
  "reason.unknown-command": "unknown command",
};

let locale = "en-US";
let table = STRINGS["en-US"];
const listeners = new Set();

/** Translate an en-US string (or symbolic key); {name} placeholders are filled from vars. */
export function t(key, vars) {
  let s = table[key] ?? STRINGS["en-US"][key] ?? EN[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function getLocale() { return locale; }

/** fn(locale) after every language change (not on the initial resolve). */
export function onLocaleChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLocale(next) {
  const resolved = LOCALES.includes(next) ? next : "en-US";
  const changed = resolved !== locale;
  locale = resolved;
  table = STRINGS[locale] || STRINGS["en-US"];
  if (changed) for (const fn of listeners) { try { fn(locale); } catch (e) { console.error(e); } }
}

/** Display name of a level ("Daily Cast <date>" carries its date). */
export function levelName(level) {
  const m = /^Daily Cast (.+)$/.exec(level && level.name || "");
  return m ? t("Daily Cast {date}", { date: m[1] }) : t(level ? level.name : "");
}

/** Player-facing text for a rules rejection code. */
export function reasonText(code) {
  const key = "reason." + code;
  return EN[key] ? t(key) : String(code || "");
}
