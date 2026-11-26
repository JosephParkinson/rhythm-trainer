import type { Library, Routine } from './library';
import {
  STEPS,
  cloneGrid,
  clonePiano,
  defaultClick,
  emptyClick,
  hasClick,
  patternSteps,
  type ClickPattern,
  type Pattern,
  type PianoNote,
} from './pattern';
import type { Take } from './scoring';
import type { Settings } from './settings';

/** One pattern within a run. */
export interface SegmentSpec {
  name: string;
  patternId: string | null;
  pattern: Pattern;
  /** keyboard backing, looped with the pattern */
  piano: PianoNote[];
  /** heard during the played bars (one bar, repeated) */
  click: ClickPattern;
  bpm: number;
  bars: number;
}

/** What TEST plays: one segment for the editor pattern, one per item for a routine. */
export interface RunPlan {
  routineId: string | null;
  segments: SegmentSpec[];
  /** each segment opens with its whole pattern once */
  hearFirst: boolean;
  /** then this many bars of quarter-note click */
  countIn: number;
}

/** A finished TEST: the plan plus one take per segment. */
export interface RunResult {
  plan: RunPlan;
  takes: Take[];
}

/** Lead-in before a segment's played bars, in steps: the whole pattern once if hearFirst, then the count-in. */
export const leadIn = (plan: RunPlan, spec: SegmentSpec) => ({
  hear: plan.hearFirst ? patternSteps(spec.pattern) : 0,
  count: plan.countIn * STEPS,
});

/** A bar of a result: segment index and bar within that segment. */
export interface BarRef {
  seg: number;
  bar: number;
}

/** Every played bar of a result in order; review and replay index into this. */
export const barRefs = (r: RunResult): BarRef[] =>
  r.takes.flatMap((t, seg) => Array.from({ length: t.bars }, (_, bar) => ({ seg, bar })));

/** Played with a metronome: any segment had a click. */
export const usesMetronome = (plan: RunPlan) => plan.segments.some((s) => hasClick(s.click));

/** The click track for the METRONOME setting. */
export const metronomeClick = (on: boolean) => (on ? defaultClick() : emptyClick());

/**
 * The editor pattern as a single-segment plan. The segment shares the editor's
 * pattern and piano arrays, so editing them afterwards re-scores the review.
 */
export function editorPlan(s: Settings, name: string): RunPlan {
  return {
    routineId: null,
    segments: [
      {
        name,
        patternId: s.patternId,
        pattern: s.pattern,
        piano: s.piano,
        click: metronomeClick(s.metronome),
        bpm: s.bpm,
        bars: s.bars,
      },
    ],
    hearFirst: s.hearFirst,
    countIn: s.countIn,
  };
}

/** One segment per routine item, each with a copy of its saved pattern. */
export function routinePlan(routine: Routine, lib: Library, s: Settings): RunPlan {
  const segments: SegmentSpec[] = [];
  for (const item of routine.items) {
    const p = lib.pattern(item.patternId);
    if (!p) continue;
    segments.push({
      name: p.name,
      patternId: p.id,
      pattern: cloneGrid(p.grid),
      piano: clonePiano(p.piano),
      click: cloneGrid(item.click),
      bpm: item.bpm,
      bars: item.bars,
    });
  }
  return { routineId: routine.id, segments, hearFirst: s.hearFirst, countIn: s.countIn };
}
