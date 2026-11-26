import { $ } from './dom';

interface SourceEvents {
  newPattern(): void;
  load(): void;
  save(): void;
  /** unload the routine */
  exit(): void;
}

/** What the trainer has loaded (a pattern or a routine) and the buttons that change it. */
export class SourcePanel {
  private readonly kind = $('srcKind');
  private readonly name = $('srcName');
  private readonly patternButtons = (['new', 'load', 'save'] as const).map((id) => $<HTMLButtonElement>(id));
  private readonly exit = $<HTMLButtonElement>('exit');

  constructor(ev: SourceEvents) {
    const [newBtn, load, save] = this.patternButtons;
    newBtn.addEventListener('click', () => ev.newPattern());
    load.addEventListener('click', () => ev.load());
    save.addEventListener('click', () => ev.save());
    this.exit.addEventListener('click', () => ev.exit());
  }

  /** `name` is the routine's or pattern's name; `busy` disables the buttons while a session runs. */
  render(routine: boolean, name: string, busy: boolean) {
    this.kind.textContent = routine ? 'ROUTINE' : 'PATTERN';
    this.name.textContent = name;
    for (const b of this.patternButtons) {
      b.hidden = routine;
      b.disabled = busy;
    }
    this.exit.hidden = !routine;
    this.exit.disabled = busy;
  }
}
