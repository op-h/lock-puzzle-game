// Property run for one difficulty. Seed count: env PUZZLE_SEEDS (default 2000 per difficulty).
// Fast mode for local iteration: PUZZLE_SEEDS=300 node --test tests/unit/
// Each difficulty has its own test file so `node --test` runs the four in parallel processes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../../js/config.js';
import { generatePuzzle, generatePuzzleDetailed } from '../../js/engine/generator.js';
import { checkPuzzle, checkPuzzleIndependent } from './puzzle-properties.mjs';
import { seedAt } from './reference.mjs';

export const SEEDS = Math.max(50, Number(process.env.PUZZLE_SEEDS) || 2000);

export function runDifficulty(difficulty) {
  const cfg = DIFFICULTIES[difficulty];

  test(`${difficulty}: ${SEEDS} seeds satisfy every puzzle invariant`, () => {
    const t0 = performance.now();
    const hist = {};
    const kinds = {};
    let attempts = 0;
    let fallbacks = 0;
    let repeated = 0;
    for (let i = 0; i < SEEDS; i++) {
      const { puzzle, attempts: a, fallback } = generatePuzzleDetailed({ difficulty, seed: seedAt(i) });
      attempts += a;
      if (fallback) fallbacks++;
      checkPuzzle(puzzle); // range is enforced here too: the fallback must also land in-window or be absent
      hist[puzzle.clues.length] = (hist[puzzle.clues.length] || 0) + 1;
      for (const c of puzzle.clues) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
      if (new Set(puzzle.answer).size < puzzle.length) repeated++;
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(
      `# ${difficulty}: ${SEEDS} puzzles verified in ${secs}s | clues ${JSON.stringify(hist)} | ` +
        `kinds ${JSON.stringify(kinds)} | mean attempts ${(attempts / SEEDS).toFixed(2)} | ` +
        `fallbacks ${fallbacks} | answers with a repeated digit ${repeated}`,
    );
    if (cfg.repeats) assert.ok(repeated > 0, 'repeats=true must actually produce repeated-digit answers');
  });

  test(`${difficulty}: independent brute force agrees (unique + minimal) on a sample`, () => {
    for (let i = 0; i < 40; i++) checkPuzzleIndependent(generatePuzzle({ difficulty, seed: seedAt(i + 7) }));
  });

  test(`${difficulty}: deterministic in (difficulty, seed)`, () => {
    for (let i = 0; i < 100; i++) {
      const seed = seedAt(i);
      assert.deepEqual(generatePuzzle({ difficulty, seed }), generatePuzzle({ difficulty, seed }));
    }
  });

  test(`${difficulty}: forced fallback path is still unique and minimal`, () => {
    for (let i = 0; i < 150; i++) {
      const { puzzle, fallback } = generatePuzzleDetailed({ difficulty, seed: seedAt(i + 3) }, { maxAttempts: 0 });
      assert.equal(fallback, true);
      checkPuzzle(puzzle, { range: false }); // the window is a target for the random path, not a promise here
    }
  });
}
