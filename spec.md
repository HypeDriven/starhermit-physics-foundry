# Physics Foundry — Product and Game Specification

**Document status:** running specification of the shipped game (StarHermit engine 1.28.0 script game, host API 1.30).  
**Game index:** 68  
**Genre:** Physics sandbox  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** the StarHermit client natively (desktop) and desktop and mobile browsers through the engine's web runtime, landscape and portrait  
**Rendering direction:** a `starhermit:scene` chamber (the three.js r161 scene, ported) with the whole interface on `starhermit:ui`

## 1. Product vision

Physics Foundry is a game in which players spawn materials, joints, tools, and characters into a bounded simulation playground. Its signature setting is an industrial test chamber with modular environments. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Spawn materials, joints, tools, and characters into a bounded simulation playground.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **spawn an object, connect or configure it, run the simulation, inspect behavior, and revise**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

No required score; optional engineering challenges validate creations. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The chamber view fills the game region but is never the only UI. Menus, text, settings and assistive descriptions are `starhermit:ui` widgets over or beside it; the bodies are named targets projected from the scene, so labels align with what is drawn.

### Responsive layouts

Layouts are picked from the window's logical size (the runtime's UI scale applied, inside the safe area); the chamber view is framed into the rectangle the layout leaves, with the page painted around it.

- **Wide (≥ 1024 logical px):** header; objective/status rail (240 px) on the left, the chamber view in the centre, the lesson box and action tray rail (260 px) on the right.
- **Short landscape (≤ 900 px wide, landscape):** the same three columns with narrow rails (140–170 / 150–190 px); each rail scrolls when its content is taller; tray buttons fill the rail width.
- **Compact (everything else, portrait phones included):** the status block (objective, one wrapped line of delivered / spawns / time / phase, the error line, Pause and Help; in Learn also the lesson box) above the chamber, the tray below it. The chamber keeps at least its full-width height (or 40 % of the room, 160 px minimum); the status block takes at most 22 % (34 % in Learn) and the tray the rest, each scrolling past that. Phones put the cursor pad in one row; tray buttons stretch across their row.
- **Left-handed action tray** (game setting) swaps the two rails.
- Toasts sit bottom-centre on wide layouts and on full-page screens, else at the top of the chamber view so they never cover the tray. Labels too wide for their button wrap.

### Screens and overlays

- **Header:** "Physics Foundry", and the player status (display name · online / local · sync state) on the right.
- **Title:** "Industrial physics sandbox", the tag line, **Play** (dominant), four cards (Daily challenge with today's date and the time to the next UTC day; Journey with chambers done; Profile & settings; All modes), and How to play, Leaderboards, Invite a friend (signed in) and Sign in with StarHermit (guests). Play goes to the last mode played (Journey's next unfinished chamber, the next lesson, today's Daily, or the Practice / Challenge setup).
- **Modes:** six cards (Learn, Journey, Daily, Practice, Challenge, Score chase); Practice and Challenge open a setup panel below (rules, expected duration, ranked; Practice: a difficulty filter and the unlocked chambers; Challenge: the four chambers, ✓ when done), scrolled into view by focusing its first control; Back.
- **Chamber:** the status rail (objective "‹level› — deliver N payloads", Delivered, Spawns left, Time left while running, Phase (paused), the red error line for 3.5 s after an illegal action, Pause (Esc), Help), the chamber view, and the tray rail (Learn: the lesson box "Lesson n/6" with the step, then "Lesson complete!" with Next lesson; materials with their colour edge and number, Spawn at cursor (Enter), the level's joints (Pin Joint / Spring, selected while joint mode is on), Delete selected (Del), Undo (U), Run (R) / Running…, and the cursor pad).
- **Pause panel** (dialog over the dimmed chamber): Resume, Settings, Help, Restart chamber, Leave chamber. Escape resumes.
- **Settings panel** (from the pause panel or the title card): Profile (who is playing and the sync state), a note that sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options with **Open Options** and **Key bindings** (the runtime's rebinding), Display → Camera default (Full chamber / Tight frame), Controls → Left-handed action tray, Joint mode (Toggle / Hold J), Haptics, Other → Replay tutorial, and Done. Escape closes it (back to the pause panel when a chamber is paused).
- **How to play:** the rules paragraph, the controls as cards from the effective key bindings, the four materials and two joints with their numbers; Back returns to where it was opened (the title, the chamber — whose running clock it paused — or the pause panel).
- **Leaderboards:** signed in, the StarHermit high-score board (top 20, read-only); guests see their local Journey bests; then the local Daily runs (last 10 days).
- **Progression** (Journey card): the 44 chambers as chips (locked until the previous is done, green when done, ★ at par, ◆ mastery), the six lessons (✓), the achievements (★ / ☆), lifetime spawns, wins and streak.
- **Results** (0.9 s after the run ends): Delivery complete / Run failed, the reason, the score breakdown table, new local best or local best, the last achievements, the leaderboard line (Posting… / rank / posted / not posted; "Ranked run recorded on this device." for guests; "Unranked session" for Learn, Practice, Challenge and repeat Dailies), Retry, Next lesson / Next chamber, Modes.

### Input

- **Keys** (`control.*`, rebindable in the runtime's Options): arrows / WASD move the spawn cursor by 0.5 units; Enter / Space spawn the selected material at the cursor (a focused button keeps Enter / Space); 1–4 select the level's materials; J joint mode (toggle, or hold with the Hold setting); Delete / Backspace remove the selected body; U undo; R run; C re-frame the camera; Escape cancels joint mode, else pauses, and backs out of panels and screens.
- **Gamepad** (`engine.gamepad.*`): D-pad / left stick move the cursor, South spawns, the shoulders pick materials 1 and 2, North joint mode, West delete, left trigger undo, right trigger run, right stick press re-frame, Start or East pause / cancel; focus navigation reaches every widget.
- **Pointer and touch:** a press in the chamber picks the body under it (every body is a 0.5-radius sphere, the raised selected one first) — select it, or in joint mode the first then the second body of a joint — else moves the cursor there and spawns (nothing in joint mode). The mouse hovering over the chamber moves the cursor and its ghost in the build phase. A press that closes a panel or leaves a screen never reaches the chamber; presses over the rails are the UI's.
- Every body is also a named target ("Wood payload 1", "Steel ball 2", ", selected"), so screen readers, keyboard focus and play scripts reach the picking without coordinates.

### Accessibility

- Full keyboard operation and visible focus; widget equivalents for chamber actions (named body targets); headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce the chamber state through a concise navigable model rather than describing every decorative object.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is an industrial test chamber with modular environments. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Graphics

The chamber is lit by one warm key light (PCF shadows), a hemisphere fill and a small ambient base (three r161 intensities ÷ π for the engine's light units), rendered with ACES filmic tone mapping at exposure 1.05. With reflections on, a `RoomEnvironment` image (PMREM) lights the physically based surfaces; each material carries it as its own environment map so r161's per-material intensities (0.35 shell, 0.6 obstacles, bodies 0.4–1.4) still apply at engine minor 20. Bodies are clear-coated Physical on High/Ultra, Standard on Balanced, Lambert on Low; with surface detail they are true spheres with procedural surface maps (wood grain, brushed steel, rubber tread), the back wall gets brushed-steel panels with soot and stencilled bay numbers (bump-mapped), the slabs tread plate, the lamps soft light pools, plus the gauge and target glows. Payloads carry an accent ring. Effects: bloom (0.6 / 0.5 / threshold 0.88: lamps, rings, hazards, sparks), a linear colour grade with vignette, GTAO, FXAA / SMAA / MSAA, additive sparks, and background motion (dust, lamp shimmer, the gauge needle), frozen when paused or under reduced motion. With post effects the backdrop colour is the old composer's tone-mapped clear colour (palette × 2.4 through ACES).

**Quality.** The runtime's Options own the graphics level (Auto from the device, ten levels in four tiers), render scale, pixel-ratio cap, adaptive resolution, frame-rate limit and readout. `native/quality.ts` maps the tier to the old presets and budgets and scales sparks and dust within the tier by the level (≤ 2×):

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Body shading | Lambert | Standard | clear-coated Physical | clear-coated Physical |
| Shadows | off | 1024² | 2048² | 4096² |
| Ambient occlusion / bloom / grade | – / – / – | – / on / on | on / on / on | high / on / on |
| Anti-aliasing | MSAA | FXAA | SMAA | MSAA |
| Reflections, particles high, background animated, surface detail | off | on | on | on |
| Back-wall panel texture (height ⅔) | 256 px | 512 px | 1024 px | 2048 px |
| Body surface maps (height ½) | 64 px | 128 px | 256 px | 512 px |
| Detailed sphere segments | 16×12 | 24×16 | 40×28 | 56×40 |
| Spark pool (particles low: ≤ 300) / dust motes | 300 / 40 | 800 / 80 | 2000 / 140 | 3000 / 240 |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |

Changing level swaps the assets live (materials, canvas textures, sphere geometry). Chamber, bodies, picking and rules are identical on every level. The old Graphics panel's per-effect overrides are not offered.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `native/main.ts` (engine.entry): app state and screen flow, starting every mode, the session's events (sounds, sparks, announcements, lesson steps, achievements), keys / pads / pointer / touch, one rules tick per fixed step, results and score posting, lifecycle.
- `native/screens.ts`: every screen, rail, tray and panel on `starhermit:ui`; `native/style.ts` registers `assets/ui-style.json` (from `tools/ui-style.css` by `npm run css`) and the high-contrast tokens.
- `native/render.ts`: the chamber on `starhermit:scene` (procedural canvases on `starhermit:canvas`), framing into the view rectangle, picking, interpolation between fixed steps.
- `native/audio.ts`: the sfx clips on the effects bus; the furnace hum and the two music stems rendered to clips on the music bus.
- `native/platform.ts`: save, cloud merge and migration, the game's options, player, invite link, server clock, score posting, board reads. `native/i18n.ts`: the interface language. `native/quality.ts`: looks per tier. `native/game.ts`: typed facade over the pure modules.
- Pure modules shared with node tests: `src/rules.js` (deterministic physics, legality, scoring, replay verification), `src/content.js` (themes, 6 lessons, 44 journey chambers, 4 challenges, the Daily generator, achievements, validators), `src/session.js` (validated commands, undo, replay log), `src/progress.js` (save model, merge, run bookkeeping, options), `src/i18n.js` + `src/strings.js` and `src/platform-i18n.js` (strings in nine locales).
- `server.js`: the local dev server with replay validation (not packaged); `score-script.js`: the platform script (server=).

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- `starhermit.txt`: `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.28.0`, `engine.minor=30`, capabilities platform, storage, clipboard; `control.*` and `engine.gamepad.*` for every action; server=score-script.js.
- `npm run package` writes the web loader `index.html` and `starhermit-files.json` (`starhermit package --web .`); `.starhermitignore` leaves out tests/, tools/, server.js, docs and data/. Re-run after every change.

### Identity, saves, preferences, controls
- The save is the engine save (`starhermit:storage` `saves`, schema 1) `{ v, progress }`: completed chambers, stars, lessons, achievements, counters (spawns, wins, streak), per-chamber bests, daily attempts, last mode. It is stored on the device and, signed in, in the account's cloud slot.
- Two devices: on a conflict the saves merge (completed, stars, lessons and achievements unioned; bests, spawns and wins take the larger value; the better daily score; this device's streak and last mode).
- Migration: the browser build's cloud slot (`game:<slug>`, `{ settings, progress }`) shows as a foreign save: its progress merges into the engine save, which replaces it once; its left-handed / camera / joint-mode / haptics settings carry over. The browser build's settings-KV keys are adopted the same way (unless set here since) and then removed. Guests' old browser localStorage progress cannot migrate.
- The game's own options (left-handed tray, camera default, joint mode, haptics) are engine settings synced with the account; volumes, mute, graphics, language, larger text, high contrast and reduced motion are the runtime's Options. Key and pad bindings are the runtime's (Options › Controls, or Settings › Key bindings).
- Invite a friend (signed in) copies the platform invite link. A session that ends signed-out toasts and keeps playing locally.

### Achievements and leaderboards
- Achievements are tracked in the save (Progression screen), toasted when unlocked.
- Signed in, every finished Journey or first Daily run posts its total through score-script.js (a practice session whose socket carries `{ type: 'result', scores: { 'high-score': n } }`; the script range-checks it, 0–1,000,000), then reads the rank. Practice, Learn, Challenge and repeat Dailies post nothing; guests post nothing.
- The Daily's UTC date comes from the platform clock (`serverNow`), else the device clock.

### Not used
- No matchmaking, chat, rooms, replays upload or voice: a solo puzzle.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Language

- Every player-facing string ships in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT (`src/strings.js`, account strings in `src/platform-i18n.js`); the game name is never translated.
- The language is the runtime's interface language (Options › Language, else the account's or device's), mapped to the nearest shipped locale; a change shows on the next frame without restarting the chamber or its clock.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Checks

- `npm test`: node unit tests (rules, content validators, determinism, the dev server, the save model and migration, i18n coverage of `native/*.ts` with matching placeholders) and `tests/native.mjs` (web index up to date, `tsc`, `starhermit check` with zero warnings, and the render-check play scripts in `tests/native/`: Journey 1–4 by keys on a desktop, the six lessons by finger on a DPR-3 phone with joints and delete via the bodies' named targets, Speedrun Bay on a phone held sideways with the pause panel, and the menus, settings and help panels). The chamber builds in the scripts are planned by `tools/gen-plays.mjs`, which plays the same fixed-step session in node, so each script waits for the outcome the rules produce.
- `npm run test:browser` (`tools/browser-play.mjs`): the packaged loader in GPU Chrome at 1280×800, 390×844 @3 and 844×390 @3: Journey 1 and 2 (a mouse click in the chamber spawns), pause by Escape, lesson 1 by finger, Speedrun Bay with pause; fails on console errors or the runtime's error screen.

## Port differences and known limitations

- The old Graphics panel (preset, render scale, per-effect overrides, FPS readout), the Sound panel, Language selector, larger text / high contrast / reduced motion toggles and Report a problem are the runtime's Options and reporting; the console-only analytics and its consent toggle are gone.
- Fixed while porting: the old renderer reused a body's mesh across chambers by id, so a new chamber's payload could show the previous chamber's material (e.g. Speedrun Bay's rubber payload drawn as wood); every chamber now starts with fresh views.
- The canvas's rounded corners are not drawn (the chamber view is a plain rectangle).
- Signed-in paths (foreign-save migration, conflict merge, legacy settings, score posting) are covered by unit tests of their logic; they could not be live-tested here.
