import { envelope, findRoundTrip, median, msStats, onset, prepare, type Recording } from './analysis';
import type { Engine } from './engine';
import { poll, withMicRecording } from './recorder';

/*
 * Lag test: how long from physically hitting a pad or key to hearing the app's
 * sound. Each tap triggers a 1 kHz beep through the same path a drum hit takes
 * (input event → JS → Web Audio → speakers). The mic hears the tap's own noise
 * and then the beep; the gap between them in the recording is the lag.
 */

export const LAG_TAPS = 12;
/** Taps closer together than this are ignored, so one tap's release noise can't land in the next tap's window. */
const MIN_GAP_MS = 600;
/** How far before its beep a tap's noise is searched for. */
const WINDOW = 0.3;
const MIN_TAPS = 6;
const TIMEOUT = 45;

export interface LagResult {
  /** ms, median tap → sound */
  lag: number;
  /** ms, standard deviation */
  jitter: number;
  used: number;
}

export class LagTest {
  /** AudioContext time each beep was triggered */
  private readonly triggers: number[] = [];
  private lastTap = -Infinity;
  private cancelled = false;

  constructor(private readonly eng: Engine) {}

  get taps() {
    return this.triggers.length;
  }

  tap(perfMs: number) {
    if (this.triggers.length >= LAG_TAPS || perfMs - this.lastTap < MIN_GAP_MS) return;
    this.lastTap = perfMs;
    this.triggers.push(this.eng.now);
    this.eng.beep();
  }

  cancel() {
    this.cancelled = true;
  }

  async run(onTick: (taps: number) => void): Promise<LagResult> {
    const ctx = this.eng.ctx;
    return withMicRecording(ctx, async (rec) => {
      const deadline = ctx.currentTime + TIMEOUT;
      while (true) {
        onTick(this.taps);
        const last = this.triggers[this.triggers.length - 1] ?? 0;
        if (this.taps >= LAG_TAPS && ctx.currentTime > last + 0.7) break;
        if (ctx.currentTime > deadline) {
          if (this.taps >= MIN_TAPS) break;
          throw new Error('TIMED OUT');
        }
        await poll(() => this.cancelled);
      }
      return analyseLag(rec.finish(), this.triggers);
    });
  }
}

/** @param triggers AudioContext times each beep was triggered */
export function analyseLag(rec: Recording, triggers: number[]): LagResult {
  const p = prepare(rec);
  const { sr, smp, hpEnv } = p;
  const roundTrip = findRoundTrip(p, triggers);
  // The tap's noise sits just before its beep, so find each beep by its tone
  // (band-passed, finely smoothed) rather than by broadband level.
  const toneEnv = envelope(rec.bp, smp(0.5));

  const lags: number[] = [];
  for (const t of triggers) {
    const a = p.pos(t) + roundTrip - smp(15);
    const b = onset(toneEnv, a, a + smp(30), median(toneEnv.subarray(Math.max(0, a - smp(45)), Math.max(0, a))));
    if (b === null) continue;
    const w = b - Math.round(WINDOW * sr);
    const noise = median(hpEnv.subarray(Math.max(0, w - Math.round(WINDOW * sr)), Math.max(0, w)));
    // Stop short of the beep so its own start can't be mistaken for the tap.
    const tap = onset(hpEnv, w, b - smp(3), noise);
    if (tap !== null) lags.push((b - tap) / sr);
  }
  if (lags.length < MIN_TAPS) throw new Error(`ONLY ${lags.length} TAPS HEARD`);

  const { median: lag, sd } = msStats(lags);
  return { lag, jitter: sd, used: lags.length };
}
