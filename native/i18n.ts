// Localization: the engine's string tables (assets/strings.json, en-US text as the keys plus the symbolic
// sync./phase./action./screen./reason. keys, the nine StarHermit locales; the account strings are the engine's
// starhermit.* keys) in the interface language the runtime reports (the player's choice in Options › Language,
// else the account's preferred language or the device's). Every string is drawn through T() each frame, so a
// change shows on the next frame without restarting the chamber or its clock.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars | null): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] != null ? String(vars[k]) : m));
/** An en-US source string (or symbolic key) in the player's language (unknown strings pass through); `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const s = String(key);
  return strings.has(s) ? strings.t(s, vars ?? undefined) : fill(s, vars);
}
/** Marks an en-US key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
const ACCOUNT = {
  signIn: "signIn", invite: "invite", inviteCopied: "inviteCopied", inviteFailed: "inviteLink", signedOut: "signedOut",
  lbPosting: "leaderboardPosting", lbRank: "leaderboardRank", lbPosted: "leaderboardPosted", lbNotPosted: "leaderboardNotPosted",
};
/** The engine's account strings (a failed copy shows the link: starhermit.inviteLink). */
export function S(key: keyof typeof ACCOUNT, vars?: Vars): string { return strings.t(`starhermit.${ACCOUNT[key]}`, vars); }
/** A level's display name ("Daily Cast <date>" keeps its date). */
export function levelName(level: { name: string } | null): string {
  const m = /^Daily Cast (.+)$/.exec(level?.name ?? "");
  return m ? T("Daily Cast {date}", { date: m[1]! }) : T(level ? level.name : "");
}
/** A rules rejection code as player text. */
export function reasonText(code: string): string {
  const key = `reason.${code}`;
  return strings.has(key) ? T(key) : String(code || "");
}
