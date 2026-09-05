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
