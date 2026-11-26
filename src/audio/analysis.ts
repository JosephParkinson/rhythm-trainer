/*
 * Pure signal analysis shared by the mic-based tests (calibration, lag test).
 * Everything works on a Recording stitched from the recorder worklet.
 */

export interface Recording {
  /** broadband (high-passed): used for precise onsets */
  hp: Float32Array;
  /** narrow band around the 1 kHz test tone: used to find tones */
  bp: Float32Array;
  sampleRate: number;
  /** AudioContext frame of sample 0 */
  startFrame: number;
}

/** s, search range for speaker → mic → recording delay */
const MAX_ROUND_TRIP = 0.6;

/** A recording with envelopes and time ↔ sample helpers. */
export interface Prepared {
  sr: number;
  len: number;
  hpEnv: Float32Array;
  bpEnv: Float32Array;
  /** ms → samples (at least 1) */
  smp(ms: number): number;
  /** AudioContext time → sample index */
  pos(t: number): number;
}

export function prepare(rec: Recording): Prepared {
  const sr = rec.sampleRate;
  const smp = (ms: number) => Math.max(1, Math.round((ms * sr) / 1000));
  return {
    sr,
    len: rec.hp.length,
    hpEnv: envelope(rec.hp, smp(0.5)),
    bpEnv: envelope(rec.bp, smp(2)),
    smp,
    pos: (t) => Math.round(t * sr) - rec.startFrame,
  };
}

/**
 * Offset in samples from when tones were scheduled/triggered (AudioContext
 * times) to where they appear in the recording: the offset at which tone-band
 * energy lines up with all of them. Throws if no consistent tone is found.
 */
export function findRoundTrip(p: Prepared, times: number[]): number {
  let best = -1;
  let offset = 0;
  const scores: number[] = [];
  for (let L = 0; L <= MAX_ROUND_TRIP * p.sr; L += p.smp(0.5)) {
    let s = 0;
    for (const t of times) {
      const i = p.pos(t) + L + p.smp(10);
      if (i < p.len) s += p.bpEnv[i];
    }
    scores.push(s);
    if (s > best) {
      best = s;
      offset = L;
    }
  }
  if (best <= 0 || best < 4 * median(scores)) throw new Error('CLICKS NOT HEARD');
  return offset;
}

/** Precise onset (sample index) of each tone near its expected position, or null if not found. */
export function toneOnsets(p: Prepared, times: number[], roundTrip: number): (number | null)[] {
  return times.map((t) => {
    const a = p.pos(t) + roundTrip - p.smp(15);
    return onset(p.hpEnv, a, a + p.smp(30), median(p.hpEnv.subarray(Math.max(0, a - p.smp(40)), Math.max(0, a))));
  });
}

/** Rectified moving average over `w` samples. */
export function envelope(x: Float32Array, w: number) {
  const out = new Float32Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += Math.abs(x[i]);
    if (i >= w) sum -= Math.abs(x[i - w]);
    out[i] = sum / w;
  }
  return out;
}

export function median(xs: ArrayLike<number>) {
  if (!xs.length) return 0;
  const s = Array.from(xs).sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** First index in [a, b) where env rises 25% of the way from noise to the window's peak. */
export function onset(env: Float32Array, a: number, b: number, noise: number): number | null {
  a = Math.max(0, a);
  b = Math.min(env.length, b);
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, env[i]);
  if (peak === 0 || peak < noise * 4) return null;
  const thr = noise + 0.25 * (peak - noise);
  for (let i = a; i < b; i++) if (env[i] >= thr) return i;
  return null;
}

/** Median and standard deviation (both in ms, to 0.1) of values in seconds. */
export function msStats(xs: number[]) {
  const m = median(xs);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  return { median: Math.round(m * 1000), sd: Math.round(sd * 10000) / 10 };
}
