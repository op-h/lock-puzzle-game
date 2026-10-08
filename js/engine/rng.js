// Seeded randomness. Math.random is banned in the engine: puzzles must be a pure function of
// (difficulty, seed) so a seed shared between devices reproduces the same puzzle.

/**
 * mulberry32: tiny, fast, 32-bit state PRNG with good equidistribution for game use.
 * @param {number} seed any number; coerced to uint32
 * @returns {() => number} generator of floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fresh unpredictable seed for a new puzzle. There is deliberately no Math.random fallback:
 * every browser that can run this app has Web Crypto, and a silent weak fallback would hide a bug.
 * @returns {number} uint32
 */
export function randomSeed() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('randomSeed: Web Crypto is unavailable');
  }
  return c.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Uniform integer in [0, n). The modulo-free floor() form has bias < 2^-32 for the tiny n used here.
 * @param {() => number} rng
 * @param {number} n positive integer
 * @returns {number}
 */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/**
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} arr non-empty
 * @returns {T}
 */
export function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}

/**
 * Fisher-Yates on a copy; the input is never mutated.
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} arr
 * @returns {T[]}
 */
export function shuffled(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
