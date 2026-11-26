import type { Engine } from '../audio/engine';
import type { Settings } from '../core/settings';
import type { ActiveMode, Controls } from '../ui/controls';
import type { Grid } from '../ui/grid';
import type { PianoRoll } from '../ui/piano-roll';

/** What a session may use. */
export interface Deps {
  eng: Engine;
  settings: Settings;
  grid: Grid;
  roll: PianoRoll;
  controls: Controls;
  /** Ends `session` as completed. No-op if it's no longer the current session. */
  finish(session: Session): void;
}

/**
 * One transport activity: TEST, PLAY, a replay or a mic test. The App runs one
 * at a time, calls frame() every animation frame, forwards hits, and calls
 * stop() exactly once when it ends: completed (the session called finish) or
 * cancelled (the user pressed its button again).
 */
export interface Session {
  readonly mode: ActiveMode;
  /** Hits make no drum sound (mic tests need to hear only the pad/key). */
  readonly mutesHits?: boolean;
  frame?(): void;
  hit?(track: number, perfMs: number, vel: number): void;
  /** Release timers and cancel scheduled audio. */
  stop(completed: boolean): void;
}
