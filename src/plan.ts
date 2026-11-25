import type { Library, Routine } from './library';
import type { Take } from './scoring';
import { STEPS, STEPS_PER_BEAT, cloneGrid, defaultClick, emptyClick, type ClickPattern, type Pattern, type Settings } from './settings';

/** One pattern within a run. */
export interface SegmentSpec {
  name: string;
  patternId: string | null;
  pattern: Pattern;
  /** heard during the played bars */
  click: ClickPattern;
  bpm: number;
  bars: number;
}

/** What PLAY will do: one segment for the editor, one per item for a routine. */
export interface RunPlan {
  routineId: string | null;
  name: string;
  segments: SegmentSpec[];
  /** each segment opens with one bar of its pattern */
  hearFirst: boolean;
  /** then this many bars of quarter-note click */
  countIn: number;
}

export interface RunResult {
  plan: RunPlan;
  /** one per segment */
  takes: Take[];
}

export const stepDurFor = (bpm: number) => 60 / bpm / STEPS_PER_BEAT;

/** Lead-in before each segment's played bars, in steps. */
export const leadIn = (plan: RunPlan) => ({
  hear: plan.hearFirst ? STEPS : 0,
  count: plan.countIn * STEPS,
});

/** A bar of a result: segment index and bar within that segment. */
export interface BarRef {
  seg: number;
  bar: number;
}

export const barRefs = (r: RunResult): BarRef[] =>
  r.takes.flatMap((t, seg) => Array.from({ length: t.bars }, (_, bar) => ({ seg, bar })));

/**
 * The editor pattern as a single-segment plan. The segment shares the editor's
 * pattern array, so editing it afterwards re-scores the review.
 */
export function editorPlan(s: Settings, name: string): RunPlan {
  return {
    routineId: null,
    name,
    segments: [
      {
        name,
        patternId: s.patternId,
        pattern: s.pattern,
        click: s.metronome ? defaultClick() : emptyClick(),
        bpm: s.bpm,
        bars: s.bars,
      },
    ],
    hearFirst: s.hearFirst,
    countIn: s.countIn,
  };
}

export function routinePlan(routine: Routine, lib: Library, s: Settings): RunPlan {
  const segments: SegmentSpec[] = [];
  for (const item of routine.items) {
    const p = lib.pattern(item.patternId);
    if (!p) continue;
    segments.push({
      name: p.name,
      patternId: p.id,
      pattern: cloneGrid(p.grid),
      click: cloneGrid(item.click),
      bpm: item.bpm,
      bars: item.bars,
    });
  }
  return { routineId: routine.id, name: routine.name, segments, hearFirst: s.hearFirst, countIn: s.countIn };
}
