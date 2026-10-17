// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Profile & settings →
// Graphics, plays journey chamber 1 with the on-screen tray (spawns bodies at the cursor, Run) and keeps
// retrying from the results screen, so bodies fall, collide, spark and the lamps / dust animate the whole time.
export const presets = ["low", "balanced", "high", "ultra"];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector(".pf-screen-title:not([hidden])", { timeout: 20000 });
  await page.click(".pf-title-grid .pf-card:has-text('Profile & settings')");
  await page.waitForSelector("#pf-gfx-preset");
  await page.selectOption("#pf-gfx-preset", preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click(".pf-overlay .pf-btn-primary:has-text('Done')");
  await page.waitForSelector(".pf-overlay", { state: "detached" });
}

const phase = (page) => page.evaluate(() => {
  if (!document.querySelector(".pf-screen-results[hidden]") && document.querySelector(".pf-screen-results")) return "results";
  const m = /Phase: (\w+)/.exec(document.getElementById("pf-phase")?.textContent || "");
  return m ? m[1] : "";
});

async function step(page) {
  const p = await phase(page);
  if (p === "results") return page.click(".pf-screen-results .pf-btn:has-text('Retry')", { timeout: 3000 });
  if (p !== "build") return;
  // a few extra bodies around the cursor, then Run
  for (const m of ["l", "l", "u", "r", "r", "r"]) {
    await page.click(`.pf-cursor-ctl .pf-cur-${m}`, { timeout: 1000 }).catch(() => {});
    await page.click(".pf-tray .pf-btn:has-text('Spawn at cursor')", { timeout: 1000 }).catch(() => {});
  }
  await page.click(".pf-tray .pf-btn-go", { timeout: 3000 });
}

export async function start(page) {
  await page.click(".pf-screen-title .pf-btn-big");
  await page.waitForSelector(".pf-screen-play:not([hidden])");
  let open = true;
  page.once("close", () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
