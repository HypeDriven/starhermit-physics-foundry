# Known issues & notes — Physics Foundry

## Resolved: results screen had two primary buttons, stalling progression

**Symptoms**

The browser e2e (`tests/e2e.mjs`) timed out waiting for `.pf-screen-play:not([hidden])`
to become visible after clicking "Next chamber"; the play screen never appeared
after a journey win.

**Root cause**

On the journey results screen the optional leaderboard submission button
("Verify & share replay") and the actual progression button ("Next chamber")
were *both* styled `.pf-btn-primary`. A click on `.pf-screen-results .pf-btn-primary`
resolves to the *first* primary in DOM order — the submission button — which only
flashes "Name must be at least 3 characters" and never advances the screen. The
progression path itself was fine; clicking "Next chamber" directly works.

**Fix**

- `src/ui.js` ~line 756: demoted the "Verify & share replay" submission button to
  `pf-btn-secondary`, leaving "Next chamber" as the single primary CTA on the
  results screen. Now the sole `.pf-btn-primary` correctly advances to the next
  chamber.

**Related test note**

`tests/e2e.mjs`: the game deliberately probes `GET /api/v1/time` on startup even
on a partial host (`src/platform.js`). Against the embedded static e2e server that
request returns 404, which the client catches and degrades to its offline/guest
path. That one benign 404 surfaced as a browser console error and tripped the
"no page errors" assertion; the test's benign-noise filter now covers it.

**Verified**

- `node tests/e2e.mjs` → `E2E PASS — both viewport passes clean`.
- `npm test` → 33/33 pass, no regressions.

## Resolved: help screen never returned to the chamber, and pause → help resumed the run

**Symptoms**

Opening "Help" from the play HUD and pressing Back dropped the player on the
title screen with the chamber still live behind it. Opening "Help" from the
pause panel called `resumeGame()`, so the simulation kept stepping (and the
clock kept running down) while the player read the rules on a hidden screen.

**Root cause**

`helpReturn` in `src/ui.js` was declared but never assigned, so `backFromHelp()`
always took the title branch. The pause panel's Help button additionally
resumed the session before navigating away.

**Fix**

- `src/ui.js`: added `openHelp(from)` / `helpPaused`. Help records its opener
  (`title` / `play` / `pause`), pauses the session when opened mid-chamber, and
  Back returns to the play screen (resuming) or re-opens the pause panel.

## Resolved: Escape did nothing outside the play screen

The keydown handler bailed out whenever the play screen was hidden, so Escape
could not close the settings overlay opened from the title, nor back out of the
help/modes/progression/scores screens. Overlays are now handled before the
play-screen check, Tab is trapped inside open modals, and Escape backs out of
the secondary screens.

## Resolved: `npm test` wrote leaderboard/achievement fixtures into the repo

`server.js` persisted to `<repo>/data/*.json`, and `tests/server.test.mjs`
submitted real replays against it, so every test run dirtied tracked files with
entries like `tester-502686`. `PF_DATA_DIR` now overrides the storage directory;
the test suite points it at a `mkdtemp` directory and removes it afterwards, and
`data/` is untracked runtime state (the server recreates it on demand).

## Other fixes in the same pass

- `index.html` declared the placeholder data-URI favicon *after* `favicon.svg`,
  so the placeholder won. Removed it; `build.mjs` now also emits the favicon
  link and copies `favicon.svg` into `dist/`.
- Screen headings are given `tabIndex = -1` before `showScreen()` focuses them,
  so screen changes actually move focus (previously the `.focus()` was a no-op
  on a non-focusable `h2`).
- "Restart chamber" added to the pause panel; retrying a daily that already has a
  recorded attempt is now forced unranked, matching the one-ranked-attempt rule.
- `LICENSE.md` (PolyForm Noncommercial 1.0.0) added; `package.json` license field
  corrected from `ISC`.

**Verified**

- `npm test` → 33/33 pass; `git status` clean of `data/` writes afterwards.
- `npm run test:e2e` → `E2E PASS — both viewport passes clean`, including a new
  step covering title-settings Escape, help→play, help→pause, and pause restart.

## Resolved: shipped distribution was missing cover art and authored SFX

The upload bundle in `dist/` (committed build output) contained only the JS/CSS
shell. The platform manifest declares `cover=coverart.png`, and the audio layer
fetches `sfx/<event>.opus` relative to the page, so the distributed build had no
cover image and silently fell back to synthesized audio for every event.

- `build.mjs` now also copies `coverart.png` and the whole `sfx/` directory into
  `dist/`; `npm run build` was re-run.
- `src/ui.js`: audio previously unlocked only on a canvas pick or keypress, so
  pure menu/touch flows stayed silent even with clips present. A global
  `pointerdown` listener now calls `audio.unlock()` on the first gesture
  anywhere, matching the audio module's "unlocks on first user gesture" contract.

**Verified**

- Headless Chrome smoke test against a static server rooted at `dist/`: page
  boots with no page errors; a real tap on the title Play button fetches
  `sfx/ui-select.opus` with HTTP 200.
- `npm test` → 33/33 pass; `npm run test:e2e` → `E2E PASS — both viewport
  passes clean`.

## Open

- Localization: `/home/albert/games/agents.md` → `agents/localization.md` requires
  nine locales. The UI strings are still English-only literals in `src/ui.js` and
  `src/content.js`; no string catalogue exists yet. Not attempted in this pass.
