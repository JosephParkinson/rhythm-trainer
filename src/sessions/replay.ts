import { Scheduler, playClickStep } from '../audio/scheduler';
import { barRefs, type RunResult } from '../plan';
import type { Hit } from '../scoring';
import { STEPS, TRACKS } from '../settings';
import type { Deps, Session } from './session';

const LEAD_IN = 0.3;

interface Segment {
  /** index into the result */
  index: number;
  /** global bar index of this segment's first bar */
  barBase: number;
  /** first step played */
  from: number;
  /** step after the last one played */
  to: number;
  stepDur: number;
  /** AudioContext time of step 0 */
  start: number;
  sched: Scheduler;
}

/**
 * Plays a result's hits back at their actual times with the click that was
 * heard, for global bars [fromBar, toBar). Lead-ins are skipped.
 */
export class ReplaySession implements Session {
  readonly mode = 'replay';
  private readonly segs: Segment[] = [];
  private bar: number;

  constructor(
    private readonly d: Deps,
    result: RunResult,
    fromBar: number,
    toBar: number,
    /** the global bar being heard changed */
    private readonly onBar: (bar: number) => void,
  ) {
    const { eng } = d;
    this.bar = fromBar;
    const refs = barRefs(result);
    const first = refs[fromBar];
    const last = refs[toBar - 1];
    let t = eng.now + LEAD_IN;

    for (let k = first.seg; k <= last.seg; k++) {
      const take = result.takes[k];
      const click = result.plan.segments[k].click;
      const byStep = new Map<number, Hit[]>();
      for (const h of take.hits) byStep.set(h.step, [...(byStep.get(h.step) ?? []), h]);

      const from = k === first.seg ? first.bar * STEPS : 0;
      const to = k === last.seg ? (last.bar + 1) * STEPS : take.steps;
      const start = t - from * take.stepDur;
      const sched = new Scheduler(eng, start, take.stepDur, from, to, (step, time) => {
        playClickStep(eng, click, step % STEPS, time);
        for (const h of byStep.get(step) ?? []) eng.schedule(TRACKS[h.track].voice, time + h.err / 1000, h.vel);
      });
      const barBase = refs.findIndex((r) => r.seg === k);
      this.segs.push({ index: k, barBase, from, to, stepDur: take.stepDur, start, sched });
      t = start + to * take.stepDur;
    }
  }

  frame() {
    const now = this.d.eng.heardTime(performance.now());
    const last = this.segs[this.segs.length - 1];
    if (now >= last.start + (last.to + 1) * last.stepDur) return this.d.finish(this);

    const seg = this.segs[Math.max(0, this.segs.findLastIndex((s) => s.start + s.from * s.stepDur <= now))];
    const pos = (now - seg.start) / seg.stepDur;
    if (pos < seg.from) return;

    const step = Math.min(Math.floor(pos), seg.to - 1);
    const bar = seg.barBase + Math.floor(step / STEPS);
    if (bar !== this.bar) {
      this.bar = bar;
      this.onBar(bar);
    }
    this.d.grid.setPlayhead(pos < seg.to ? step % STEPS : -1);
  }

  stop() {
    this.segs.forEach((s) => s.sched.stop());
    this.d.eng.cancelScheduled();
  }
}
