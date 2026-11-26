import { STEPS, STEPS_PER_BEAT } from '../core/pattern';
import { el } from './dom';

export function button(parent: HTMLElement, label: string, onClick: () => void, cls = 'btn small') {
  const b = el('button', cls, parent);
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** A track-style label whose light is a mute switch (green = on, dark = muted). */
export function setMuteLight(label: HTMLElement, muted: boolean) {
  label.classList.toggle('muted', muted);
  label.title = muted ? 'Muted. Click to unmute' : 'Click to mute';
}

export function heading(parent: HTMLElement, text: string) {
  const h = el('div', 'coltitle', parent);
  h.textContent = text;
  return h;
}

interface ListItem {
  id: string;
  label: string;
  detail?: string;
}

/** Retro list box. Click selects; double-click activates. */
export function listBox(
  parent: HTMLElement,
  items: ListItem[],
  selected: string | null,
  onSelect: (id: string) => void,
  onActivate?: (id: string) => void,
) {
  const box = el('div', 'list', parent);
  if (!items.length) el('div', 'row empty', box).textContent = '-';
  for (const item of items) {
    const row = el('div', item.id === selected ? 'row sel' : 'row', box);
    el('span', 'name', row).textContent = item.label;
    if (item.detail) el('span', 'detail', row).textContent = item.detail;
    row.addEventListener('click', () => onSelect(item.id));
    if (onActivate) row.addEventListener('dblclick', () => onActivate(item.id));
  }
  return box;
}

/** Number input that commits on change (blur / Enter). */
export function numberBox(parent: HTMLElement, value: number, onChange: (v: number) => void) {
  const inp = el('input', 'num', parent);
  inp.type = 'number';
  inp.value = String(value);
  inp.addEventListener('change', () => onChange(Number(inp.value)));
  return inp;
}

export interface Option {
  value: string;
  label: string;
  group?: string;
}

export function select(parent: HTMLElement, options: Option[], value: string, onChange: (v: string) => void) {
  const sel = el('select', 'dropdown', parent);
  const groups = new Map<string, HTMLElement>();
  for (const o of options) {
    let target: HTMLElement = sel;
    if (o.group) {
      if (!groups.has(o.group)) {
        const g = el('optgroup', '', sel);
        g.label = o.group;
        groups.set(o.group, g);
      }
      target = groups.get(o.group)!;
    }
    const opt = el('option', '', target);
    opt.value = o.value;
    opt.textContent = o.label;
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const SUBDIVISIONS = ['', 'e', '&', 'a'];

/** Labelled rows of step cells with beat numbers, styled like the main grid (used for click tracks). */
export function stepRows(parent: HTMLElement, labels: string[], rows: boolean[][], onToggle: (r: number, s: number) => void) {
  const grid = el('div', 'grid steprows', parent);
  labels.forEach((label, r) => {
    el('span', 'lbl', el('div', 'rowhead', grid)).textContent = label;
    for (let s = 0; s < STEPS; s++) {
      const cell = el('div', Math.floor(s / STEPS_PER_BEAT) % 2 ? 'cell alt' : 'cell', grid);
      cell.classList.toggle('on', rows[r][s]);
      cell.addEventListener('mousedown', () => onToggle(r, s));
    }
  });
  el('div', '', grid);
  for (let s = 0; s < STEPS; s++) {
    const sub = s % STEPS_PER_BEAT;
    el('div', 'beatnum', grid).textContent = sub ? SUBDIVISIONS[sub] : String(s / STEPS_PER_BEAT + 1);
  }
  return grid;
}
