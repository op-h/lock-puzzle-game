// Generation latency in Node. Printed as a table; asserts the master median budget (< 50 ms) and a loose
// worst-case bound so a regression to brute-force-per-clue is caught. Timings are machine dependent, and
// `node --test` runs files in parallel processes, so the asserted bounds leave 2x+ headroom over a quiet run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle } from '../../js/engine/generator.js';
import { DIFFICULTY_ORDER } from '../../js/config.js';
import { seedAt } from '../helpers/reference.mjs';

const N = 200;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

test(`generation time over ${N} seeds per difficulty (ms)`, () => {
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    const times = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      generatePuzzle({ difficulty, seed: seedAt(i + 1000) });
      times.push(performance.now() - t0);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    rows.push({
      difficulty,
      'p50 ms': +pct(sorted, 50).toFixed(2),
      'p95 ms': +pct(sorted, 95).toFixed(2),
      'max ms': +sorted[sorted.length - 1].toFixed(2),
      first: +times[0].toFixed(2),
    });
  }
  console.table(rows);
  for (const r of rows) {
    assert.ok(r['p50 ms'] < 50, `${r.difficulty} median ${r['p50 ms']} ms >= 50 ms`);
    assert.ok(r['max ms'] < 500, `${r.difficulty} worst case ${r['max ms']} ms`);
  }
});
