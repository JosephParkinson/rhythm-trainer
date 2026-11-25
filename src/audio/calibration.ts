import type { Engine } from './engine';

/*
 * Mic-based latency calibration.
 *
 * Clicks play through the speakers and the user taps a key between them. The
 * mic hears both the click and the key's clack, so their true separation can be
 * read off the recording (the mic's own latency affects both equally).
 * Comparing that with the separation the app measured from the key event
 * gives the app's systematic error: input latency plus any error in the
 * browser's reported output latency.
 */

export const CAL_TAPS = 16;
const INTRO = 4;
const BPM = 90;
const BEAT = 60 / BPM;
/** s, search range for speaker → mic → recording delay */
const MAX_ROUND_TRIP = 0.6;
const MIN_TAPS = 6;

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  process(inputs) {
    const i = inputs[0];
    if (i.length === 2) this.port.postMessage([currentFrame, i[0].slice(), i[1].slice()]);
    return true;
  }
}
registerProcessor('rt-rec', Rec);
`;
const loaded = new WeakSet<BaseAudioContext>();

export interface CalResult {
  /** ms to subtract from hits */
  latency: number;
  /** ms, standard deviation of the per-tap correction */
  jitter: number;
  used: number;
}

export interface Recording {
  /** broadband (high-passed): used for precise onsets */
  hp: Float32Array;
  /** narrow band around the click tone: used to find clicks */
  bp: Float32Array;
  sampleRate: number;
  /** AudioContext frame of sample 0 */
  startFrame: number;
}

export class Calibration {
  private readonly taps: number[] = [];
  private cancelled = false;

  constructor(private readonly eng: Engine) {}

  tap(perfMs: number) {
    this.taps.push(this.eng.heardTime(perfMs));
  }

  cancel() {
    this.cancelled = true;
  }

  async run(onTick: (listening: boolean, taps: number) => void): Promise<CalResult> {
    const ctx = this.eng.ctx;
    const stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation would remove the speaker click from the recording.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    try {
      if (!loaded.has(ctx)) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        loaded.add(ctx);
      }
      if (this.cancelled) throw new Error('CANCELLED');

      const src = ctx.createMediaStreamSource(stream);
      const merge = ctx.createChannelMerger(2);
      src.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300 })).connect(merge, 0, 0);
      src.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 8 })).connect(merge, 0, 1);
      const rec = new AudioWorkletNode(ctx, 'rt-rec', {
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      });
      const sink = new GainNode(ctx, { gain: 0 }); // keeps the worklet pulled
      merge.connect(rec).connect(sink).connect(ctx.destination);

      const blocks: [number, Float32Array, Float32Array][] = [];
      rec.port.onmessage = (e) => blocks.push(e.data);

      const t0 = ctx.currentTime + 0.5;
      const clicks = Array.from({ length: INTRO + CAL_TAPS }, (_, k) => t0 + k * BEAT);
      clicks.forEach((t) => this.eng.calClick(t));
      const end = clicks[clicks.length - 1] + BEAT + MAX_ROUND_TRIP;

      try {
        while (ctx.currentTime < end) {
          if (this.cancelled) throw new Error('CANCELLED');
          const now = this.eng.heardTime(performance.now());
          onTick(now < t0 + (INTRO - 1) * BEAT, tapsByClick(this.taps, clicks).size);
          await new Promise((r) => setTimeout(r, 50));
        }
      } finally {
        rec.port.onmessage = null;
        src.disconnect();
        sink.disconnect();
      }

      return analyseCalibration(stitch(blocks, ctx.sampleRate), clicks, tapsByClick(this.taps, clicks));
    } finally {
      this.eng.cancelScheduled();
      stream.getTracks().forEach((t) => t.stop());
    }
  }
}

/** First tap after each click (from the end of the intro), keyed by click index. */
export function tapsByClick(taps: number[], clicks: number[]) {
  const m = new Map<number, number>();
  for (const h of taps) {
    const k = Math.floor((h - clicks[0]) / BEAT);
    if (k >= INTRO && k < clicks.length && !m.has(k)) m.set(k, h);
  }
  return m;
}

function stitch(blocks: [number, Float32Array, Float32Array][], sampleRate: number): Recording {
  if (!blocks.length) throw new Error('NO MIC INPUT');
  const startFrame = blocks[0][0];
  const last = blocks[blocks.length - 1];
  const len = last[0] + last[1].length - startFrame;
  const hp = new Float32Array(len);
  const bp = new Float32Array(len);
  for (const [frame, h, b] of blocks) {
    hp.set(h, frame - startFrame);
    bp.set(b, frame - startFrame);
  }
  return { hp, bp, sampleRate, startFrame };
}

/**
 * @param clicks AudioContext times the clicks were scheduled at
 * @param taps heard time of the tap after each click, keyed by click index
 */
export function analyseCalibration(rec: Recording, clicks: number[], taps: Map<number, number>): CalResult {
  const { sampleRate: sr, startFrame } = rec;
  const len = rec.hp.length;
  const smp = (ms: number) => Math.max(1, Math.round((ms * sr) / 1000));
  const pos = (t: number) => Math.round(t * sr) - startFrame;
  const hpEnv = envelope(rec.hp, smp(0.5));
  const bpEnv = envelope(rec.bp, smp(2));

  // Coarse round trip: the offset at which click-band energy lines up with every click.
  let roundTrip = 0;
  let best = -1;
  const scores: number[] = [];
  for (let L = 0; L <= MAX_ROUND_TRIP * sr; L += smp(0.5)) {
    let s = 0;
    for (const t of clicks) {
      const i = pos(t) + L + smp(10);
      if (i < len) s += bpEnv[i];
    }
    scores.push(s);
    if (s > best) {
      best = s;
      roundTrip = L;
    }
  }
  if (best <= 0 || best < 4 * median(scores)) throw new Error('CLICKS NOT HEARD');

  const clickOn = clicks.map((t) => {
    const a = pos(t) + roundTrip - smp(15);
    return onset(hpEnv, a, a + smp(30), median(hpEnv.subarray(Math.max(0, a - smp(40)), a)));
  });

  const corr: number[] = [];
  for (const [k, heard] of taps) {
    const c = clickOn[k];
    if (c === null) continue;
    const app = heard - clicks[k];
    // The true tap is earlier than the app saw it, by an unknown but sane amount.
    // Skip the click's own ring and stop short of the next click.
    const s = c + Math.max(smp(60), Math.round((app - 0.15) * sr));
    const e = c + Math.min(Math.round((app + 0.04) * sr), Math.round(BEAT * sr) - smp(30));
    if (e - s < smp(10) || e > len) continue;
    const on = onset(hpEnv, s, e, median(hpEnv.subarray(s, e)));
    if (on !== null) corr.push(app - (on - c) / sr);
  }
  if (corr.length < MIN_TAPS) throw new Error(`ONLY ${corr.length} TAPS HEARD`);

  const m = median(corr);
  const sd = Math.sqrt(corr.reduce((a, x) => a + (x - m) ** 2, 0) / corr.length);
  return { latency: Math.round(m * 1000), jitter: Math.round(sd * 10000) / 10, used: corr.length };
}

/** Rectified moving average over `w` samples. */
function envelope(x: Float32Array, w: number) {
  const out = new Float32Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += Math.abs(x[i]);
    if (i >= w) sum -= Math.abs(x[i - w]);
    out[i] = sum / w;
  }
  return out;
}

function median(xs: ArrayLike<number>) {
  if (!xs.length) return 0;
  const s = Array.from(xs).sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** First index in [a, b) where env rises 25% of the way from noise to the window's peak. */
function onset(env: Float32Array, a: number, b: number, noise: number): number | null {
  a = Math.max(0, a);
  b = Math.min(env.length, b);
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, env[i]);
  if (peak === 0 || peak < noise * 4) return null;
  const thr = noise + 0.25 * (peak - noise);
  for (let i = a; i < b; i++) if (env[i] >= thr) return i;
  return null;
}
