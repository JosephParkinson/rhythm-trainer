import { barRefs, type BarRef, type RunResult } from './plan';
import { patternBars } from './pattern';

/**
 * Where you are in a finished run's review. Bars are numbered globally across
 * the run's segments (see barRefs). Also remembers a paused replay so ▶ can
 * resume it.
 */
export class Review {
  readonly bars: readonly BarRef[];
  /** global bar on screen */
  private at = 0;
  /** segment whose replay was paused; ▶ on it resumes from the bar on screen */
  pausedSeg: number | null = null;

  constructor(readonly result: RunResult) {
    this.bars = barRefs(result);
  }

  get bar() {
    return this.at;
  }

  /** Moves to a global bar, clamped to the run. */
  goTo(bar: number) {
    this.at = Math.min(this.bars.length - 1, Math.max(0, bar));
  }

  /** Segment and bar within it on screen. */
  get current(): BarRef {
    return this.bars[this.at];
  }

  get spec() {
    return this.result.plan.segments[this.current.seg];
  }

  get take() {
    return this.result.takes[this.current.seg];
  }

  /** Global bar range [from, to) of a segment. */
  segmentBars(seg: number) {
    return { from: this.bars.findIndex((r) => r.seg === seg), to: this.bars.findLastIndex((r) => r.seg === seg) + 1 };
  }

  /** The global bar showing `page` of the pattern on screen, within the same pass (and segment). */
  pageBar(page: number) {
    const bars = patternBars(this.spec.pattern);
    const { to } = this.segmentBars(this.current.seg);
    return Math.min(to - 1, this.at - (this.current.bar % bars) + page);
  }

  /** Where ▶ on a segment starts: the bar on screen if its replay was paused there, else its first bar. */
  replayStart(seg: number) {
    const { from, to } = this.segmentBars(seg);
    return this.pausedSeg === seg && this.at >= from && this.at < to ? this.at : from;
  }
}
