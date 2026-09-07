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
 *
 * Server: an embedded minimal static server on an ephemeral port. The repo's
 * server.js is the declared StarHermit authoritative script (starhermit.txt:
 * server=server.js) and its API routes mutate data/*.json, so it is NOT used
 * here; the client detects the missing API marker and runs its supported
 * offline/guest path (daily falls back to a local seed, leaderboards show
 * "offline"). All gameplay is local and fully covered.
 *
 * Run: npm run test:e2e
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOT = (stage, vp) => `/tmp/physics-foundry-e2e-${stage}-${vp}.png`;

// Benign GPU/swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions|Failed to load resource: the server responded with a status of 404/i;
// The game deliberately probes GET /api/v1/time on startup even on a partial
// host (platform.js): on the embedded static server it 404s, which the client
// catches and degrades to its offline/guest path. That one benign 404 is what
// the last alternative above (resource-load 404) is covering.

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

async function runPass(browser, label, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
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
        await page.selectOption(".pf-overlay select[aria-label='Graphics quality']", "low");
        const applied = await page.evaluate(() => ({
          rm: document.body.classList.contains("pf-rm"),
          saved: JSON.parse(JSON.parse(localStorage.getItem("pf-settings-v1")).payload).quality,
        }));
        if (!applied.rm || applied.saved !== "low") throw new Error("settings not applied: " + JSON.stringify(applied));
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
  } finally {
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
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
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
