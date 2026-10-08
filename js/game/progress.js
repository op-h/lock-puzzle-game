// Resume an in-progress round after a reload or a closed tab. Device-local only (`lp1.run.<id>`).
//
// Puzzles are pure functions of (difficulty, seed), so only the seed and the player's state are stored;
// the answer is never serialised. Everything read back is untrusted (storage can be edited or
// corrupted): it is sanitised field by field and anything unusable is discarded, never repaired.

import { BLOOD, DIFFICULTIES } from '../config.js';
import { createClassic } from './classic.js';
import { createBlood } from './blood.js';

export const PROGRESS_VERSION = 1;

const MAX_GUESSES = 500;
const MAX_POINTS = 1000000;
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const OWNER_RE = /^[0-9a-f]{8,32}$/;

/** A Blood run whose owning tab wrote its heartbeat within this window is considered live. */
export const HEARTBEAT_STALE_MS = 6000;
export const DEADLINE_TOLERANCE_MS = 2000;

const isUint32 = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const isTime = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 8.64e15;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} list @returns {string[]} digit strings only; length is checked against the puzzle on restore */
function cleanGuesses(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const k of list.slice(0, MAX_GUESSES)) if (typeof k === 'string' && /^[0-9]{1,10}$/.test(k)) out.push(k);
  return out;
}

/**
 * @param {unknown} raw whatever was in storage
 * @returns {null | {mode: 'classic', difficulty: string, seed: number, guesses: string[], usedHint: boolean, hintPos: number|null, elapsedMs: number, startedAt: number|null}
 *   | {mode: 'blood', runId: string, startedAt: number, endsAt: number, solvedInRun: number, points: number, remainingMs: number|null, owner: string|null, hb: number|null, puzzle: null | {seed: number, startedAt: number|null, guesses: string[]}}}
 */
export function sanitizeProgress(raw) {
  if (!isObj(raw) || raw.v !== PROGRESS_VERSION) return null;
  if (raw.mode === 'classic') {
    const { difficulty, seed, usedHint, hintPos, elapsedMs } = raw;
    if (typeof difficulty !== 'string' || !Object.hasOwn(DIFFICULTIES, difficulty)) return null;
    if (!isUint32(seed)) return null;
    return {
      mode: 'classic',
      difficulty,
      seed,
      guesses: cleanGuesses(raw.guesses),
      usedHint: usedHint === true,
      hintPos: usedHint === true && Number.isInteger(hintPos) ? hintPos : null,
      elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs)) : 0,
      startedAt: isTime(raw.startedAt) ? raw.startedAt : null,
    };
  }
  if (raw.mode === 'blood') {
    const { runId, startedAt, endsAt, solvedInRun, points, puzzle } = raw;
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return null;
    if (!isTime(startedAt) || !isTime(endsAt)) return null;
    // A run can only ever be SHORTER than the full countdown (penalties). A clearly longer one was edited. The
    // tolerance exists because startedAt comes from the WALL clock and endsAt from wall + MONOTONIC remaining time:
    // two clocks rounded independently can disagree by a millisecond or two on a perfectly honest, fresh record
    // (this once made a live run look "edited" and got another tab's record wiped).
    if (endsAt > startedAt + BLOOD.durationMs + DEADLINE_TOLERANCE_MS) return null;
    if (!Number.isSafeInteger(solvedInRun) || solvedInRun < 0 || solvedInRun > 1000) return null;
    if (!Number.isSafeInteger(points) || points < 0 || points > MAX_POINTS) return null;
    let p = null;
    if (isObj(puzzle) && isUint32(puzzle.seed)) {
      p = {
        seed: puzzle.seed,
        startedAt: isTime(puzzle.startedAt) ? puzzle.startedAt : null,
        guesses: cleanGuesses(puzzle.guesses),
      };
    }
    return {
      mode: 'blood',
      runId,
      startedAt,
      endsAt,
      solvedInRun,
      points,
      remainingMs: Number.isSafeInteger(raw.remainingMs) && raw.remainingMs >= 0 && raw.remainingMs <= BLOOD.durationMs ? raw.remainingMs : null,
      owner: typeof raw.owner === 'string' && OWNER_RE.test(raw.owner) ? raw.owner : null,
      hb: isTime(raw.hb) ? raw.hb : null,
      puzzle: p,
    };
  }
  return null;
}

/**
 * @param {ReturnType<typeof sanitizeProgress>} rec
 * @param {{now: () => number, wall?: () => number, isSolved?: (puzzleId: string) => boolean, newSeed?: () => number, generate?: Function}} deps
 * @returns {ReturnType<typeof createClassic> | null}
 */
export function restoreClassic(rec, deps) {
  if (!rec || rec.mode !== 'classic') return null;
  try {
    const w = (deps.wall || (() => Date.now()))();
    // The clock never stopped: elapsed is wall time since the puzzle was first shown. The stored elapsedMs (from
    // the monotonic clock at the last save) is a floor, so setting the system clock BACK cannot refund more
    // than the time since that save. That residual gap is unavoidable without a server.
    const sinceStart = rec.startedAt === null ? 0 : w - rec.startedAt;
    const elapsedMs = Math.max(0, rec.elapsedMs, sinceStart);
    const s = createClassic({
      difficulty: /** @type {any} */ (rec.difficulty),
      seed: rec.seed,
      now: deps.now,
      wall: deps.wall,
      generate: /** @type {any} */ (deps.generate),
      restore: { ...rec, elapsedMs },
    });
    // Solved already (crash between recording and clearing): replaying the seed would farm points.
    if (deps.isSolved && deps.isSolved(s.puzzle.id)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Wall clock decides: the run kept ticking while the tab was closed.
 * @param {ReturnType<typeof sanitizeProgress>} rec
 * @param {{now: () => number, wall: () => number, newSeed?: () => number, generate?: Function, onSolve?: Function, onFinish?: Function}} deps
 * @returns {{expired: true, summary: {runId: string, t: number, solved: number, pts: number}} | {expired: false, session: ReturnType<typeof createBlood>} | null}
 */
export function restoreBlood(rec, deps) {
  if (!rec || rec.mode !== 'blood') return null;
  const w = deps.wall();
  if (w >= rec.endsAt) {
    // Finalised by the caller through recordRun(), which is idempotent by runId: restoring twice is harmless.
    return { expired: true, summary: { runId: rec.runId, t: rec.endsAt, solved: rec.solvedInRun, pts: rec.points } };
  }
  try {
    const session = createBlood({
      now: deps.now,
      wall: deps.wall,
      newSeed: deps.newSeed,
      generate: /** @type {any} */ (deps.generate),
      onSolve: /** @type {any} */ (deps.onSolve),
      onFinish: /** @type {any} */ (deps.onFinish),
      restore: {
        runId: rec.runId,
        startedAt: rec.startedAt,
        // min(): a system clock set back would make endsAt - w look bigger; the monotonic remaining time stored at
        // the last heartbeat is the most a restore may ever hand back.
        remainingMs: rec.remainingMs === null ? rec.endsAt - w : Math.min(rec.endsAt - w, rec.remainingMs),
        solvedInRun: rec.solvedInRun,
        points: rec.points,
        puzzle: rec.puzzle
          ? {
              seed: rec.puzzle.seed,
              guesses: rec.puzzle.guesses,
              elapsedMs: rec.puzzle.startedAt === null ? 0 : Math.min(BLOOD.durationMs, Math.max(0, w - rec.puzzle.startedAt)),
            }
          : undefined,
      },
    });
    return { expired: false, session };
  } catch {
    return null;
  }
}

/**
 * Another tab is playing this run if it owns the record and its heartbeat is fresh. A stale heartbeat means
 * that tab was closed (or frozen for good), so this tab may take the run over.
 * @param {ReturnType<typeof sanitizeProgress>} rec
 * @param {string} tabId this tab's id
 * @param {number} wallNow
 * @returns {boolean}
 */
export function isForeignActive(rec, tabId, wallNow) {
  // hb 0 is the explicit release written on pagehide: nothing owns the run any more.
  if (!rec || rec.mode !== 'blood' || rec.owner === null || rec.owner === tabId || rec.hb === null || rec.hb === 0) return false;
  const age = wallNow - rec.hb;
  return age < HEARTBEAT_STALE_MS && age > -HEARTBEAT_STALE_MS;
}

/**
 * The summary for an expired run: the history entries tagged with this run are the source of truth for
 * what was really scored (they were recorded per solve), so take whichever of the two is larger.
 * @param {{runId: string, t: number, solved: number, pts: number}} summary
 * @param {{history?: Array<{r?: string, pts: number}>} | null} save
 */
export function reconcileRunSummary(summary, save) {
  let solved = 0;
  let pts = 0;
  const history = save && Array.isArray(save.history) ? save.history : [];
  for (const e of history) {
    if (e && e.r === summary.runId) {
      solved += 1;
      pts += Number(e.pts) || 0;
    }
  }
  return { id: summary.runId, t: summary.t, solved: Math.max(summary.solved, solved), pts: Math.max(summary.pts, pts) };
}

/**
 * @param {{loadRun: Function, storeRun: Function, clearRun: Function}} local
 * @param {string} id player id
 */
export function createProgress(local, id) {
  return {
    /** @param {Record<string, unknown>} snapshot from classic/blood `snapshot()` */
    save(snapshot) {
      return local.storeRun(id, { v: PROGRESS_VERSION, ...snapshot });
    },
    load() {
      return sanitizeProgress(local.loadRun(id));
    },
    clear() {
      local.clearRun(id);
    },
  };
}
