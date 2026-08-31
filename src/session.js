// Session glue between UI and rules. DOM-free: no window/document references,
// so it can be driven headlessly in Node for tests and replay tooling.
//
// Responsibilities:
// - holds the current rules state (treated as an immutable snapshot by consumers)
// - command dispatch with unique command ids (session id + counter)
// - undo stack for build-phase commands (spawn/joint/delete before run)
// - replay recording: ordered commands + stateHash every 300 ticks
// - pause/resume flag (UI-level: the UI stops stepping while paused)
// - "reset to build" via the rules' reset command

import {
  createSession, applyCommand, stepRun, legalActions, scoreBreakdown,
  stateHash, serializeState,
} from "./rules.js";

const HASH_INTERVAL = 300; // ticks between recorded state hashes

let fallbackCounter = 0;

function makeSessionId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  fallbackCounter += 1;
  return "sess-" + fallbackCounter.toString(36) + "-" + (fallbackCounter * 2654435761 % 0xffffffff).toString(36);
}

export function createGameSession({ level, seed, mode }) {
  let state = createSession({ level, seed, mode });
  const sessionId = makeSessionId();
  let cmdCounter = 0;

  const commandLog = [];   // every successfully applied command, in order
  const hashLog = [];      // [{ tick, hash }] recorded every HASH_INTERVAL ticks
  let undoStack = [];      // build-phase commands eligible for undo
  let paused = false;
  let nextHashTick = HASH_INTERVAL;

  const listeners = new Set();

  function emit(ev) {
    for (const fn of listeners) {
      try { fn(ev); } catch { /* listener errors must not break the session */ }
    }
  }

  function rebuildWithout(droppedId) {
    // Deterministic undo: replay the command log minus the dropped command
    // from a fresh session. Only used for build-phase commands. Like the
    // rules' reset, the invalid-action history is preserved.
    const fresh = createSession({ level: state.level, seed: state.seed, mode: state.mode });
    let s = fresh;
    for (const cmd of commandLog) {
      if (cmd.id === droppedId) continue;
      const res = applyCommand(s, cmd);
      if (!res.error) s = res.state;
    }
    s.invalidActions = state.invalidActions;
    return s;
  }

  const api = {
    get sessionId() { return sessionId; },
    get state() { return state; },
    get paused() { return paused; },
    get commandLog() { return commandLog.slice(); },
    get stateHashes() { return hashLog.slice(); },
    get canUndo() { return state.phase === "build" && undoStack.length > 0; },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    legal() { return legalActions(state); },
    score() { return scoreBreakdown(state); },
    hash() { return stateHash(state); },
    serialize() { return serializeState(state); },

    setPaused(v) {
      const next = !!v;
      if (next !== paused) {
        paused = next;
        emit({ type: "pause", paused, state });
      }
    },

    dispatch(cmd) {
      if (!cmd || typeof cmd !== "object") {
        return { state, events: [], error: { code: "malformed", message: "malformed-command" } };
      }
      cmdCounter += 1;
      const full = { ...cmd, id: sessionId + "-" + cmdCounter };
      const res = applyCommand(state, full);
      if (res.error) {
        // rules count invalid actions in the returned state; failed commands
        // stay out of the replay log so submitted replays remain verifiable.
        state = res.state;
        emit({ type: "command-error", cmd: full, error: res.error, state });
        return res;
      }
      const wasBuild = state.phase === "build";
      state = res.state;
      commandLog.push(full);
      if (full.type === "reset") {
        undoStack = [];
        nextHashTick = HASH_INTERVAL;
      } else if (wasBuild && ["spawn", "joint", "delete"].includes(full.type)) {
        undoStack.push(full);
      } else if (full.type === "run") {
        undoStack = []; // build history is frozen once the sim starts
      }
      emit({ type: "command", cmd: full, events: res.events, state });
      return res;
    },

    undo() {
      if (state.phase !== "build" || undoStack.length === 0) {
        return { ok: false, reason: "nothing-to-undo" };
      }
      const last = undoStack.pop();
      const idx = commandLog.findIndex((c) => c.id === last.id);
      if (idx >= 0) commandLog.splice(idx, 1);
      state = rebuildWithout(last.id);
      emit({ type: "undo", cmd: last, events: [{ type: "undo", target: last.type }], state });
      return { ok: true, undone: last };
    },

    // Advance the run phase by a whole number of fixed ticks.
    step(ticks) {
      const res = stepRun(state, ticks);
      if (res.state !== state) {
        state = res.state;
        while (state.tick >= nextHashTick) {
          hashLog.push({ tick: nextHashTick, hash: stateHash(state) });
          nextHashTick += HASH_INTERVAL;
        }
        emit({ type: "step", events: res.events, state });
        if (state.phase !== "run") {
          // Always record the terminal hash so replays can prove the end state.
          hashLog.push({ tick: state.tick, hash: stateHash(state) });
          emit({ type: "terminal", reason: state.terminalReason, state, score: scoreBreakdown(state) });
        }
      }
      return res;
    },

    // Replay envelope per spec section 5.
    getReplay() {
      return {
        schemaVersion: 1,
        contentVersion: state.contentVersion,
        levelId: state.levelId,
        seed: state.seed,
        mode: state.mode,
        commands: commandLog.slice(),
        stateHashes: hashLog.map((h) => h.hash),
        finalHash: stateHash(state),
        terminalReason: state.terminalReason,
        ticks: state.tick,
      };
    },
  };

  return api;
}
