/**
 * Electric piano voice: two-operator FM (1:1 ratio) for the body, whose
 * brightness falls away after the attack, plus a fast-decaying high partial
 * for the tine "bark". Harder hits are louder and brighter.
 */

export interface PianoVoice {
  /** Fades the note out from time `at`. */
  release(at: number): void;
}

const RELEASE = 0.08;
/** Hard stop if a note is never released (decayed to silence long before). */
const MAX_LENGTH = 8;

export function epiano(ctx: BaseAudioContext, dest: AudioNode, pitch: number, t: number, vel: number): PianoVoice {
  const f = 440 * 2 ** ((pitch - 69) / 12);
  const v = 0.25 + 0.75 * vel;
  // Lower notes ring longer.
  const decay = 0.8 + Math.max(0, 72 - pitch) * 0.04;

  const amp = new GainNode(ctx, { gain: 0 });
  amp.connect(dest);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.22 * v, t + 0.004);
  amp.gain.setTargetAtTime(0, t + 0.004, decay);

  const carrier = new OscillatorNode(ctx, { frequency: f });
  carrier.connect(amp);

  // Body: modulation index starts high (bright) and settles low (mellow).
  const mod = new OscillatorNode(ctx, { frequency: f });
  const index = new GainNode(ctx, { gain: 0 });
  index.gain.setValueAtTime(f * (0.6 + 1.6 * vel), t);
  index.gain.setTargetAtTime(f * 0.25, t, 0.18);
  mod.connect(index).connect(carrier.frequency);

  // Tine: short high partial at the attack.
  const tine = new OscillatorNode(ctx, { frequency: f * 7 });
  const tineAmp = new GainNode(ctx, { gain: 0 });
  tineAmp.gain.setValueAtTime(0.05 * v * vel, t);
  tineAmp.gain.setTargetAtTime(0, t, 0.03);
  tine.connect(tineAmp).connect(amp);

  const oscs = [carrier, mod, tine];
  oscs.forEach((o) => {
    o.start(t);
    o.stop(t + MAX_LENGTH);
  });

  let released = false;
  return {
    release(at: number) {
      if (released) return;
      released = true;
      const g = amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
      else g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, RELEASE / 3);
      oscs.forEach((o) => o.stop(at + RELEASE * 2));
    },
  };
}
