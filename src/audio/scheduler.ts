import type { Engine } from './engine';

const INTERVAL_MS = 25;
const LOOKAHEAD = 0.1;

/**
 * Lookahead step sequencer. Calls onStep(step, time) for each 16th in [from, to)
 * shortly before it's due, so endless loops work and long runs don't queue
 * thousands of nodes. Schedules half a step further ahead than strictly needed
 * so callers can place early hits (negative offsets) before their step.
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

  stop() {
    clearInterval(this.timer);
    this.eng.cancelScheduled();
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
