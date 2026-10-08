// Exhaustive solver. The code space is at most 10^5, so brute force is both fast enough and the only
// approach whose correctness is obvious: uniqueness claims in ADR 0003 rest on this being complete.

import { satisfies, validateClue } from './clues.js';

/** @typedef {{length:number, repeats:boolean}} CodeSpec */

function checkSpec(spec) {
  if (!spec || !Number.isInteger(spec.length) || spec.length < 1 || spec.length > 8) {
    throw new RangeError('spec.length must be an integer in 1..8');
  }
  if (typeof spec.repeats !== 'boolean') throw new TypeError('spec.repeats must be a boolean');
}

/**
 * All codes satisfying every clue, in lexicographic order, stopping at `limit`.
 * Pass limit = 2 to ask "is it unique?" without enumerating the rest.
 * @param {CodeSpec} spec
 * @param {import('./clues.js').Clue[]} clues
 * @param {number} [limit=2] positive integer or Infinity
 * @returns {number[][]} fresh arrays; inputs are not mutated
 */
export function solutions(spec, clues, limit = 2) {
  checkSpec(spec);
  if (!Array.isArray(clues)) throw new TypeError('clues must be an array');
  if (!(limit >= 1)) throw new RangeError('limit must be >= 1');
  for (const c of clues) validateClue(c, spec.length);

  const { length, repeats } = spec;
  const code = new Array(length).fill(0);
  const out = [];

  // Cheap, selective clues first so most codes are rejected after one check.
  const ordered = clues.slice().sort((x, y) => (x.kind === 'feedback' ? 0 : 1) - (y.kind === 'feedback' ? 0 : 1));

  function walk(pos, used) {
    if (pos === length) {
      for (let i = 0; i < ordered.length; i++) if (!satisfies(ordered[i], code)) return;
      out.push(code.slice());
      return;
    }
    for (let d = 0; d < 10; d++) {
      if (!repeats && (used >> d) & 1) continue;
      code[pos] = d;
      walk(pos + 1, used | (1 << d));
      if (out.length >= limit) return;
    }
  }
  walk(0, 0);
  return out;
}

const spaceCache = new Map();

/**
 * Every legal code for a spec, flattened (code i occupies [i*length, (i+1)*length)), lexicographic.
 * Memoised because the generator filters this list repeatedly; callers must treat it as read-only.
 * @param {CodeSpec} spec
 * @returns {{length:number, count:number, flat:Uint8Array}}
 */
export function codeSpace(spec) {
  checkSpec(spec);
  const key = `${spec.length}:${spec.repeats}`;
  let hit = spaceCache.get(key);
  if (hit) return hit;
  const { length, repeats } = spec;
  const rows = [];
  const code = new Array(length).fill(0);
  (function walk(pos, used) {
    if (pos === length) {
      rows.push(...code);
      return;
    }
    for (let d = 0; d < 10; d++) {
      if (!repeats && (used >> d) & 1) continue;
      code[pos] = d;
      walk(pos + 1, used | (1 << d));
    }
  })(0, 0);
  hit = { length, count: rows.length / length, flat: Uint8Array.from(rows) };
  spaceCache.set(key, hit);
  return hit;
}
