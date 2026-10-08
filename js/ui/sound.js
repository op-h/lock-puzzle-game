// Square/triangle blips. Loaded only on the first sound that is actually due (the setting defaults to OFF),
// and the AudioContext is created on the first play, which always follows a user gesture (key, tap).

const SOUNDS = {
  key: [[660, 40, 'square', 0]],
  wrong: [[180, 110, 'square', 0], [130, 160, 'square', 0.12]],
  solve: [[523, 90, 'triangle', 0], [659, 90, 'triangle', 0.1], [784, 170, 'triangle', 0.2]],
  tick: [[880, 35, 'square', 0]],
  end: [[392, 150, 'square', 0], [330, 150, 'square', 0.17], [247, 320, 'square', 0.34]],
};

export function createSound() {
  /** @type {AudioContext | null} */
  let ctx = null;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return {
    /** @param {keyof typeof SOUNDS} name */
    play(name) {
      // No gesture yet (e.g. a restored Blood run ticking in a fresh tab): stay silent instead of making the
      // browser log an autoplay refusal on every tick.
      const ua = globalThis.navigator && globalThis.navigator.userActivation;
      if (ua && !ua.hasBeenActive) return;
      const c = ensure();
      const notes = SOUNDS[name];
      if (!c || !notes) return;
      try {
        if (c.state === 'suspended') c.resume().catch(() => {});
        const t0 = c.currentTime;
        for (const [freq, ms, type, at] of notes) {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = type;
          o.frequency.value = freq;
          // Low gain and a fast ramp-out: pixel blips, never a click or a loud surprise.
          g.gain.setValueAtTime(0.05, t0 + at);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + ms / 1000);
          o.connect(g).connect(c.destination);
          o.start(t0 + at);
          o.stop(t0 + at + ms / 1000 + 0.02);
        }
      } catch {
        // audio is decoration: never let it break a round
      }
    },
  };
}
