// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3): on the desktop Journey chamber 1
// is run from the tray to its results, chamber 2 is built by a mouse click in
// the chamber (spawning at the click) and run by the R key, then paused by
// Escape; on the phone lesson 1 is played by finger (a tap in the chamber
// spawns, Run from the tray) to its results; sideways the Speedrun Bay
// challenge is paused and resumed from the rail and run to its results.
// Widgets and the bodies' named targets are found through the page's
// accessibility mirror of the engine's UI. Screenshots of each step go to
// --shots. Fails on console errors or warnings, the runtime's error screen, or
// a view that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000);
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const find = (name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('checkbox', { name, exact: true })).or(page.getByText(name, { exact: true })).first();
  /** A tap / click at window coordinates (CSS px). */
  const tapAt = async (x, y) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  /** The window point of chamber coordinates, from a payload's named target (one unit wide) and its chamber position. */
  const chamberPoint = async (payloadName, px, py, x, y) => {
    const b = await find(payloadName).boundingBox();
    const u = b.width;
    return { x: b.x + b.width / 2 + (x - px) * u, y: b.y + b.height / 2 - (y - py) * u };
  };
  const results = async (text) => { await page.getByText('Score breakdown').first().waitFor({ timeout: 60000 }); await page.getByText(text).first().waitFor({ timeout: 5000 }); await page.waitForTimeout(600); };
  /** A press on a widget (or a table target): the mouse on the desktop, a finger on the phones. */
  const press = async (name) => {
    const el = find(name);
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  let reached = false;
  try {
    await shot('title');
    if (v.name === 'desktop') {
      await press('Play');
      await find('Run (R)').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot('journey-1');
      await press('Run (R)');
      await page.waitForTimeout(500);
      await shot('journey-1-run');
      await results('Delivery complete');
      await shot('journey-1-results');
      await press('Next chamber');
      await find('Wood payload 1').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1000);
      // journey-2 (payload at 8, 8): a wood ball at (7.5, 7.25) nudges it onto the ramp's far side (tools/gen-plays.mjs)
      const p = await chamberPoint('Wood payload 1', 8, 8, 7.5, 7.25);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(200);
      await tapAt(p.x, p.y);
      await find('Wood ball 1').waitFor({ timeout: 10000 });
      await shot('journey-2-spawned');
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await find('Resume').waitFor({ timeout: 15000 });
      await shot('pause');
      await press('Resume');
      await results('Delivery complete');
      await shot('journey-2-results');
    } else if (v.name === 'phone') {
      await press('All modes');
      await press('Learn');
      await find('Wood payload 1').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot('lesson-1');
      const p = await chamberPoint('Wood payload 1', 10, 8, 10, 6);
      await tapAt(p.x, p.y);
      await find('Wood ball 1').waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await shot('lesson-1-spawned');
      await press('Run (R)');
      await results('Delivery complete');
      await shot('lesson-1-results');
    } else {
      await press('All modes');
      await press('Challenge');
      await press('Speedrun Bay');
      await find('Rubber payload 1').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot('challenge-2');
      await press('Pause (Esc)');
      await find('Resume').waitFor({ timeout: 15000 });
      await shot('pause');
      await press('Resume');
      // the tray column scrolls on a short landscape screen: wheel it down to Run
      const w = await find('Wood (1)').boundingBox();
      await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(500);
      await press('Run (R)');
      await page.waitForTimeout(800);
      await shot('challenge-2-run');
      await results('Delivery complete');
      await shot('challenge-results');
    }
    reached = true;
  } catch (e) { problems.push(`play: ${String(e.message || e).split('\n')[0]}`); await shot('failed'); }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && reached;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} played=${reached}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
