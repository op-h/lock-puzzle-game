// Shared puzzle invariants (ADR 0003 #1-#3, #6). Used by the per-difficulty property tests so each
// difficulty runs in its own process under `node --test`.

import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../../js/config.js';
import { satisfies, validateClue, clueKey } from '../../js/engine/clues.js';
import { solutions } from '../../js/engine/solver.js';
import { refFeedback, refSatisfies, refSolutions, refAllCodes, eqCode } from './reference.mjs';

/**
 * Throws (with the puzzle id in the message) if any invariant is violated.
 * @param {import('../../js/engine/generator.js').Puzzle} p
 * @param {{range?: boolean}} [opts] range:false skips the clue-count window (fallback path only)
 */
export function checkPuzzle(p, { range = true } = {}) {
  const cfg = DIFFICULTIES[p.difficulty];
  const tag = `[${p.id}]`;
  assert.ok(cfg, `${tag} known difficulty`);

  // identity
  assert.ok(Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 0xffffffff, `${tag} seed is uint32`);
  assert.equal(p.id, `${p.difficulty}-${p.seed.toString(36)}`, `${tag} id format`);
  assert.equal(p.length, cfg.length, `${tag} length`);
  assert.equal(p.repeats, cfg.repeats, `${tag} repeats`);

  // answer
  assert.equal(p.answer.length, cfg.length, `${tag} answer length`);
  assert.ok(p.answer.every((d) => Number.isInteger(d) && d >= 0 && d <= 9), `${tag} answer digits`);
  if (!cfg.repeats) assert.equal(new Set(p.answer).size, cfg.length, `${tag} answer has no repeated digit`);

  // clue set shape
  if (range) {
    assert.ok(
      p.clues.length >= cfg.clues[0] && p.clues.length <= cfg.clues[1],
      `${tag} clue count ${p.clues.length} outside [${cfg.clues}]`,
    );
  }
  const keys = p.clues.map(clueKey);
  assert.equal(new Set(keys).size, keys.length, `${tag} duplicate clues`);

  const spec = { length: p.length, repeats: p.repeats };
  for (const c of p.clues) {
    assert.ok(cfg.kinds.includes(c.kind), `${tag} kind ${c.kind} not allowed`);
    validateClue(c, p.length);
    assert.ok(satisfies(c, p.answer), `${tag} engine: clue false for the answer ${JSON.stringify(c)}`);
    assert.ok(refSatisfies(c, p.answer), `${tag} reference: clue false for the answer ${JSON.stringify(c)}`);
    if (c.kind === 'feedback') {
      assert.equal(new Set(c.guess).size, c.guess.length, `${tag} feedback guess has repeated digits`);
      assert.ok(!eqCode(c.guess, p.answer), `${tag} a clue guess equals the answer`);
      const r = refFeedback(c.guess, p.answer);
      assert.deepEqual({ bulls: c.bulls, cows: c.cows }, r, `${tag} stored bulls/cows`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, `${tag} not JSON-serialisable as plain data`);

  // uniqueness and minimality, through the shipped solver
  const sols = solutions(spec, p.clues, 2);
  assert.equal(sols.length, 1, `${tag} expected exactly one solution, got ${sols.length}`);
  assert.ok(eqCode(sols[0], p.answer), `${tag} the unique solution is not the answer`);
  for (let i = 0; i < p.clues.length; i++) {
    const rest = p.clues.filter((_, j) => j !== i);
    assert.equal(solutions(spec, rest, 2).length, 2, `${tag} clue #${i} is redundant (${JSON.stringify(p.clues[i])})`);
  }
}

const spaces = new Map();

/** Same claims, re-derived by the independent brute force (slower; used on a sample). */
export function checkPuzzleIndependent(p) {
  const key = `${p.length}:${p.repeats}`;
  if (!spaces.has(key)) spaces.set(key, refAllCodes(p.length, p.repeats));
  const all = spaces.get(key);
  const sols = refSolutions(p, p.clues, all);
  assert.equal(sols.length, 1, `[${p.id}] independent solver: ${sols.length} solutions`);
  assert.ok(eqCode(sols[0], p.answer), `[${p.id}] independent solver disagrees on the answer`);
  for (let i = 0; i < p.clues.length; i++) {
    const rest = p.clues.filter((_, j) => j !== i);
    assert.ok(refSolutions(p, rest, all).length >= 2, `[${p.id}] independent solver: clue #${i} redundant`);
  }
}
