import type { History } from '../history';
import type { Library } from '../library';
import { confirmBox, promptText } from './dialog';
import { el } from './dom';
import { renderHistory } from './history-view';
import { button, heading, listBox, select } from './widgets';

const ALL = '*';
const UNFILED = '';

/** PRACTICE > PATTERNS: folders on the left, the folder's patterns on the right, history of the selected pattern below. */
export class PatternsView {
  private folder = ALL;
  private selected: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly lib: Library,
    private readonly history: History,
    private readonly onLoad: (patternId: string) => void,
  ) {
    lib.onChange(() => this.render());
    history.onChange(() => this.render());
    this.render();
  }

  render() {
    const { lib } = this;
    const folder = lib.folders.find((f) => f.id === this.folder);
    if (this.folder !== ALL && this.folder !== UNFILED && !folder) this.folder = ALL;
    const sel = lib.pattern(this.selected);
    this.root.replaceChildren();
    const cols = el('div', 'cols', this.root);

    // folders
    const side = el('div', 'col side', cols);
    heading(side, 'FOLDERS');
    const count = (id: string | null) => String(lib.patterns.filter((p) => p.folderId === id).length);
    listBox(
      side,
      [
        { id: ALL, label: 'ALL', detail: String(lib.patterns.length) },
        { id: UNFILED, label: 'UNFILED', detail: count(null) },
        ...lib.folders.map((f) => ({ id: f.id, label: f.name, detail: count(f.id) })),
      ],
      this.folder,
      (id) => {
        this.folder = id;
        this.render();
      },
    );
    const fb = el('div', 'btnrow', side);
    button(fb, 'NEW', async () => {
      const name = await promptText('NEW FOLDER');
      if (!name) return;
      this.folder = lib.addFolder(name).id;
      this.render();
    });
    button(fb, 'RENAME', async () => {
      const name = folder && (await promptText('RENAME FOLDER', folder.name));
      if (folder && name) lib.renameFolder(folder.id, name);
    }).disabled = !folder;
    button(fb, 'DELETE', async () => {
      if (folder && (await confirmBox(`DELETE FOLDER "${folder.name}"? ITS PATTERNS BECOME UNFILED.`, 'DELETE'))) {
        lib.deleteFolder(folder.id);
      }
    }).disabled = !folder;

    // patterns
    const main = el('div', 'col main', cols);
    heading(main, 'PATTERNS');
    const shown = lib.patterns
      .filter((p) => this.folder === ALL || (p.folderId ?? UNFILED) === this.folder)
      .sort((a, b) => a.name.localeCompare(b.name));
    listBox(
      main,
      shown.map((p) => ({ id: p.id, label: p.name, detail: `${p.bpm} BPM` })),
      sel?.id ?? null,
      (id) => {
        this.selected = id;
        this.render();
      },
      this.onLoad,
    );
    const pb = el('div', 'btnrow', main);
    button(pb, 'LOAD', () => sel && this.onLoad(sel.id)).disabled = !sel;
    button(pb, 'RENAME', async () => {
      const name = sel && (await promptText('RENAME PATTERN', sel.name));
      if (sel && name) lib.renamePattern(sel.id, name);
    }).disabled = !sel;
    const move = el('label', '', pb);
    move.append('MOVE TO');
    select(
      move,
      [{ value: UNFILED, label: 'UNFILED' }, ...lib.folders.map((f) => ({ value: f.id, label: f.name }))],
      sel?.folderId ?? UNFILED,
      (v) => sel && lib.movePattern(sel.id, v || null),
    ).disabled = !sel;
    button(pb, 'DELETE', async () => {
      if (!sel) return;
      const used = lib.routinesUsing(sel.id).length;
      const note = used ? ` IT WILL BE REMOVED FROM ${used} ROUTINE${used > 1 ? 'S' : ''}.` : '';
      if (!(await confirmBox(`DELETE "${sel.name}" AND ITS HISTORY?${note}`, 'DELETE'))) return;
      this.history.remove('pattern', sel.id);
      lib.deletePattern(sel.id);
    }).disabled = !sel;

    if (sel) renderHistory(el('div', 'panel historybox', this.root), this.history.for('pattern', sel.id), sel.name);
  }
}
