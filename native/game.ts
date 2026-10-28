// The browser build's pure game modules (shared with the node tests), typed
// for this client: the rules (src/rules.js: the deterministic fixed-step
// physics, legality, scoring, replay), the content (src/content.js: themes,
// the six lessons, the 44 Journey chambers, the four challenges, the Daily,
// achievements), the session (src/session.js: validated commands, undo,
// replay log, run stepping) and the save model (src/progress.js).
import * as rules from "../src/rules.js";
import * as content from "../src/content.js";
import * as sessionMod from "../src/session.js";
import * as progress from "../src/progress.js";

export interface Rect2 { x: number; y: number; w: number; h: number }
export interface Target { x: number; y: number; r: number }
export interface LessonStep { text: string; requireCommand: { type: string; material?: string; joint?: string } }
export interface Level {
  id: string; version: number; name: string; mode: string; seed: number; theme: string; difficulty: number;
  timeLimitTicks: number; spawnBudget: number; allowedMaterials: string[]; allowedJoints: string[];
  payloads: { material: string; x: number; y: number }[]; targets: Target[]; obstacles: Rect2[]; hazards: Rect2[];
  par: { spawns: number; timeTicks: number }; intro: string; mechanicsIntroduced: string[]; gravity?: number;
  steps?: LessonStep[]; tutorialFlags?: { mastery?: boolean };
}
export interface Body { id: string; kind: "payload" | "player"; material: string; x: number; y: number; vx: number; vy: number; r: number }
export interface Joint { id: string; type: string; a: string; b: string; restLength: number }
export interface GameEvent { type: string; id?: string; material?: string; x?: number; y?: number; a?: string; b?: string; target?: string; kind?: string; joint?: string; tick?: number }
export interface State {
  level: Level; phase: "build" | "run" | "won" | "lost"; tick: number; bodies: Body[]; joints: Joint[]; spawnBudget: number; movesUsed: number;
  invalidActions: number; runStartTick: number | null; goals: { delivered: number; total: number; status: string }; terminalReason: string | null;
  seed: number; mode: string;
}
export interface Legal { type: string; material?: string; joint?: string; ok: boolean; reason?: string }
export interface Score { components: { goal: number; timeBonus: number; materialEfficiency: number; spawnEfficiency: number; invalidPenalty: number }; total: number }
export interface Command { type: string; material?: string; joint?: string; x?: number; y?: number; a?: string; b?: string; target?: string; id?: string }
export interface CommandResult { state: State; events: GameEvent[]; error: { code: string; message: string } | null }
export interface SessionEvent { type: string; cmd?: Command; events?: GameEvent[]; error?: { code: string; message: string }; state: State; reason?: string; score?: Score }
export interface Session {
  readonly state: State; readonly paused: boolean; readonly canUndo: boolean; readonly sessionId: string;
  on(fn: (e: SessionEvent) => void): () => void;
  legal(): Legal[]; score(): Score; hash(): string;
  setPaused(v: boolean): void;
  dispatch(cmd: Command): CommandResult;
  undo(): { ok: boolean; reason?: string; undone?: Command };
  step(ticks: number): { state: State; events: GameEvent[] };
}
export interface Theme { id: string; name: string; palette: { background: string; floor: string; wall: string; accent: string; uiAccent: string } }
export interface Achievement { key: string; name: string; description: string }
export interface Material { id: string; name: string; color: string; density: number; restitution: number; shatterSpeed?: number }
export interface JointType { id: string; name: string; maxLength: number; stiffness?: number }

export interface Progress {
  version: number; playerId: string; completed: Record<string, boolean>; stars: Record<string, boolean>; lessonsDone: Record<string, boolean>;
  achievements: string[]; counters: { spawns: number; wins: number; streak: number }; bests: Record<string, number>;
  dailyAttempts: Record<string, { score: number }>; lastMode: string;
}
export interface SaveDoc { v: number; progress: Progress }
export interface Options { leftHanded: boolean; cameraDefault: "frame" | "tight"; jointMode: "toggle" | "hold"; haptics: boolean }
export interface RunRecord { levelId: string; won: boolean; total: number; movesUsed: number; elapsedTicks: number; par: { spawns: number; timeTicks: number }; daily: string | null }

interface RulesApi {
  CHAMBER: { w: number; h: number }; DT: number; BALL_RADIUS: number;
  MATERIALS: Record<string, Material>; JOINT_TYPES: Record<string, JointType>;
  makeRng(seed: number): { next(): number; int(lo: number, hi: number): number };
}
interface ContentApi {
  THEMES: Record<string, Theme>; LEARN_LESSONS: Level[]; JOURNEY_LEVELS: Level[]; CHALLENGE_LEVELS: Level[];
  ACHIEVEMENTS: Record<string, Achievement>; dailyLevel(date: string): Level;
}
interface ProgressApi {
  defaultSave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSave(remote: unknown, local: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): { save: SaveDoc; options: Partial<Options> } | null;
  recordSpawn(p: Progress): string[]; recordLesson(p: Progress, id: string): { first: boolean; newly: string[] };
  recordRun(p: Progress, run: RunRecord): { firstWin: boolean; prevBest: number; newBest: boolean; newly: string[] };
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; pickOptions(raw: unknown): Partial<Options>;
}

export const Rules = rules as unknown as RulesApi;
export const Content = content as unknown as ContentApi;
export const Progress = progress as unknown as ProgressApi;
export const createGameSession = (sessionMod as unknown as { createGameSession(o: { level: Level; seed: number; mode: string }): Session }).createGameSession;
