// Physics Foundry authoritative server: static files + JSON API + replay validation.
// Zero npm dependencies, Node >= 18, ESM.

import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCHEMA_VERSION, dailySeed, verifyReplay } from "./src/rules.js";
import { CONTENT_VERSION, ACHIEVEMENTS, dailyLevel, getLevel } from "./src/content.js";

const dailySeedLevel = dailySeed;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const LB_FILE = path.join(DATA_DIR, "leaderboards.json");
const ACH_FILE = path.join(DATA_DIR, "achievements.json");

const MAX_BODY_BYTES = 256 * 1024;
const MAX_COMMANDS = 5000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".opus": "audio/ogg",
};

// ---------------------------------------------------------------- storage

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

// ---------------------------------------------------------------- rate limit

const buckets = new Map(); // ip -> {tokens, ts}
const RATE_LIMIT = 120;       // burst
const RATE_REFILL = 2;        // tokens per second

function rateOk(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: RATE_LIMIT, ts: now }; buckets.set(ip, b); }
  b.tokens = Math.min(RATE_LIMIT, b.tokens + ((now - b.ts) / 1000) * RATE_REFILL);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------- helpers

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers["content-length"] || 0);
    if (len > MAX_BODY_BYTES) { reject(new Error("too-large")); req.destroy(); return; }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sanitizeName(name) {
  if (typeof name !== "string") return null;
  // strip control chars, trim
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (clean.length < 3 || clean.length > 24) return null;
  return clean;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function sortEntries(entries) {
  // primary completion (goal component), fewer invalid actions, lower duration, stable id
  return entries.sort((a, b) =>
    (b.components?.goal ?? 0) - (a.components?.goal ?? 0)
    || (a.invalidActions ?? 0) - (b.invalidActions ?? 0)
    || (a.durationMs ?? 0) - (b.durationMs ?? 0)
    || String(a.id).localeCompare(String(b.id)));
}

let entryCounter = 0;

async function handleLeaderboardSubmit(req, res, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return send(res, 400, { error: "bad-json" });
  }
  if (!data || typeof data !== "object") return send(res, 400, { error: "bad-json" });

  const board = data.board === "daily" ? "daily" : data.board === "global" ? "global" : null;
  if (!board) return send(res, 400, { error: "bad-board" });

  const name = sanitizeName(data.name);
  if (!name) return send(res, 400, { error: "bad-name" });

  if (data.contentVersion !== CONTENT_VERSION || data.rulesetVersion !== SCHEMA_VERSION) {
    return send(res, 422, { error: "version-mismatch" });
  }
  if (!Array.isArray(data.commands) || data.commands.length > MAX_COMMANDS) {
    return send(res, 422, { error: "bad-commands" });
  }

  // resolve level + expected seed
  let level, expectedSeed, date = null;
  if (board === "daily") {
    date = typeof data.date === "string" ? data.date : utcToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: "bad-date" });
    level = dailyLevel(date);
    expectedSeed = dailySeedLevel(date);
  } else {
    level = typeof data.levelId === "string" ? getLevel(data.levelId) : null;
    if (!level) return send(res, 400, { error: "unknown-level" });
    expectedSeed = level.seed;
  }
  if (data.seed !== expectedSeed) return send(res, 422, { error: "seed-mismatch" });

  const result = verifyReplay(level, expectedSeed, data.commands);
  if (!result.ok) return send(res, 422, { error: "replay-mismatch" });

  if (Array.isArray(data.stateHashes) && data.stateHashes.length > 0) {
    const claimed = data.stateHashes[data.stateHashes.length - 1];
    if (claimed !== result.finalHash) return send(res, 422, { error: "replay-mismatch" });
  }

  const store = await readJson(LB_FILE, { boards: {} });
  const key = board === "daily" ? "daily:" + date : "global";
  const entries = store.boards[key] || [];
  const entry = {
    id: "e" + Date.now().toString(36) + "-" + (entryCounter++),
    name,
    score: result.scoreBreakdown.total,
    components: result.scoreBreakdown.components,
    invalidActions: Math.max(0, Math.round(-(result.scoreBreakdown.components.invalidPenalty || 0) / 25)),
    seed: expectedSeed,
    date,
    assists: data.assists ? 1 : 0,
    durationMs: Number.isFinite(data.durationMs) ? Math.max(0, Math.round(data.durationMs)) : 0,
    terminalReason: result.terminalReason,
    ts: Date.now(),
  };
  entries.push(entry);
  sortEntries(entries);
  store.boards[key] = entries;
  await writeJsonAtomic(LB_FILE, store);
  const rank = entries.indexOf(entry) + 1;
  return send(res, 200, { ok: true, rank, score: entry.score });
}

async function handleAchievement(req, res, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return send(res, 400, { error: "bad-json" });
  }
  if (!data || typeof data !== "object"
      || typeof data.playerId !== "string" || data.playerId.length === 0 || data.playerId.length > 128) {
    return send(res, 400, { error: "bad-player" });
  }
  if (!ACHIEVEMENTS[data.key]) return send(res, 400, { error: "unknown-key" });
  const store = await readJson(ACH_FILE, { players: {} });
  const owned = store.players[data.playerId] || [];
  const already = owned.includes(data.key);
  if (!already) {
    owned.push(data.key);
    store.players[data.playerId] = owned;
    await writeJsonAtomic(ACH_FILE, store);
  }
  return send(res, 200, { ok: true, already });
}

async function handleLeaderboardGet(res, url) {
  const board = url.searchParams.get("board") || "global";
  if (!["global", "daily"].includes(board)) return send(res, 400, { error: "bad-board" });
  const date = url.searchParams.get("date") || utcToday();
  const key = board === "daily" ? "daily:" + date : "global";
  const store = await readJson(LB_FILE, { boards: {} });
  const entries = (store.boards[key] || []).slice(0, 50).map((e) => ({
    name: e.name, score: e.score, components: e.components, seed: e.seed,
    date: e.date, assists: e.assists, durationMs: e.durationMs, ts: e.ts,
  }));
  return send(res, 200, { board, date: board === "daily" ? date : null, entries });
}

// ---------------------------------------------------------------- static

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, { error: "forbidden" });
  }
  let data;
  try {
    data = await readFile(filePath);
  } catch {
    return send(res, 404, { error: "not-found" });
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const base = path.basename(filePath);
  const hashed = /[-.][0-9a-f]{8,}[-.]/.test(base);
  const cache = ext === ".html" ? "no-cache" : hashed ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  res.end(data);
}

// ---------------------------------------------------------------- server

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;

      if (pathname === "/healthz") return send(res, 200, { ok: true });

      if (pathname.startsWith("/api/")) {
        const ip = req.socket.remoteAddress || "unknown";
        if (!rateOk(ip)) return send(res, 429, { error: "rate-limited" });

        if (req.method === "GET" && pathname === "/api/v1/time") {
          // The `api` marker tells the client the full route set exists;
          // minimal hosts serve only this route, without the marker.
          return send(res, 200, { now: Date.now(), api: "physics-foundry/1" });
        }
        if (req.method === "GET" && pathname === "/api/v1/daily") {
          const date = utcToday();
          return send(res, 200, {
            date,
            seed: dailySeedLevel(date),
            contentVersion: CONTENT_VERSION,
            rulesetVersion: SCHEMA_VERSION,
            excluded: false,
          });
        }
        if (req.method === "GET" && pathname === "/api/v1/leaderboard") {
          return await handleLeaderboardGet(res, url);
        }
        if (req.method === "POST" && pathname === "/api/v1/leaderboard/submit") {
          const body = await readBody(req);
          return await handleLeaderboardSubmit(req, res, body);
        }
        if (req.method === "POST" && pathname === "/api/v1/achievements") {
          const body = await readBody(req);
          return await handleAchievement(req, res, body);
        }
        return send(res, 404, { error: "not-found" });
      }

      if (req.method !== "GET") return send(res, 404, { error: "not-found" });
      return await serveStatic(req, res, pathname);
    } catch (err) {
      if (err && err.message === "too-large") return send(res, 413, { error: "too-large" });
      try { send(res, 500, { error: "internal" }); } catch { /* socket gone */ }
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => {
    console.log("physics-foundry server listening on :" + port);
  });
}
