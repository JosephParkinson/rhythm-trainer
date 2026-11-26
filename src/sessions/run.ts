import { Scheduler, playClickStep, playCountInStep, playPatternStep, playPianoStep } from '../audio/scheduler';
import { BEATS_PER_BAR, STEPS, STEPS_PER_BEAT, hasClick, patternSteps, stepDurFor } from '../core/pattern';
import { leadIn, type RunPlan, type RunResult, type SegmentSpec } from '../core/plan';
import { Take } from '../core/scoring';
import { segmentStatus } from '../ui/format';
import type { Deps, Session } from './session';

/** s before the first step, so scheduling never starts late */
const LEAD_IN = 0.25;

interface Segment {
  spec: SegmentSpec;
  stepDur: number;
  /** steps of pattern heard first (0 if off), then where the played bars start */
  hear: number;
  lead: number;
  /** AudioContext time the segment's lead-in starts */
  start: number;
  take: Take;
  sched: Scheduler;
}

/**
 * TEST: plays a RunPlan. For each segment: optionally the whole pattern once,
 * the count-in, then the played bars with the segment's click (the pattern
 * loops if it's shorter than the bars played). Segments run back to back, each
 * with its own scheduler (created up front; later ones just wait).
 */
export class RunSession implements Session {
  readonly mode = 'test';
  private readonly segs: Segment[];
  private readonly latency: number;
  private shown = '';

  constructor(
    private readonly d: Deps,
    readonly plan: RunPlan,
  ) {
    const { eng } = d;
    this.latency = d.settings.latency / 1000;

    let t = eng.now + LEAD_IN;
    this.segs = plan.segments.map((spec) => {
      const { hear, count } = leadIn(plan, spec);
      const lead = hear + count;
      const len = patternSteps(spec.pattern);
      const stepDur = stepDurFor(spec.bpm);
      const start = t;
      const take = new Take(start + lead * stepDur, stepDur, spec.bars);
      const sched = new Scheduler(eng, start, stepDur, 0, lead + take.steps, (step, time) => {
        const backing = !d.settings.pianoMuted;
        if (step < hear) {
          playPatternStep(eng, spec.pattern, step, time, d.settings.muted);
          if (backing) playPianoStep(eng, spec.piano, step, time, stepDur);
        } else if (step < lead) playCountInStep(eng, step - hear, time);
        else {
          const played = step - lead;
          playClickStep(eng, spec.click, played % STEPS, time);
          if (backing) playPianoStep(eng, spec.piano, played % len, time, stepDur);
        }
      });
      t = take.end;
      return { spec, stepDur, hear, lead, start, take, sched };
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
    let text: string;
    let playhead = -1;

    if (pos < seg.lead) {
      controls.setRecording(pos < 0 ? 'off' : 'lead');
      if (pos >= 0 && pos < seg.hear) {
        // Hearing the pattern: follow it across its pages.
        text = 'LISTEN';
        const step = Math.floor(pos);
        grid.setPage(Math.floor(step / STEPS));
        playhead = step % STEPS;
        this.shown = '';
      } else {
        text = pos < 0 ? '' : `COUNT ${(Math.floor((pos - seg.hear) / STEPS_PER_BEAT) % BEATS_PER_BAR) + 1}`;
        this.show(i, 0);
      }
    } else {
      controls.setRecording('rec');
      const played = pos - seg.lead;
      const step = Math.min(Math.floor(played), seg.take.steps - 1);
      const bar = Math.floor(step / STEPS);
      if (played < seg.take.steps) playhead = step % STEPS;
      this.show(i, bar);
      text = `BAR ${bar + 1}/${seg.spec.bars}`;
    }

    // Without a metronome the step lights would be a visual click, so they're greyed out.
    const noClick = !hasClick(seg.spec.click);
    grid.setStepLedsOff(noClick);
    grid.setPlayhead(noClick ? -1 : playhead);
    controls.status(segmentStatus(this.plan, i, text));
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
    this.d.grid.setStepLedsOff(false);
    this.segs.forEach((s) => s.sched.stop());
    this.d.eng.cancelScheduled();
  }

  /** Shows a played bar of a segment (its pattern page, roll and hits so far). */
  private show(i: number, bar: number) {
    const key = `${i}:${bar}`;
    if (key === this.shown) return;
    this.shown = key;
    const { take, spec } = this.segs[i];
    this.d.grid.setPattern(spec.pattern);
    this.d.roll.setNotes(spec.piano);
    this.d.grid.showBar(take, spec.pattern, bar, false);
  }
}
