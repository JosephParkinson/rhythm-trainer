import { findRoundTrip, median, msStats, onset, prepare, toneOnsets, type Recording } from './analysis';
import type { Engine } from './engine';
import { openMic, startRecorder, type Recorder } from './recorder';

/*
 * Mic-based input-latency calibration.
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
const MIN_TAPS = 6;
const TAIL = 0.6;

export interface CalResult {
  /** ms to subtract from hits */
  latency: number;
  /** ms, standard deviation of the per-tap correction */
  jitter: number;
  used: number;
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
    const stream = await openMic();
    let rec: Recorder | null = null;
    try {
      rec = await startRecorder(ctx, stream);
      if (this.cancelled) throw new Error('CANCELLED');

      const t0 = ctx.currentTime + 0.5;
      const clicks = Array.from({ length: INTRO + CAL_TAPS }, (_, k) => t0 + k * BEAT);
      clicks.forEach((t) => this.eng.calClick(t));
      const end = clicks[clicks.length - 1] + BEAT + TAIL;

      while (ctx.currentTime < end) {
        if (this.cancelled) throw new Error('CANCELLED');
        const now = this.eng.heardTime(performance.now());
        onTick(now < t0 + (INTRO - 1) * BEAT, tapsByClick(this.taps, clicks).size);
        await new Promise((r) => setTimeout(r, 50));
      }
      return analyseCalibration(rec.finish(), clicks, tapsByClick(this.taps, clicks));
    } finally {
      rec?.dispose();
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

/**
 * @param clicks AudioContext times the clicks were scheduled at
 * @param taps heard time of the tap after each click, keyed by click index
 */
export function analyseCalibration(rec: Recording, clicks: number[], taps: Map<number, number>): CalResult {
  const p = prepare(rec);
  const { sr, smp, hpEnv } = p;
  const clickOn = toneOnsets(p, clicks, findRoundTrip(p, clicks));

  const corr: number[] = [];
  for (const [k, heard] of taps) {
    const c = clickOn[k];
    if (c === null) continue;
    const app = heard - clicks[k];
    // The true tap is earlier than the app saw it, by an unknown but sane amount.
    // Skip the click's own ring and stop short of the next click.
    const s = c + Math.max(smp(60), Math.round((app - 0.15) * sr));
    const e = c + Math.min(Math.round((app + 0.04) * sr), Math.round(BEAT * sr) - smp(30));
    if (e - s < smp(10) || e > p.len) continue;
    const on = onset(hpEnv, s, e, median(hpEnv.subarray(s, e)));
    if (on !== null) corr.push(app - (on - c) / sr);
  }
  if (corr.length < MIN_TAPS) throw new Error(`ONLY ${corr.length} TAPS HEARD`);

  const { median: latency, sd } = msStats(corr);
  return { latency, jitter: sd, used: corr.length };
}
