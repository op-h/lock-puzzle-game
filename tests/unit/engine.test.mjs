// Engine tests: rng, feedback (exhaustive vs an independent oracle), clues, solver, scoring, config.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOOD, CLOUD, DIFFICULTIES, DIFFICULTY_ORDER, SCORING, bloodDifficultyFor } from '../../js/config.js';
import { mulberry32, randomSeed, randInt, pick, shuffled } from '../../js/engine/rng.js';
import { feedback, feedbackPacked } from '../../js/engine/feedback.js';
import { CLUE_KINDS, satisfies, validateClue, clueKey } from '../../js/engine/clues.js';
import { solutions, codeSpace } from '../../js/engine/solver.js';
import { generatePuzzle } from '../../js/engine/generator.js';
import * as scoring from '../../js/engine/scoring.js';
import { puzzleScore, speedFactor, accuracyFactor } from '../../js/engine/scoring.js';
import { refFeedback, refSatisfies, refAllCodes, refSolutions, eqCode, seedAt } from '../helpers/reference.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walkJs(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walkJs(p) : p.endsWith('.js') ? [p] : [];
  });
}

describe('rng', () => {
  // Textbook mulberry32, written out independently of rng.js.
  function reference(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('matches the reference stream for many seeds', () => {
    for (const seed of [0, 1, 2, 42, 0xdeadbeef, 0xffffffff, 123456789]) {
      const a = mulberry32(seed);
      const b = reference(seed);
      for (let i = 0; i < 1000; i++) assert.equal(a(), b(), `seed ${seed} step ${i}`);
    }
  });

  test('is deterministic, in [0,1), and seeds differ', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    let differ = false;
    for (let i = 0; i < 500; i++) {
      const x = a();
      assert.ok(x >= 0 && x < 1);
      assert.equal(x, b());
      if (x !== c()) differ = true;
    }
    assert.ok(differ);
  });

  test('is roughly uniform (10 buckets, 100k draws)', () => {
    const r = mulberry32(99);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) buckets[Math.floor(r() * 10)]++;
    for (const n of buckets) assert.ok(n > 9500 && n < 10500, `bucket ${n}`);
  });

  test('randomSeed returns uint32 values that vary', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const s = randomSeed();
      assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
      seen.add(s);
    }
    assert.ok(seen.size > 45);
  });

  test('randInt / pick / shuffled stay in range, and shuffled neither mutates nor loses items', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 1000; i++) assert.ok([0, 1, 2].includes(randInt(r, 3)));
    assert.ok(['a', 'b'].includes(pick(r, ['a', 'b'])));
    const src = Object.freeze([1, 2, 3, 4, 5, 6]);
    const out = shuffled(mulberry32(1), src);
    assert.deepEqual(out.slice().sort(), [1, 2, 3, 4, 5, 6]);
    assert.notEqual(out, src);
  });

  test('no Math.random call anywhere in js/', () => {
    for (const f of walkJs(join(ROOT, 'js'))) {
      assert.ok(!/Math\.random\s*\(/.test(readFileSync(f, 'utf8')), `Math.random( in ${f}`);
    }
  });
});

describe('feedback', () => {
  test('hand-worked examples, including repeated digits', () => {
    const cases = [
      [[1, 2, 3], [1, 2, 3], 3, 0],
      [[1, 2, 3], [4, 5, 6], 0, 0],
      [[1, 2, 3], [3, 1, 2], 0, 3],
      [[1, 2, 3], [1, 3, 2], 1, 2], // the combination the legacy game mislabeled "Complex analysis"
      [[1, 2, 3], [1, 2, 4], 2, 0],
      [[1, 1, 2], [1, 2, 1], 1, 2],
      [[1, 1, 1], [1, 2, 3], 1, 0], // a repeated guess digit may not score against one secret digit twice
      [[2, 1, 1], [1, 2, 3], 0, 2],
      [[1, 1, 2], [1, 2, 3], 1, 1],
      [[1, 2, 3], [1, 1, 2], 1, 1], // repeated secret digit, distinct guess
      [[0, 0, 0], [0, 0, 0], 3, 0],
      [[1, 1, 2, 2], [2, 2, 1, 1], 0, 4],
      [[1, 1, 2, 2], [1, 2, 1, 2], 2, 2],
      [[5, 5, 5, 5, 5], [5, 0, 0, 0, 0], 1, 0],
      [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], 1, 4],
    ];
    for (const [g, s, bulls, cows] of cases) {
      assert.deepEqual(feedback(g, s), { bulls, cows }, `${g} vs ${s}`);
      assert.deepEqual(refFeedback(g, s), { bulls, cows }, `oracle self-check ${g} vs ${s}`);
    }
  });

  test('rejects mismatched lengths and does not mutate its inputs', () => {
    assert.throws(() => feedback([1, 2], [1, 2, 3]), RangeError);
    const g = Object.freeze([1, 2, 3]);
    const s = Object.freeze([3, 2, 1]);
    assert.deepEqual(feedback(g, s), { bulls: 1, cows: 2 });
  });

  // Check one (guess, secret) pair against the oracle and the structural invariants.
  function checkPair(g, s, n) {
    const got = feedback(g, s);
    const want = refFeedback(g, s);
    if (got.bulls !== want.bulls || got.cows !== want.cows) {
      assert.fail(`guess ${g} secret ${s}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    if (feedbackPacked(g, s) !== ((got.bulls << 4) | got.cows)) assert.fail(`packed mismatch ${g} ${s}`);
    if (got.bulls + got.cows > n) assert.fail('bulls + cows > n');
    if (got.bulls === n - 1 && got.cows === 1) assert.fail(`impossible (n-1, 1) for ${g} ${s}`);
  }

  test('length 3 WITH repeats: all 1000 x 1000 pairs match the multiset oracle', () => {
    const all = refAllCodes(3, true);
    assert.equal(all.length, 1000);
    for (const g of all) for (const s of all) checkPair(g, s, 3);
  });

  test('length 4 distinct: all 5040 x 5040 pairs match the multiset oracle', () => {
    const all = refAllCodes(4, false);
    assert.equal(all.length, 5040);
    for (const g of all) for (const s of all) checkPair(g, s, 4);
  });

  test('length 4 WITH repeats: 400k random pairs match the oracle', () => {
    const r = mulberry32(2024);
    const code = () => Array.from({ length: 4 }, () => randInt(r, 10));
    for (let i = 0; i < 400000; i++) checkPair(code(), code(), 4);
  });

  test('length 5 (distinct and with repeats): 400k random pairs each match the oracle', () => {
    const r = mulberry32(55);
    const rep = () => Array.from({ length: 5 }, () => randInt(r, 10));
    const dis = () => shuffled(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 5);
    for (let i = 0; i < 400000; i++) {
      checkPair(rep(), rep(), 5);
      checkPair(dis(), dis(), 5);
    }
  });

  test('symmetry: swapping guess and secret swaps nothing (bulls and cows are symmetric)', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 50000; i++) {
      const a = Array.from({ length: 5 }, () => randInt(r, 10));
      const b = Array.from({ length: 5 }, () => randInt(r, 10));
      assert.deepEqual(feedback(a, b), feedback(b, a));
    }
  });
});

describe('clues', () => {
  const code = [3, 8, 5, 2]; // sum 18, evens: 8 and 2

  test('satisfies: table for every kind, both outcomes', () => {
    const rows = [
      [{ kind: 'feedback', guess: [3, 8, 0, 1], bulls: 2, cows: 0 }, true],
      [{ kind: 'feedback', guess: [3, 8, 0, 1], bulls: 1, cows: 1 }, false],
      [{ kind: 'sum', value: 18 }, true],
      [{ kind: 'sum', value: 17 }, false],
      [{ kind: 'parity', pos: 0, parity: 'odd' }, true],
      [{ kind: 'parity', pos: 0, parity: 'even' }, false],
      [{ kind: 'parity', pos: 3, parity: 'even' }, true],
      [{ kind: 'compare', a: 1, b: 0, rel: 'gt' }, true],
      [{ kind: 'compare', a: 1, b: 0, rel: 'lt' }, false],
      [{ kind: 'compare', a: 2, b: 3, rel: 'gt' }, true],
      [{ kind: 'compare', a: 0, b: 2, rel: 'lt' }, true],
      [{ kind: 'evenCount', value: 2 }, true],
      [{ kind: 'evenCount', value: 3 }, false],
    ];
    for (const [clue, want] of rows) assert.equal(satisfies(clue, code), want, JSON.stringify(clue));
  });

  test('compare is strict: equal digits satisfy neither gt nor lt', () => {
    assert.equal(satisfies({ kind: 'compare', a: 0, b: 1, rel: 'gt' }, [4, 4, 1]), false);
    assert.equal(satisfies({ kind: 'compare', a: 0, b: 1, rel: 'lt' }, [4, 4, 1]), false);
  });

  test('satisfies agrees with the independent oracle on random clues over random codes', () => {
    const r = mulberry32(11);
    const rc = (n) => Array.from({ length: n }, () => randInt(r, 10));
    for (let i = 0; i < 20000; i++) {
      const n = 3 + randInt(r, 3);
      const target = rc(n);
      const kind = pick(r, CLUE_KINDS);
      let clue;
      if (kind === 'feedback') {
        const guess = rc(n);
        clue = { kind, guess, ...refFeedback(guess, target) };
      } else if (kind === 'sum') clue = { kind, value: randInt(r, 9 * n + 1) };
      else if (kind === 'parity') clue = { kind, pos: randInt(r, n), parity: pick(r, ['even', 'odd']) };
      else if (kind === 'compare') {
        const a = randInt(r, n);
        clue = { kind, a, b: (a + 1 + randInt(r, n - 1)) % n, rel: pick(r, ['gt', 'lt']) };
      } else clue = { kind, value: randInt(r, n + 1) };
      validateClue(clue, n);
      for (let j = 0; j < 5; j++) {
        const probe = j === 0 ? target : rc(n);
        assert.equal(satisfies(clue, probe), refSatisfies(clue, probe), JSON.stringify([clue, probe]));
      }
    }
  });

  test('unknown kinds throw instead of silently failing', () => {
    assert.throws(() => satisfies({ kind: 'nope' }, [1, 2, 3]), TypeError);
    assert.throws(() => validateClue({ kind: 'nope' }, 3), TypeError);
    assert.throws(() => clueKey({ kind: 'nope' }), TypeError);
  });

  test('validateClue rejects malformed clues', () => {
    const bad = [
      { kind: 'feedback', guess: [1, 2], bulls: 0, cows: 0 },
      { kind: 'feedback', guess: [1, 2, 10], bulls: 0, cows: 0 },
      { kind: 'feedback', guess: [1, 2, 3], bulls: 2, cows: 2 },
      { kind: 'feedback', guess: [1, 2, 3], bulls: -1, cows: 0 },
      { kind: 'sum', value: 28 },
      { kind: 'sum', value: 1.5 },
      { kind: 'parity', pos: 3, parity: 'even' },
      { kind: 'parity', pos: 0, parity: 'odd?' },
      { kind: 'compare', a: 0, b: 0, rel: 'gt' },
      { kind: 'compare', a: 0, b: 5, rel: 'gt' },
      { kind: 'compare', a: 0, b: 1, rel: 'eq' },
      { kind: 'evenCount', value: 4 },
      null,
    ];
    for (const c of bad) assert.throws(() => validateClue(c, 3), TypeError, JSON.stringify(c));
  });

  test('clueKey normalises mirrored compares and separates distinct clues', () => {
    assert.equal(
      clueKey({ kind: 'compare', a: 0, b: 2, rel: 'gt' }),
      clueKey({ kind: 'compare', a: 2, b: 0, rel: 'lt' }),
    );
    assert.notEqual(
      clueKey({ kind: 'compare', a: 0, b: 2, rel: 'gt' }),
      clueKey({ kind: 'compare', a: 0, b: 2, rel: 'lt' }),
    );
    assert.notEqual(
      clueKey({ kind: 'feedback', guess: [1, 2, 3], bulls: 0, cows: 0 }),
      clueKey({ kind: 'feedback', guess: [1, 2, 3], bulls: 0, cows: 1 }),
    );
  });
});

describe('solver', () => {
  test('code space sizes: 720, 1000, 5040, 30240', () => {
    const sizes = [
      [{ length: 3, repeats: false }, 720],
      [{ length: 3, repeats: true }, 1000],
      [{ length: 4, repeats: false }, 5040],
      [{ length: 5, repeats: false }, 30240],
    ];
    for (const [spec, n] of sizes) {
      assert.equal(solutions(spec, [], Infinity).length, n);
      assert.equal(codeSpace(spec).count, n);
    }
  });

  test('lexicographic order, honours limit, returns fresh arrays', () => {
    const spec = { length: 3, repeats: false };
    assert.deepEqual(solutions(spec, [], 2), [[0, 1, 2], [0, 1, 3]]);
    assert.deepEqual(solutions(spec, [], 1), [[0, 1, 2]]);
    assert.deepEqual(solutions({ length: 3, repeats: true }, [], 3), [[0, 0, 0], [0, 0, 1], [0, 0, 2]]);
    const a = solutions(spec, [], 1);
    a[0][0] = 9;
    assert.deepEqual(solutions(spec, [], 1), [[0, 1, 2]]);
  });

  test('does not mutate or reorder the clue list', () => {
    const clues = Object.freeze([
      Object.freeze({ kind: 'sum', value: 6 }),
      Object.freeze({ kind: 'feedback', guess: Object.freeze([1, 2, 3]), bulls: 0, cows: 3 }),
    ]);
    const out = solutions({ length: 3, repeats: false }, clues, Infinity);
    assert.deepEqual(out.map((c) => c.join('')), ['231', '312']);
    assert.equal(clues[0].kind, 'sum');
  });

  test('a contradictory clue set yields no solutions', () => {
    assert.deepEqual(solutions({ length: 3, repeats: false }, [{ kind: 'sum', value: 0 }]), []);
  });

  test('rejects bad specs, limits and clues', () => {
    assert.throws(() => solutions({ length: 0, repeats: false }, []), RangeError);
    assert.throws(() => solutions({ length: 3 }, []), TypeError);
    assert.throws(() => solutions({ length: 3, repeats: false }, [], 0), RangeError);
    assert.throws(() => solutions({ length: 3, repeats: false }, [{ kind: 'sum', value: 99 }]), TypeError);
  });

  test('agrees with an independent brute force on 600 random clue sets (all specs)', () => {
    const r = mulberry32(77);
    const specs = [
      { length: 3, repeats: false },
      { length: 3, repeats: true },
      { length: 4, repeats: false },
      { length: 5, repeats: false },
    ];
    const spaces = new Map(specs.map((s) => [s, refAllCodes(s.length, s.repeats)]));
    for (let i = 0; i < 600; i++) {
      const spec = specs[i % specs.length];
      const all = spaces.get(spec);
      const target = all[randInt(r, all.length)];
      const clues = [];
      const k = 1 + randInt(r, 4);
      for (let j = 0; j < k; j++) {
        const kind = pick(r, CLUE_KINDS);
        const n = spec.length;
        const probe = all[randInt(r, all.length)];
        // Mix true-of-target and arbitrary values so both empty and non-empty result sets occur.
        if (kind === 'feedback') clues.push({ kind, guess: probe, ...refFeedback(probe, target) });
        else if (kind === 'sum') clues.push({ kind, value: randInt(r, 3) === 0 ? randInt(r, 9 * n + 1) : target.reduce((a, b) => a + b, 0) });
        else if (kind === 'parity') clues.push({ kind, pos: randInt(r, n), parity: pick(r, ['even', 'odd']) });
        else if (kind === 'compare') {
          const a = randInt(r, n - 1);
          clues.push({ kind, a, b: a + 1, rel: pick(r, ['gt', 'lt']) });
        } else clues.push({ kind, value: randInt(r, n + 1) });
      }
      // Feedback clues need distinct-digit guesses only by convention; the solver must be right regardless.
      const mine = solutions(spec, clues, Infinity);
      const ref = refSolutions(spec, clues, all);
      assert.equal(mine.length, ref.length, JSON.stringify({ spec, clues }));
      assert.ok(mine.every((c, idx) => eqCode(c, ref[idx])), 'same codes in the same order');
      // limit=2 is a prefix of the full answer
      assert.deepEqual(solutions(spec, clues, 2), ref.slice(0, 2));
    }
  });
});

describe('generator API edges', () => {
  test('rejects bad difficulty and seeds', () => {
    assert.throws(() => generatePuzzle({ difficulty: 'nightmare', seed: 1 }), RangeError);
    assert.throws(() => generatePuzzle({ difficulty: 'constructor', seed: 1 }), RangeError);
    assert.throws(() => generatePuzzle({ difficulty: '__proto__', seed: 1 }), RangeError);
    assert.throws(() => generatePuzzle({ difficulty: 'rookie', seed: NaN }), TypeError);
    assert.throws(() => generatePuzzle({ difficulty: 'rookie', seed: Infinity }), TypeError);
    assert.throws(() => generatePuzzle({ difficulty: 'rookie', seed: '5' }), TypeError);
  });

  test('seed is normalised to uint32 and reflected in the id', () => {
    const a = generatePuzzle({ difficulty: 'rookie', seed: 2 ** 32 + 5 });
    const b = generatePuzzle({ difficulty: 'rookie', seed: 5 });
    assert.deepEqual(a, b);
    assert.equal(a.seed, 5);
    assert.equal(a.id, 'rookie-5');
    assert.equal(generatePuzzle({ difficulty: 'hacker', seed: 0xffffffff }).id, 'hacker-1z141z3');
  });

  test('different seeds give different puzzles (no accidental constant stream)', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i++) {
      const p = generatePuzzle({ difficulty: 'hacker', seed: seedAt(i) });
      ids.add(p.answer.join('') + JSON.stringify(p.clues));
    }
    assert.ok(ids.size > 195);
  });

  test('config is immutable, so a UI bug cannot re-balance the game', () => {
    assert.throws(() => {
      DIFFICULTIES.rookie.length = 9; // ES modules are strict, so a write to a frozen object throws
    }, TypeError);
    assert.equal(DIFFICULTIES.rookie.length, 3);
    assert.ok(Object.isFrozen(BLOOD.ramp));
  });
});

describe('config', () => {
  test('difficulties follow ADR 0003', () => {
    assert.deepEqual(DIFFICULTY_ORDER, ['rookie', 'agent', 'hacker', 'master']);
    const d = DIFFICULTIES;
    assert.deepEqual([d.rookie.length, d.agent.length, d.hacker.length, d.master.length], [3, 3, 4, 5]);
    assert.deepEqual([d.rookie.repeats, d.agent.repeats, d.hacker.repeats, d.master.repeats], [false, true, false, false]);
    assert.deepEqual(d.rookie.kinds, ['feedback']);
    assert.deepEqual([...d.agent.kinds].sort(), ['feedback', 'parity', 'sum']);
    assert.deepEqual([...d.hacker.kinds].sort(), [...CLUE_KINDS].sort());
    assert.deepEqual([...d.master.kinds].sort(), [...CLUE_KINDS].sort());
  });

  test('every difficulty is internally consistent', () => {
    let lastBase = 0;
    for (const id of DIFFICULTY_ORDER) {
      const c = DIFFICULTIES[id];
      assert.ok(c.kinds.every((k) => CLUE_KINDS.includes(k)));
      assert.ok(c.kinds.includes('feedback'), 'feedback must be available so any puzzle can be made unique');
      assert.ok(c.clues[0] >= 1 && c.clues[1] >= c.clues[0]);
      assert.ok(c.par > 0 && c.base > 0);
      assert.ok(c.base > lastBase, 'harder difficulties pay more');
      lastBase = c.base;
    }
  });

  test('Blood constants match ADR 0003', () => {
    assert.equal(BLOOD.durationMs, 180000);
    assert.equal(BLOOD.wrongPenaltyMs, 5000);
    assert.equal(BLOOD.skipPenaltyMs, 10000);
    assert.equal(BLOOD.mult, 2);
  });

  test('Blood ramp boundaries: 0-1 rookie, 2-3 agent, 4-6 hacker, 7+ master', () => {
    const table = [
      [0, 'rookie'], [1, 'rookie'], [2, 'agent'], [3, 'agent'], [4, 'hacker'], [5, 'hacker'],
      [6, 'hacker'], [7, 'master'], [8, 'master'], [50, 'master'], [1e9, 'master'],
      [Infinity, 'master'], [-1, 'rookie'], [-Infinity, 'rookie'], [NaN, 'rookie'],
      [1.9, 'rookie'], [2.9, 'agent'], [6.99, 'hacker'], ['3', 'agent'], [undefined, 'rookie'], [null, 'rookie'],
    ];
    for (const [n, want] of table) assert.equal(bloodDifficultyFor(n), want, `solved=${n}`);
    assert.equal(scoring.bloodDifficultyFor, bloodDifficultyFor, 're-exported from scoring.js');
    // Total over a realistic range and never an unknown id
    for (let n = 0; n < 200; n++) assert.ok(Object.hasOwn(DIFFICULTIES, bloodDifficultyFor(n)));
  });

  test('the only API key in js/ is the documented Firebase Web key', () => {
    assert.deepEqual({ ...CLOUD }, {
      projectId: 'lock-puzzle-game',
      apiKey: 'AIzaSyAHXQMCBK6NdEdBO4-msM7M0Mm6x-cDxNY',
      enabled: true,
    });
    for (const f of walkJs(join(ROOT, 'js'))) {
      const src = readFileSync(f, 'utf8');
      const hits = src.match(/AIza[0-9A-Za-z_-]{30,}/g) || [];
      assert.equal(hits.length, f.endsWith('config.js') ? 1 : 0, f);
    }
  });
});

describe('scoring', () => {
  const S = (difficulty, secs, wrong = 0, usedHint = false, blood = false) =>
    puzzleScore({ difficulty, secs, wrong, usedHint, blood });

  test('constants: speed 2.0 at 0, 1.25 at par, floor 0.5; accuracy floor 0.4', () => {
    assert.equal(SCORING.speedMax, 2);
    assert.equal(speedFactor(0, 45), 2);
    assert.equal(speedFactor(45, 45), 1.25);
    assert.equal(speedFactor(90, 45), 0.875);
    assert.equal(speedFactor(135, 45), 0.6875);
    assert.equal(speedFactor(180, 45), 0.59375);
    assert.equal(speedFactor(1e9, 45), 0.5);
    assert.equal(speedFactor(Infinity, 45), 0.5);
    for (const par of [45, 75, 120, 180]) assert.equal(speedFactor(par, par), 1.25);
    assert.equal(accuracyFactor(0), 1);
    assert.equal(accuracyFactor(1), 0.92);
    assert.equal(accuracyFactor(2), 0.84);
    assert.equal(accuracyFactor(5), 0.6);
    assert.equal(accuracyFactor(7), 0.44);
    assert.equal(accuracyFactor(8), 0.4); // 0.36 raw, floored
    assert.equal(accuracyFactor(100), 0.4);
  });

  test('hand-computed point table (round half up)', () => {
    // [difficulty, secs, wrong, hint, blood, expected]; base*speed*accuracy*hint worked out by hand
    const rows = [
      ['rookie', 0, 0, false, false, 200], // 100 * 2
      ['rookie', 45, 0, false, false, 125], // 100 * 1.25
      ['rookie', 90, 0, false, false, 88], // 87.5 -> 88
      ['rookie', 135, 0, false, false, 69], // 68.75
      ['rookie', 0, 1, false, false, 184], // 200 * .92
      ['rookie', 45, 3, false, false, 95], // 125 * .76
      ['rookie', 45, 8, false, false, 50], // 125 * .4
      ['rookie', 45, 0, true, false, 63], // 62.5 -> 63
      ['rookie', 45, 0, false, true, 250], // 125 * 2
      ['rookie', 45, 0, true, true, 126], // 63 * 2
      ['rookie', 1e9, 99, true, false, 10], // 100 * .5 * .4 * .5
      ['agent', 75, 0, false, false, 250], // 200 * 1.25
      ['agent', 150, 0, false, false, 175], // 200 * .875
      ['agent', 0, 2, false, false, 336], // 200 * 2 * .84
      ['hacker', 0, 0, false, false, 700],
      ['hacker', 120, 0, false, false, 438], // 437.5 -> 438
      ['hacker', 240, 0, false, false, 306], // 306.25
      ['hacker', 120, 0, false, true, 876], // 438 * 2
      ['master', 0, 0, false, false, 1200],
      ['master', 180, 0, false, false, 750],
      ['master', 360, 0, false, false, 525], // 600 * .875
      ['master', 180, 2, true, false, 315], // 750 * .84 * .5
      ['master', 180, 0, false, true, 1500],
    ];
    for (const [d, secs, wrong, hint, blood, want] of rows) {
      assert.equal(S(d, secs, wrong, hint, blood), want, JSON.stringify({ d, secs, wrong, hint, blood }));
    }
  });

  test('always a non-negative integer; blood is exactly 2x classic', () => {
    for (const d of DIFFICULTY_ORDER) {
      for (let secs = 0; secs <= 700; secs += 0.7) {
        for (let wrong = 0; wrong <= 10; wrong++) {
          for (const hint of [false, true]) {
            const c = S(d, secs, wrong, hint, false);
            const b = S(d, secs, wrong, hint, true);
            assert.ok(Number.isInteger(c) && c >= 0, `${d} ${secs} ${wrong}`);
            assert.equal(b, c * BLOOD.mult);
          }
        }
      }
    }
  });

  test('monotone sweep: faster, fewer wrongs, no hint, blood each never score less', () => {
    for (const d of DIFFICULTY_ORDER) {
      for (const blood of [false, true]) {
        for (const hint of [false, true]) {
          // time: points never increase as secs grows (fine 0.25 s grid, then coarse tail)
          for (let wrong = 0; wrong <= 9; wrong++) {
            let prev = Infinity;
            for (let secs = 0; secs <= 1500; secs += secs < 600 ? 0.25 : 5) {
              const p = S(d, secs, wrong, hint, blood);
              assert.ok(p <= prev, `time ${d} wrong=${wrong} secs=${secs}: ${p} > ${prev}`);
              prev = p;
            }
          }
          // wrongs: points never increase with more wrongs
          for (let secs = 0; secs <= 400; secs += 3.3) {
            let prev = Infinity;
            for (let wrong = 0; wrong <= 20; wrong++) {
              const p = S(d, secs, wrong, hint, blood);
              assert.ok(p <= prev, `wrong ${d} secs=${secs} wrong=${wrong}`);
              prev = p;
            }
          }
        }
        // hint never helps
        for (let secs = 0; secs <= 400; secs += 2.9) {
          for (let wrong = 0; wrong <= 10; wrong++) {
            assert.ok(S(d, secs, wrong, false, blood) >= S(d, secs, wrong, true, blood));
          }
        }
      }
      // blood never pays less than classic
      for (let secs = 0; secs <= 400; secs += 5) assert.ok(S(d, secs, 1, false, true) >= S(d, secs, 1, false, false));
    }
  });

  test('speed factor itself is monotone and bounded on a fine grid', () => {
    for (const par of [1, 45, 75, 120, 180, 1000]) {
      let prev = Infinity;
      for (let i = 0; i <= 5000; i++) {
        const f = speedFactor((i * par) / 250, par);
        assert.ok(f <= prev && f >= 0.5 && f <= 2, `par=${par} i=${i} f=${f}`);
        prev = f;
      }
    }
  });

  test('hostile inputs are clamped: never NaN, never negative, never above the cap', () => {
    const weird = [NaN, -1, -1e9, -Infinity, Infinity, undefined, null, '', 'abc', '12', {}, [], 1e308, 0.5, -0];
    for (const d of DIFFICULTY_ORDER) {
      const max = S(d, 0, 0, false, false);
      for (const secs of weird) {
        for (const wrong of weird) {
          for (const blood of [false, true]) {
            const p = S(d, secs, wrong, false, blood);
            assert.ok(Number.isInteger(p) && p >= 0 && p <= max * (blood ? 2 : 1), `${d} secs=${String(secs)} wrong=${String(wrong)} -> ${p}`);
          }
        }
      }
    }
    // NaN time must not be rewarded: it scores like a very slow solve
    assert.equal(S('rookie', NaN, 0), S('rookie', Infinity, 0));
    assert.equal(S('rookie', null, 0), S('rookie', Infinity, 0), 'missing time is not a free perfect score');
    assert.equal(S('rookie', undefined, 0), S('rookie', Infinity, 0));
    assert.equal(S('rookie', '', 0), S('rookie', Infinity, 0));
    assert.equal(S('rookie', '45', 0), 125, 'numeric strings are accepted');
    assert.equal(S('rookie', -5, 0), S('rookie', 0, 0));
    assert.equal(S('rookie', 0, NaN), S('rookie', 0, 1e9));
    for (const par of [NaN, 0, -3, undefined, Infinity]) {
      const f = speedFactor(10, par);
      assert.ok(Number.isFinite(f) && f >= 0.5 && f <= 2, `par=${par}`);
    }
    assert.equal(speedFactor(Infinity, Infinity), 0.5);
    assert.equal(accuracyFactor(-4), 1);
    assert.equal(accuracyFactor(2.9), 0.84, 'fractional wrong counts floor');
  });

  test('unknown difficulty is a programmer error, not a silent zero', () => {
    assert.throws(() => S('nightmare', 1), RangeError);
    assert.throws(() => S('constructor', 1), RangeError);
  });

  test('a real generated puzzle scores sensibly end to end', () => {
    const p = generatePuzzle({ difficulty: 'master', seed: 123 });
    const fast = puzzleScore({ difficulty: p.difficulty, secs: 30, wrong: 0, usedHint: false, blood: false });
    const slow = puzzleScore({ difficulty: p.difficulty, secs: 600, wrong: 4, usedHint: true, blood: false });
    assert.ok(fast > slow && slow > 0);
  });
});
