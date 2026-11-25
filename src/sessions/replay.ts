import { Scheduler } from '../audio/scheduler';
import type { Hit, Take } from '../scoring';
import { STEPS, STEPS_PER_BEAT, TRACKS } from '../settings';
import type { Deps, Session } from './session';

const LEAD_IN = 0.3;

/** Plays a take's hits back at their actual times, from `fromBar`. */
export class ReplaySession implements Session {
  readonly mode = 'replay';
  private readonly sched: Scheduler;
  private bar: number;

  constructor(
    private readonly d: Deps,
    private readonly take: Take,
    private readonly fromBar: number,
    /** the bar being heard changed */
    private readonly onBar: (bar: number) => void,
  ) {
    const { eng, settings } = d;
    this.bar = fromBar;
    const byStep = new Map<number, Hit[]>();
    for (const h of take.hits) byStep.set(h.step, [...(byStep.get(h.step) ?? []), h]);

    const from = fromBar * STEPS;
    const start = eng.now + LEAD_IN - from * take.stepDur;
    this.sched = new Scheduler(eng, start, take.stepDur, from, take.steps, (step, t) => {
      if (settings.metronome && step % STEPS_PER_BEAT === 0) eng.click(t, step % STEPS === 0);
      for (const h of byStep.get(step) ?? []) eng.schedule(TRACKS[h.track].voice, t + h.err / 1000, h.vel);
    });
  }

  frame() {
    const pos = this.sched.position();
    if (pos >= this.take.steps + 1) return this.d.finish(this);
    if (pos < this.fromBar * STEPS) return;

    const step = Math.min(Math.floor(pos), this.take.steps - 1);
    const bar = Math.floor(step / STEPS);
    if (bar !== this.bar) {
      this.bar = bar;
      this.onBar(bar);
    }
    this.d.grid.setPlayhead(pos < this.take.steps ? step % STEPS : -1);
  }

  stop() {
    this.sched.stop();
  }
}
