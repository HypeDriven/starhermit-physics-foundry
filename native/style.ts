// The look of the header, rails, tray, overlays and screens: the browser
// build's src/style.css, rewritten class-based in tools/ui-style.css and
// converted once with `starhermit css` into assets/ui-style.json (`npm run
// css`), registered at start with the theme the runtime's own widgets
// (scroll bars, focus rings, selects) take. The runtime's high-contrast
// option is the old body.pf-hc token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#14161c", panel: "#1e222c", "panel-2": "#262b38", text: "#e8ecf4", muted: "#9aa2b8",
  accent: "#ff8a3d", "accent-2": "#ffb066", ok: "#4be38a", err: "#e34b4b", focus: "#7fd8ff", line: "#3a4158",
};
/** body.pf-hc. */
const CONTRAST: Tokens = {
  bg: "#000000", panel: "#0a0a0a", "panel-2": "#141414", text: "#ffffff", muted: "#d0d0d0",
  accent: "#ffb066", "accent-2": "#ffd28a", focus: "#ffff00", line: "#8a8fa0",
};

let current: Tokens = { ...BASE };
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 14.4, headingSize: 24, padding: 8, spacing: 10, radius: 8,
    text: BASE.text!, muted: BASE.muted!, panel: BASE.panel!, control: BASE["panel-2"]!, hovered: "#2e3444",
    pressed: "#353c4f", field: BASE["panel-2"]!, accent: BASE.accent!, focus: BASE.focus!, outline: BASE.line!,
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$line", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$text" }, radius: 6, padding: 6 },
    // .pf-overlay: rgba(5, 6, 10, 0.75) behind the pause and settings panels.
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#05060abf" } } },
  });
  key = "";
  applyTokens(false);
}

let key = "";
/** The base or high-contrast tokens (cheap when unchanged). */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({
    text: current.text!, muted: current.muted!, panel: current.panel!, control: current["panel-2"]!,
    field: current["panel-2"]!, accent: current.accent!, focus: current.focus!, outline: current.line!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
