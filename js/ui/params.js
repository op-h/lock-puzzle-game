// Numbers quoted in help/home copy come from config.js, so rebalancing the game cannot leave stale text.

import { BLOOD, DIFFICULTIES, DIFFICULTY_ORDER, SCORING } from '../config.js';
import { formatDuration, tFor } from '../i18n/index.js';
import { NAME_MAX } from '../sync/identity.js';

const pct = (x) => String(Math.round(x * 100));
const dec = (x) => String(Math.round(x * 100) / 100);

function list(lang, items) {
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'disjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

export function copyParams(lang) {
  const lengths = [...new Set(DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d].length))].sort((a, b) => a - b);
  const repeater = DIFFICULTY_ORDER.find((d) => DIFFICULTIES[d].repeats) || 'agent';
  // The worked scoring example: easiest tier, at its par time, one wrong guess, no hint. Computed from the config
  // constants instead of importing engine/scoring.js (that file is not needed on first load); a test pins these
  // numbers to the real puzzleScore/speedFactor/accuracyFactor so the two can never drift.
  const ex = DIFFICULTIES.rookie;
  const exSpeed = SCORING.speedFloor + (SCORING.speedMax - SCORING.speedFloor) / 2; // 2^(-par/par) = 1/2
  const exAcc = Math.max(SCORING.accuracyFloor, 1 - SCORING.accuracyStep);
  return {
    lengths: list(lang, lengths.map(String)),
    repeatName: tFor(lang, 'diff.' + repeater),
    speedMax: dec(SCORING.speedMax),
    speedFloor: dec(SCORING.speedFloor),
    accStep: pct(SCORING.accuracyStep),
    accFloor: pct(SCORING.accuracyFloor),
    hintPct: pct(SCORING.hintFactor),
    exBase: String(ex.base),
    exSpeed: dec(exSpeed),
    exAcc: dec(exAcc),
    exPts: String(Math.round(ex.base * exSpeed * exAcc)),
    duration: formatDuration(BLOOD.durationMs / 1000),
    mult: String(BLOOD.mult),
    wrongPen: String(BLOOD.wrongPenaltyMs / 1000),
    skipPen: String(BLOOD.skipPenaltyMs / 1000),
    max: String(NAME_MAX),
  };
}
