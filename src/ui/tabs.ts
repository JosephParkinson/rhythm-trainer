import { $ } from './dom';

export type View = 'trainer' | 'patterns' | 'routines';
const PRACTICE_VIEWS = ['patterns', 'routines'] as const;
type PracticeView = (typeof PRACTICE_VIEWS)[number];

/** TRAINER / PRACTICE tabs and PRACTICE's PATTERNS / ROUTINES sub-tabs. PRACTICE reopens on its last sub-tab. */
export class Tabs {
  private practice: PracticeView = 'patterns';
  private readonly buttons = ['trainer', 'practice', ...PRACTICE_VIEWS].map((t) => $<HTMLButtonElement>(`tab-${t}`));

  constructor() {
    $('tab-trainer').addEventListener('click', () => this.show('trainer'));
    $('tab-practice').addEventListener('click', () => this.show(this.practice));
    for (const v of PRACTICE_VIEWS) $(`tab-${v}`).addEventListener('click', () => this.show(v));
  }

  show(v: View) {
    if (v !== 'trainer') this.practice = v;
    $('view-trainer').hidden = v !== 'trainer';
    $('view-practice').hidden = v === 'trainer';
    $('tab-trainer').classList.toggle('lit', v === 'trainer');
    $('tab-practice').classList.toggle('lit', v !== 'trainer');
    for (const p of PRACTICE_VIEWS) {
      $(p).hidden = p !== v;
      $(`tab-${p}`).classList.toggle('lit', p === v);
    }
  }

  /** No switching views while a session runs. */
  setLocked(locked: boolean) {
    this.buttons.forEach((b) => (b.disabled = locked));
  }
}
