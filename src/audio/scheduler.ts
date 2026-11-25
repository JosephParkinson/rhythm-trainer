import { STEPS, STEPS_PER_BEAT, TRACKS, type ClickPattern, type Pattern } from '../settings';
import type { Engine } from './engine';

const INTERVAL_MS = 25;
const LOOKAHEAD = 0.1;

/**
 * Lookahead step sequencer. Calls onStep(step, time) for each 16th in [from, to)
 * shortly before it's due, so endless loops work and long runs don't queue
 * thousands of nodes. Schedules half a step further ahead than strictly needed
 * so callers can place early hits (negative offsets) before their step.
 *
 * A scheduler created with a start time well in the future simply waits, so
 * consecutive segments can each have their own, created up front.
 */
export class Scheduler {
  private next: number;
  private readonly timer: number;

  constructor(
    private readonly eng: Engine,
    /** AudioContext time of step 0 */
    readonly start: number,
    readonly stepDur: number,
    from: number,
    private readonly to: number,
    private readonly onStep: (step: number, time: number) => void,
  ) {
    this.next = from;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), INTERVAL_MS);
  }

  /** Fractional step currently audible. */
  position(): number {
    return (this.eng.heardTime(performance.now()) - this.start) / this.stepDur;
  }

  /** Stops scheduling. Already-scheduled sound is cancelled separately via Engine.cancelScheduled(). */
  stop() {
    clearInterval(this.timer);
  }

  private pump() {
    const horizon = this.eng.now + LOOKAHEAD + this.stepDur / 2;
    for (; this.next < this.to; this.next++) {
      const t = this.start + this.next * this.stepDur;
      if (t >= horizon) break;
      this.onStep(this.next, t);
    }
  }
}

// ---------- step helpers ----------

/** Schedules every drum on step `s` of a pattern. */
export function playPatternStep(eng: Engine, pattern: Pattern, s: number, t: number) {
  TRACKS.forEach((track, i) => pattern[i][s] && eng.schedule(track.voice, t));
}

export function playClickStep(eng: Engine, click: ClickPattern, s: number, t: number) {
  if (click[0][s]) eng.click(t, true);
  else if (click[1][s]) eng.click(t, false);
}

/** Quarter-note count-in click, accented on the bar. */
export function playCountInStep(eng: Engine, step: number, t: number) {
  if (step % STEPS_PER_BEAT === 0) eng.click(t, step % STEPS === 0);
}
