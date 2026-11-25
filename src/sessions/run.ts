import { Scheduler, playClickStep, playCountInStep, playPatternStep } from '../audio/scheduler';
import { leadIn, stepDurFor, type RunPlan, type RunResult, type SegmentSpec } from '../plan';
import { Take } from '../scoring';
import { BEATS_PER_BAR, STEPS, STEPS_PER_BEAT } from '../settings';
import type { Deps, Session } from './session';

const LEAD_IN = 0.25;
const MAX_NAME = 22;

interface Segment {
  spec: SegmentSpec;
  stepDur: number;
  /** AudioContext time the segment's lead-in starts */
  start: number;
  take: Take;
  sched: Scheduler;
}

/**
 * Plays a RunPlan: for each segment, an optional bar of the pattern, the
 * count-in, then the played bars with the segment's click. Segments run back to
 * back, each with its own scheduler (created up front; later ones just wait).
 */
export class RunSession implements Session {
  readonly mode = 'play';
  private readonly segs: Segment[];
  private readonly hear: number;
  private readonly lead: number;
  private readonly latency: number;
  private shown = '';

  constructor(
    private readonly d: Deps,
    readonly plan: RunPlan,
  ) {
    const { eng } = d;
    const { hear, count } = leadIn(plan);
    this.hear = hear;
    this.lead = hear + count;
    this.latency = d.settings.latency / 1000;

    let t = eng.now + LEAD_IN;
    this.segs = plan.segments.map((spec) => {
      const stepDur = stepDurFor(spec.bpm);
      const start = t;
      const take = new Take(start + this.lead * stepDur, stepDur, spec.bars);
      const sched = new Scheduler(eng, start, stepDur, 0, this.lead + take.steps, (step, time) => {
        if (step < hear) playPatternStep(eng, spec.pattern, step % STEPS, time);
        else if (step < this.lead) playCountInStep(eng, step - hear, time);
        else playClickStep(eng, spec.click, (step - this.lead) % STEPS, time);
      });
      t = take.end;
      return { spec, stepDur, start, take, sched };
    });
  }

  get result(): RunResult {
    return { plan: this.plan, takes: this.segs.map((s) => s.take) };
  }

  frame() {
    const { eng, grid, controls } = this.d;
    const now = eng.heardTime(performance.now());
    const last = this.segs[this.segs.length - 1];
    if (now >= last.take.end + last.stepDur) return this.d.finish(this);

    const i = Math.max(0, this.segs.findLastIndex((s) => s.start <= now));
    const seg = this.segs[i];
    const pos = (now - seg.start) / seg.stepDur;
    let line1: string;
    let playhead = -1;
    let bar = 0;

    if (pos < 0) line1 = 'READY';
    else if (pos < this.hear) {
      line1 = 'LISTEN';
      playhead = Math.floor(pos) % STEPS;
    } else if (pos < this.lead) {
      line1 = `COUNT-IN  ${(Math.floor((pos - this.hear) / STEPS_PER_BEAT) % BEATS_PER_BAR) + 1}`;
    } else {
      const played = pos - this.lead;
      const step = Math.min(Math.floor(played), seg.take.steps - 1);
      bar = Math.floor(step / STEPS);
      if (played < seg.take.steps) playhead = step % STEPS;
      line1 = `BAR ${bar + 1}/${seg.spec.bars}`;
    }

    this.show(i, bar);
    grid.setPlayhead(playhead);
    controls.lcd(line1, this.status(i));
  }

  hit(track: number, perfMs: number, vel: number) {
    const t = this.d.eng.heardTime(perfMs) - this.latency;
    this.segs.some((seg, i) => {
      const h = seg.take.record(track, t, vel);
      if (h && this.shown === `${i}:${Math.floor(h.step / STEPS)}`) {
        this.d.grid.showCell(seg.take, seg.spec.pattern, track, h.step, false);
      }
      return !!h;
    });
  }

  stop() {
    this.segs.forEach((s) => s.sched.stop());
    this.d.eng.cancelScheduled();
  }

  private show(i: number, bar: number) {
    const key = `${i}:${bar}`;
    if (key === this.shown) return;
    this.shown = key;
    const { take, spec } = this.segs[i];
    this.d.grid.setPattern(spec.pattern);
    this.d.grid.showBar(take, spec.pattern, bar, false);
  }

  private status(i: number) {
    const { spec } = this.segs[i];
    if (!this.plan.routineId) return `${spec.bpm} BPM`;
    return `${i + 1}/${this.segs.length} ${spec.name.slice(0, MAX_NAME)}`.padEnd(30) + `${spec.bpm} BPM`;
  }
}
