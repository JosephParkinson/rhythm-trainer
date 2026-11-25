import { el } from './dom';

export interface Column {
  label: string;
  title?: string;
}

/** Plain data table. `cls` on a row adds a row style (seg, sub, total, group). */
export function table(parent: HTMLElement, columns: Column[], rows: { cells: string[]; cls?: string }[]) {
  const t = el('table', 'data', parent);
  const head = el('tr', '', el('thead', '', t));
  for (const c of columns) {
    const th = el('th', '', head);
    th.textContent = c.label;
    if (c.title) th.title = c.title;
  }
  const body = el('tbody', '', t);
  for (const r of rows) {
    const tr = el('tr', r.cls ?? '', body);
    for (const c of r.cells) el('td', '', tr).textContent = c;
  }
  return t;
}
