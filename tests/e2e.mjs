/**
 * Physics Foundry — end-to-end playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title -> Play (journey level 1) -> build phase -> Run -> results (win)
 *   -> Next chamber (journey 2) -> pause -> settings (apply) -> resume
 *   -> leave -> title -> profile/settings open+close -> help -> Learn lesson 1
 *   (spawn via keyboard, run, results) -> progression persisted.
 * Then a fresh mobile context (390x844, touch) repeats: title -> Play -> Run
 * -> results -> pause button -> resume.
 * Both passes finish with the Graphics panel: Auto (detected Low on the
 * software GPU) -> Low -> High, a Bloom override, live apply + summary,
 * reload persistence, preset-clears-overrides, and an Ultra chamber run.
 * Console errors AND warnings fail the run.
 *
 * Server: an embedded minimal static server on an ephemeral port. The repo's
 * server.js is the declared StarHermit authoritative script (starhermit.txt:
 * server=server.js) and its API routes mutate data/*.json, so it is NOT used
 * here. Standalone the client makes zero same-origin /api or /ws requests
 * (asserted below): daily seed, boards and achievements are local.
 *
 * Run: npm run test:e2e
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { launchToken, stubStarHermit } from "./starhermit-e2e.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOT = (stage, vp) => `/tmp/physics-foundry-e2e-${stage}-${vp}.png`;

// Benign GPU/swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".ts": "text/typescript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      const filePath = path.normalize(path.join(ROOT, rel));
      if (!filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not-found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

async function waitPhase(page, phase, timeout = 15000) {
  await page.waitForFunction(
    (p) => document.getElementById("pf-phase")?.textContent.includes("Phase: " + p),
    phase,
    { timeout },
  );
}

const savedGraphics = (page) => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("pf-settings-v1")).payload).graphics);

// Graphics panel through the visible UI: Auto -> Low -> High, one override,
// live apply (body + canvas data-gfx-preset, summary), persistence across a
// reload, then an Ultra chamber run (no console noise in any preset).
async function graphicsPass(page, label) {
  await step(`[${label}] graphics: presets, override, live apply`, async () => {
    await page.click(".pf-title-grid .pf-card:has-text('Profile & settings')");
    await page.waitForSelector(".pf-overlay[aria-label='Settings']");
    const section = page.locator("#pf-gfx-section");
    await section.scrollIntoViewIfNeeded();
    const autoText = await page.locator("#pf-gfx-preset option[value='auto']").textContent();
    if (!/Auto \(detected: Low\)/.test(autoText)) throw new Error("software GPU should auto-detect Low: " + autoText);
    if ((await page.evaluate(() => document.body.dataset.gfxPreset)) !== "low") throw new Error("auto did not resolve to low");
    await page.selectOption("#pf-gfx-preset", "low");
    await page.selectOption("#pf-gfx-preset", "high");
    await page.waitForFunction(() => document.body.dataset.gfxPreset === "high");
    const shadowsOpt = await page.locator("#pf-gfx-shadows option[value='preset']").textContent();
    if (!shadowsOpt.includes("Medium")) throw new Error("From preset label wrong: " + shadowsOpt);
    await page.selectOption("#pf-gfx-bloom", "off");
    const summary = await page.textContent("#pf-gfx-summary");
    if (!/shadows/.test(summary) || /bloom/.test(summary) || !/px/.test(summary)) throw new Error("summary not updated: " + summary);
    const g = await savedGraphics(page);
    if (g.preset !== "high" || g.bloom !== "off") throw new Error("graphics not saved: " + JSON.stringify(g));
    // panel fits: the Done button is reachable inside the scrolling panel
    await page.locator(".pf-overlay .pf-btn-primary:has-text('Done')").scrollIntoViewIfNeeded();
    const box = await page.locator(".pf-panel.pf-settings").boundingBox();
    const vp = page.viewportSize();
    if (box.x < 0 || box.y < 0 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) {
      throw new Error("settings panel overflows viewport: " + JSON.stringify(box));
    }
    await page.screenshot({ path: SHOT("graphics", label) });
  });

  await step(`[${label}] graphics: survives reload, applies to chamber`, async () => {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".pf-screen-title:not([hidden])");
    if ((await page.evaluate(() => document.body.dataset.gfxPreset)) !== "high") throw new Error("preset lost on reload");
    await page.click(".pf-title-grid .pf-card:has-text('Profile & settings')");
    await page.waitForSelector("#pf-gfx-section");
    if ((await page.inputValue("#pf-gfx-preset")) !== "high") throw new Error("preset select not restored");
    if ((await page.inputValue("#pf-gfx-bloom")) !== "off") throw new Error("override not restored");
    // choosing a preset clears overrides
    await page.selectOption("#pf-gfx-preset", "ultra");
    if ((await page.inputValue("#pf-gfx-bloom")) !== "preset") throw new Error("preset did not clear overrides");
    const g = await savedGraphics(page);
    if (g.preset !== "ultra" || "bloom" in g) throw new Error("ultra not saved cleanly: " + JSON.stringify(g));
    await page.click(".pf-overlay .pf-btn-primary:has-text('Done')");
    await page.click(".pf-screen-title .pf-btn-big");
    await waitPhase(page, "build");
    await page.waitForFunction(() => document.querySelector(".pf-canvas")?.dataset.gfxPreset === "ultra");
    await page.click(".pf-tray .pf-btn-go");
    await waitPhase(page, "run");
    await page.waitForTimeout(600);
    await page.screenshot({ path: SHOT("ultra", label) });
    await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Pause')");
    await page.click(".pf-overlay .pf-btn:has-text('Leave chamber')");
    await page.waitForSelector(".pf-screen-title:not([hidden])");
  });
}

// Signed in through a stubbed StarHermit API (page.route; no real network):
// Automatic follows the account's preferred language (fr-CA), a choice made in
// Settings mid-chamber re-renders the HUD, pause panel and settings in place and
// is saved as ui.language, and Report a problem posts to /reports.
async function languagePass(page, label) {
  await step(`[${label}] language: Automatic = account fr-CA; switch to German mid-chamber; ui.language; report`, async () => {
    runPass.stubbed = true; // the stubbed /api/v1 calls are routed, never reach the own server
    const calls = await stubStarHermit(page, { preferredLanguage: "fr-CA" });
    await page.goto("about:blank");
    await page.goto(`http://127.0.0.1:${runPass.port}/index.html#game_token=` + launchToken(), { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.lang === "fr-CA");
    await page.waitForSelector(".pf-screen-title:not([hidden])");
    if (!/Jouer/.test(await page.textContent(".pf-screen-title .pf-btn-big"))) throw new Error("title not in French");
    await page.click(".pf-screen-title .pf-btn-big");
    await page.waitForFunction(() => /Phase : construction/.test(document.getElementById("pf-phase")?.textContent || ""));
    const budget = await page.textContent("#pf-budget");
    await page.click(".pf-screen-play .pf-rail-left [data-i18n='Pause (Esc)']");
    await page.click(".pf-overlay [data-i18n='Settings']");
    const choice = page.locator("[data-game-language='choice']");
    await choice.scrollIntoViewIfNeeded();
    const auto = await choice.locator("option").first().textContent();
    if (!/^Automatique — Français \(Canada\)$/.test(auto)) throw new Error("Automatic label not resolved: " + auto);
    await choice.selectOption("de-DE");
    await page.waitForFunction(() => document.documentElement.lang === "de-DE");
    await page.waitForFunction(() => /gespeichert/.test(document.querySelector("[data-game-language='status']").textContent));
    if (calls.settings["ui.language"]?.choice !== "de-DE") throw new Error("ui.language not saved: " + JSON.stringify(calls.settings));
    if (!/Einstellungen/.test(await page.textContent(".pf-settings h2"))) throw new Error("settings title not re-rendered");
    if (!/Grafik/.test(await page.textContent("#pf-gfx-head"))) throw new Error("graphics section not re-rendered");
    await page.locator("[data-game-report='title']").scrollIntoViewIfNeeded();
    await page.fill("[data-game-report='title']", "Test report");
    await page.click("[data-game-report='send']");
    await page.waitForFunction(() => /Danke/.test(document.querySelector("[data-game-report='status']").textContent));
    if (!calls.reports?.[0] || calls.reports[0].kind !== "bug") throw new Error("report not posted");
    await page.screenshot({ path: SHOT("language-settings", label) });
    await page.locator(".pf-overlay [data-i18n='Done']").scrollIntoViewIfNeeded();
    await page.click(".pf-overlay [data-i18n='Done']");
    if (!/Pausiert/.test(await page.textContent(".pf-overlay h2"))) throw new Error("pause panel not in German");
    await page.click(".pf-overlay [data-i18n='Resume']");
    await page.waitForFunction(() => /Phase: Aufbau/.test(document.getElementById("pf-phase")?.textContent || ""));
    const budgetDe = await page.textContent("#pf-budget");
    if (budgetDe.replace(/\D+/g, " ").trim() !== budget.replace(/\D+/g, " ").trim()) throw new Error("chamber state changed: " + budget + " -> " + budgetDe);
    if (!/Fracht/.test(await page.textContent("#pf-objective"))) throw new Error("HUD not re-rendered");
    if (!/Am Cursor platzieren/.test(await page.textContent(".pf-tray"))) throw new Error("action tray not re-rendered");
    // nothing in the German HUD/tray spills out of the viewport
    const overflow = await page.evaluate(() => [...document.querySelectorAll(".pf-screen-play button, .pf-screen-play p, .pf-screen-play h2, .pf-top *")]
      .filter((n) => n.offsetParent && n.getBoundingClientRect().right > window.innerWidth + 1).map((n) => n.textContent.slice(0, 30)));
    if (overflow.length) throw new Error("German UI overflows the viewport: " + overflow.join(" | "));
    await page.screenshot({ path: SHOT("language-play", label) });
    await page.click(".pf-screen-play .pf-rail-left [data-i18n='Pause (Esc)']");
    await page.click(".pf-overlay [data-i18n='Settings']");
    await choice.scrollIntoViewIfNeeded();
    await choice.selectOption("auto");
    await page.waitForFunction(() => document.documentElement.lang === "fr-CA");
    await page.click(".pf-overlay [data-i18n='Done']");
    await page.click(".pf-overlay [data-i18n='Leave chamber']");
    await page.waitForSelector(".pf-screen-title:not([hidden])");
    if (!/Jouer/.test(await page.textContent(".pf-screen-title .pf-btn-big"))) throw new Error("title not back in French");
    await page.unroute(/\/api\/v1\//);
  });
}

async function runPass(browser, label, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!runPass.stubbed && u.port === String(runPass.port) && /^\/(api|ws)(\/|$)/.test(u.pathname)) errors.push(`own-server request: ${r.method()} ${u.pathname}`);
  });
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  try {
    await step("load + title visible", async () => {
      await page.goto(`http://127.0.0.1:${runPass.port}/`, { waitUntil: "load" });
      await page.waitForSelector(".pf-screen-title:not([hidden])", { timeout: 10000 });
      await page.waitForSelector(".pf-screen-title .pf-btn-big:visible");
      await page.screenshot({ path: SHOT("title", label) });
    });

    await step("Play -> journey level 1 build phase", async () => {
      await page.click(".pf-screen-title .pf-btn-big"); // "Play"
      await page.waitForSelector(".pf-screen-play:not([hidden])");
      await waitPhase(page, "build");
      const objective = await page.textContent("#pf-objective");
      if (!objective.includes("First Drop")) throw new Error("unexpected level: " + objective);
      await page.screenshot({ path: SHOT("build", label) });
    });

    await step("Run -> simulation -> win -> results", async () => {
      await page.click(".pf-tray .pf-btn-go"); // "Run (R)"
      await waitPhase(page, "run");
      await page.screenshot({ path: SHOT("run", label) });
      await page.waitForSelector(".pf-screen-results:not([hidden])", { timeout: 20000 });
      const h2 = await page.textContent(".pf-screen-results h2");
      if (!h2.includes("Delivery complete")) throw new Error("expected win, got: " + h2);
      const rows = await page.locator(".pf-score-table tr").count();
      if (rows < 6) throw new Error("score breakdown missing rows: " + rows);
      await page.screenshot({ path: SHOT("results", label) });
    });

    if (label === "desktop") {
      await step("Next chamber -> journey level 2", async () => {
        await page.click(".pf-screen-results .pf-btn-primary"); // "Next chamber"
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        await waitPhase(page, "build");
        const objective = await page.textContent("#pf-objective");
        if (!objective.includes("Off the Mark")) throw new Error("unexpected level: " + objective);
      });

      await step("pause -> settings (apply) -> done -> resume", async () => {
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");
        await page.screenshot({ path: SHOT("pause", label) });
        await page.click(".pf-overlay .pf-btn:has-text('Settings')");
        await page.waitForSelector(".pf-overlay[aria-label='Settings']");
        await page.check(".pf-overlay input[aria-label='Reduced motion']");
        await page.selectOption("#pf-gfx-preset", "low");
        const applied = await page.evaluate(() => ({
          rm: document.body.classList.contains("pf-rm"),
          saved: JSON.parse(JSON.parse(localStorage.getItem("pf-settings-v1")).payload).graphics.preset,
          canvas: document.querySelector(".pf-canvas").dataset.gfxPreset,
        }));
        if (!applied.rm || applied.saved !== "low" || applied.canvas !== "low") throw new Error("settings not applied: " + JSON.stringify(applied));
        await page.screenshot({ path: SHOT("settings", label) });
        await page.click(".pf-overlay .pf-btn-primary:has-text('Done')");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']"); // back to pause
        await page.click(".pf-overlay .pf-btn-primary:has-text('Resume')");
        await page.waitForSelector(".pf-overlay", { state: "detached" });
        await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Pause')");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");
        await page.click(".pf-overlay .pf-btn:has-text('Leave chamber')");
        await page.waitForSelector(".pf-screen-title:not([hidden])");
      });

      await step("profile & settings open/close from title", async () => {
        await page.click(".pf-title-grid .pf-card:has-text('Profile & settings')");
        await page.waitForSelector(".pf-overlay[aria-label='Settings']");
        await page.click(".pf-overlay .pf-btn-primary:has-text('Done')");
        await page.waitForSelector(".pf-overlay", { state: "detached" });
      });

      await step("help screen open/close", async () => {
        await page.click(".pf-title-foot .pf-btn:has-text('How to play')");
        await page.waitForSelector(".pf-screen-help:not([hidden])");
        await page.screenshot({ path: SHOT("help", label) });
        await page.click(".pf-screen-help .pf-btn:has-text('Back')");
        await page.waitForSelector(".pf-screen-title:not([hidden])");
      });

      await step("Escape closes title settings; help returns to its opener; restart from pause", async () => {
        // settings opened from the title (no play session) closes with Escape
        await page.click(".pf-title-grid .pf-card:has-text('Profile & settings')");
        await page.waitForSelector(".pf-overlay[aria-label='Settings']");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pf-overlay", { state: "detached" });

        await page.click(".pf-screen-title .pf-btn-big"); // Play
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        await waitPhase(page, "build");

        // help from the play HUD pauses the chamber and returns to it
        await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Help')");
        await page.waitForSelector(".pf-screen-help:not([hidden])");
        const paused = await page.textContent("#pf-phase");
        if (!paused.includes("(paused)")) throw new Error("help did not pause the chamber: " + paused);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        const resumed = await page.textContent("#pf-phase");
        if (resumed.includes("(paused)")) throw new Error("chamber still paused after help: " + resumed);

        // help from the pause panel returns to the pause panel
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");
        await page.click(".pf-overlay .pf-btn:has-text('Help')");
        await page.waitForSelector(".pf-screen-help:not([hidden])");
        await page.click(".pf-screen-help .pf-btn:has-text('Back')");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");

        // restart from the pause panel returns a fresh build phase
        await page.click(".pf-overlay .pf-btn:has-text('Restart chamber')");
        await page.waitForSelector(".pf-overlay", { state: "detached" });
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        await waitPhase(page, "build");

        await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Pause')");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");
        await page.click(".pf-overlay .pf-btn:has-text('Leave chamber')");
        await page.waitForSelector(".pf-screen-title:not([hidden])");
      });

      await step("learn lesson 1: banner, keyboard spawn, run, results", async () => {
        await page.click(".pf-title-grid .pf-card:has-text('All modes')");
        await page.waitForSelector(".pf-screen-modes:not([hidden])");
        await page.click(".pf-mode-grid .pf-card:has-text('Learn')");
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        await page.waitForSelector("#pf-lesson:not([hidden])");
        await waitPhase(page, "build");
        // keyboard play: nudge cursor, spawn wood (Enter), then run (R)
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          () => document.getElementById("pf-lesson")?.textContent.includes("Lesson complete"),
          null,
          { timeout: 5000 },
        );
        const progress = await page.textContent("#pf-budget");
        if (!progress.includes("/ 2")) throw new Error("spawn not counted: " + progress);
        await page.screenshot({ path: SHOT("learn", label) });
        await page.keyboard.press("r");
        await page.waitForSelector(".pf-screen-results:not([hidden])", { timeout: 20000 });
        await page.click(".pf-screen-results .pf-btn:has-text('Modes')");
        await page.waitForSelector(".pf-screen-modes:not([hidden])");
        await page.click(".pf-screen-modes .pf-btn:has-text('Back')");
        await page.waitForSelector(".pf-screen-title:not([hidden])");
      });

      await step("progression persisted", async () => {
        const prog = await page.evaluate(() => {
          const doc = JSON.parse(localStorage.getItem("pf-progress-v1"));
          return JSON.parse(doc.payload);
        });
        if (!prog.completed["journey-1"]) throw new Error("journey-1 win not persisted");
        if (!prog.lessonsDone["learn-1"]) throw new Error("learn-1 lesson not persisted");
        console.log("  completed:", Object.keys(prog.completed).join(","), "| lessons:", Object.keys(prog.lessonsDone).join(","));
      });
    } else {
      // mobile pass: pause via the visible rail button, then resume
      await step("pause via rail button -> resume", async () => {
        await page.click(".pf-screen-results .pf-btn:has-text('Retry')");
        await page.waitForSelector(".pf-screen-play:not([hidden])");
        await waitPhase(page, "build");
        await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Pause')");
        await page.waitForSelector(".pf-overlay[aria-label='Paused']");
        await page.screenshot({ path: SHOT("pause", label) });
        await page.click(".pf-overlay .pf-btn-primary:has-text('Resume')");
        await page.waitForSelector(".pf-overlay", { state: "detached" });
        const trayBtn = await page.locator(".pf-tray .pf-btn-go").boundingBox();
        if (!trayBtn || trayBtn.width < 44 || trayBtn.height < 44) {
          throw new Error("Run target too small on mobile: " + JSON.stringify(trayBtn));
        }
      });
    }
    if (label === "mobile") {
      await step("mobile: leave chamber for the graphics pass", async () => {
        await page.click(".pf-screen-play .pf-rail-left .pf-btn:has-text('Pause')");
        await page.click(".pf-overlay .pf-btn:has-text('Leave chamber')");
        await page.waitForSelector(".pf-screen-title:not([hidden])");
      });
    }
    await graphicsPass(page, label);
    await languagePass(page, label);
  } finally {
    runPass.stubbed = false;
    await context.close();
  }

  if (errors.length) {
    throw new Error(`[${label}] page errors:\n` + errors.join("\n"));
  }
  console.log(`ok - ${label} pass clean (no page errors)`);
}

const { server, port } = await serve();
runPass.port = port;
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  console.log(`serving ${ROOT} on 127.0.0.1:${port}`);
  await runPass(browser, "desktop", { width: 1280, height: 800 }, false);
  await runPass(browser, "mobile", { width: 390, height: 844 }, true);
  console.log("\nE2E PASS — both viewport passes clean");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
