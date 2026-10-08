// Bulls/cows with correct multiplicity (ADR 0003 #4).
//
// Two passes, written as the definition rather than a digit-count shortcut so it needs no
// assumption about digit range: pass 1 fixes exact matches; pass 2 lets each remaining guess digit
// consume at most one still-unclaimed secret digit. Claiming secret slots is what stops a repeated
// guess digit from scoring against a single secret digit twice.

/**
 * Packed result for hot loops (solver, generator) that must not allocate per call.
 * Layout: bulls << 4 | cows. Safe because length is capped at 15, so cows < 16.
 * @param {ArrayLike<number>} guess
 * @param {ArrayLike<number>} secret same length as guess
 * @returns {number}
 */
export function feedbackPacked(guess, secret) {
  const n = guess.length;
  if (n !== secret.length) throw new RangeError('feedback: guess and secret differ in length');
  if (n > 15) throw new RangeError('feedback: code too long');

  let bulls = 0;
  let claimed = 0; // bit j set: secret slot j is already matched (bull or cow)
  let exact = 0; // bit i set: guess slot i is a bull
  for (let i = 0; i < n; i++) {
    if (guess[i] === secret[i]) {
      bulls++;
      claimed |= 1 << i;
      exact |= 1 << i;
    }
  }

  let cows = 0;
  for (let i = 0; i < n; i++) {
    if ((exact >> i) & 1) continue;
    for (let j = 0; j < n; j++) {
      if ((claimed >> j) & 1) continue;
      if (guess[i] === secret[j]) {
        claimed |= 1 << j;
        cows++;
        break;
      }
    }
  }
  return (bulls << 4) | cows;
}

/**
 * @param {ArrayLike<number>} guess
 * @param {ArrayLike<number>} secret
 * @returns {{bulls: number, cows: number}} bulls: right digit, right place; cows: right digit, wrong place
 */
export function feedback(guess, secret) {
  const p = feedbackPacked(guess, secret);
  return { bulls: p >> 4, cows: p & 15 };
}
