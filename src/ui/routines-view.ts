import type { History } from '../history';
import type { Library, Routine } from '../library';
import { CLICK_ROWS, clampSetting, cloneGrid, defaultClick, emptyClick } from '../settings';
import { confirmBox, promptText } from './dialog';
import { el } from './dom';
import { renderHistory } from './history-view';
import { button, heading, listBox, numberBox, select, stepRows, type Option } from './widgets';

/** PRACTICE > ROUTINES: routine list, the selected routine's items and click tracks, and its history. */
export class RoutinesView {
  private selected: string | null = null;
  /** item whose click track is open */
  private item: number | null = null;
  private allBpm = 90;
  private toAdd = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly lib: Library,
    private readonly history: History,
    private readonly onLoad: (routineId: string) => void,
  ) {
    lib.onChange(() => this.render());
    history.onChange(() => this.render());
    this.render();
  }

  render() {
    const { lib } = this;
    const r = lib.routine(this.selected);
    if (!r || this.item === null || this.item >= r.items.length) this.item = null;
    this.root.replaceChildren();
    const cols = el('div', 'cols', this.root);

    // routine list
    const side = el('div', 'col side', cols);
    heading(side, 'ROUTINES');
    listBox(
      side,
      lib.routines.map((x) => ({ id: x.id, label: x.name, detail: String(x.items.length) })),
      r?.id ?? null,
      (id) => {
        this.selected = id;
        this.item = null;
        this.render();
      },
      this.onLoad,
    );
    const rb = el('div', 'btnrow', side);
    button(rb, 'NEW', async () => {
      const name = await promptText('NEW ROUTINE');
      if (!name) return;
      this.selected = lib.addRoutine(name).id;
      this.render();
    });
    button(rb, 'RENAME', async () => {
      const name = r && (await promptText('RENAME ROUTINE', r.name));
      if (r && name) lib.renameRoutine(r.id, name);
    }).disabled = !r;
    button(rb, 'DELETE', async () => {
      if (!r || !(await confirmBox(`DELETE "${r.name}" AND ITS HISTORY?`, 'DELETE'))) return;
      this.history.remove('routine', r.id);
      lib.deleteRoutine(r.id);
    }).disabled = !r;
    button(rb, 'LOAD', () => r && this.onLoad(r.id)).disabled = !r?.items.length;

    const main = el('div', 'col main', cols);
    if (!r) {
      heading(main, 'ROUTINE');
      el('div', 'empty', main).textContent = lib.routines.length ? 'SELECT A ROUTINE' : 'NO ROUTINES';
      return;
    }
    this.renderRoutine(main, r);
    if (this.item !== null) this.renderClick(el('div', 'panel clickbox', this.root), r, this.item);
    renderHistory(el('div', 'panel historybox', this.root), this.history.for('routine', r.id), r.name);
  }

  private renderRoutine(main: HTMLElement, r: Routine) {
    const { lib } = this;
    const bars = r.items.reduce((a, i) => a + i.bars, 0);
    heading(main, `${r.name}  ${r.items.length} PATTERNS  ${bars} BARS`);

    const options: Option[] = [...lib.patterns]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        value: p.id,
        label: p.name,
        group: lib.folders.find((f) => f.id === p.folderId)?.name ?? 'UNFILED',
      }));
    if (!options.some((o) => o.value === this.toAdd)) this.toAdd = options[0]?.value ?? '';

    const bar = el('div', 'btnrow', main);
    const all = el('label', '', bar);
    all.append('ALL BPM');
    numberBox(all, this.allBpm, (v) => (this.allBpm = clampSetting('bpm', v, this.allBpm)));
    button(bar, 'SET', () => lib.setAllBpm(r.id, this.allBpm)).disabled = !r.items.length;
    const add = el('label', 'push', bar);
    select(add, options, this.toAdd, (v) => (this.toAdd = v)).disabled = !options.length;
    button(bar, 'ADD', () => this.toAdd && lib.addItem(r.id, this.toAdd)).disabled = !options.length;

    if (!r.items.length) {
      el('div', 'empty', main).textContent = options.length ? 'ADD PATTERNS ABOVE' : 'SAVE A PATTERN FIRST';
      return;
    }

    const t = el('table', 'data items', main);
    const head = el('tr', '', el('thead', '', t));
    for (const h of ['#', 'PATTERN', 'BARS', 'BPM', 'CLICK', '']) el('th', '', head).textContent = h;
    const body = el('tbody', '', t);
    r.items.forEach((item, i) => {
      const tr = el('tr', i === this.item ? 'sel' : '', body);
      el('td', '', tr).textContent = String(i + 1);
      select(el('td', '', tr), options, item.patternId, (v) => lib.updateItem(r.id, i, { patternId: v }));
      numberBox(el('td', '', tr), item.bars, (v) => lib.updateItem(r.id, i, { bars: clampSetting('bars', v, item.bars) }));
      numberBox(el('td', '', tr), item.bpm, (v) => lib.updateItem(r.id, i, { bpm: clampSetting('bpm', v, item.bpm) }));
      const edit = button(el('td', '', tr), 'EDIT', () => {
        this.item = this.item === i ? null : i;
        this.render();
      });
      edit.classList.toggle('lit', i === this.item);
      const ctl = el('td', 'ctl', tr);
      button(ctl, '▲', () => this.moveItem(r, i, -1)).disabled = i === 0;
      button(ctl, '▼', () => this.moveItem(r, i, 1)).disabled = i === r.items.length - 1;
      button(ctl, '✕', () => lib.removeItem(r.id, i));
    });
  }

  private renderClick(box: HTMLElement, r: Routine, i: number) {
    const { lib } = this;
    const item = r.items[i];
    heading(box, `CLICK  ${i + 1}. ${lib.pattern(item.patternId)?.name ?? ''}`);
    stepRows(box, CLICK_ROWS, item.click, (row, s) => {
      const click = cloneGrid(item.click);
      click[row][s] = !click[row][s];
      if (click[row][s]) click[1 - row][s] = false; // one click per step
      lib.updateItem(r.id, i, { click });
    });
    const cb = el('div', 'btnrow', box);
    button(cb, 'DEFAULT', () => lib.updateItem(r.id, i, { click: defaultClick() }));
    button(cb, 'NONE', () => lib.updateItem(r.id, i, { click: emptyClick() }));
  }

  private moveItem(r: Routine, i: number, d: number) {
    if (this.item === i) this.item = i + d;
    else if (this.item === i + d) this.item = i;
    this.lib.moveItem(r.id, i, d);
  }
}
