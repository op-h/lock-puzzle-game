// Independent oracles. NOTHING here imports feedback.js, clues.js or solver.js: a shared bug between the
// engine and its checker would make the tests agree with a wrong answer. (Only config.js constants are shared.)
// Written in a deliberately different style (multiset counting, odometer enumeration, array methods).

/**
 * Multiset formula: total matches = sum over digits of min(count in guess, count in secret);
 * bulls = positional equalities; cows = total - bulls.
 */
export function refFeedback(guess, secret) {
  const cg = new Array(10).fill(0);
  const cs = new Array(10).fill(0);
  for (const d of guess) cg[d]++;
  for (const d of secret) cs[d]++;
  let total = 0;
  for (let d = 0; d < 10; d++) total += Math.min(cg[d], cs[d]);
  let bulls = 0;
  for (let i = 0; i < guess.length; i++) if (guess[i] === secret[i]) bulls++;
  return { bulls, cows: total - bulls };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function refSatisfies(clue, code) {
  if (clue.kind === 'feedback') {
    const r = refFeedback(clue.guess, code);
    return r.bulls === clue.bulls && r.cows === clue.cows;
  }
  if (clue.kind === 'sum') return sum(code) === clue.value;
  if (clue.kind === 'parity') return (clue.parity === 'even') === (code[clue.pos] % 2 === 0);
  if (clue.kind === 'compare') {
    const x = code[clue.a];
    const y = code[clue.b];
    return clue.rel === 'gt' ? x > y : clue.rel === 'lt' ? x < y : false;
  }
  if (clue.kind === 'evenCount') return code.filter((d) => d % 2 === 0).length === clue.value;
  throw new Error('refSatisfies: unknown kind ' + clue.kind);
}

/** Every code of the given length by counting 0..10^length-1 and splitting into digits. */
export function refAllCodes(length, repeats) {
  const out = [];
  const limit = 10 ** length;
  for (let v = 0; v < limit; v++) {
    const digits = String(v).padStart(length, '0').split('').map(Number);
    if (!repeats && new Set(digits).size !== length) continue;
    out.push(digits);
  }
  return out;
}

export function refSolutions(spec, clues, all = refAllCodes(spec.length, spec.repeats)) {
  return all.filter((code) => clues.every((c) => refSatisfies(c, code)));
}

export const eqCode = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);

/** Deterministic spread of seeds including the uint32 edges. */
export function seedAt(i) {
  if (i === 0) return 0;
  if (i === 1) return 0xffffffff;
  return Math.imul(i, 2654435761) >>> 0;
}
