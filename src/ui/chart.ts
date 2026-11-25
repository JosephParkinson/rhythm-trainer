import { el } from './dom';

export interface Series {
  name: string;
  /** validated against the dark LCD surface (see CLAUDE.md) */
  color: string;
  values: number[];
}

const W = 640;
const H = 170;
const M = { l: 34, r: 40, t: 12, b: 22 };
const NS = 'http://www.w3.org/2000/svg';
const LABEL_GAP = 11;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}

/** Rounds up to 1, 2 or 5 × 10^n. */
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p;
}

/**
 * Line chart of values over attempts (one shared ms axis from 0). Legend above,
 * direct labels at the line ends, crosshair + tooltip on hover.
 */
export function lineChart(parent: HTMLElement, series: Series[], tooltip: (i: number) => string) {
  const n = Math.max(...series.map((s) => s.values.length));
  const wrap = el('div', 'chart', parent);

  const legend = el('div', 'chartlegend', wrap);
  for (const s of series) {
    const item = el('span', '', legend);
    el('i', 'swatch', item).style.background = s.color;
    item.append(s.name);
  }

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, wrap);
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const max = niceMax(Math.max(10, ...series.flatMap((s) => s.values)));
  const x = (i: number) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => M.t + ih - (v / max) * ih;

  const ticks = String(max)[0] === '2' ? 4 : 5; // whole-number steps for 1/2/5 × 10^n
  for (let k = 0; k <= ticks; k++) {
    const v = (max / ticks) * k;
    svg('line', { x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v), class: 'gridline' }, root);
    svg('text', { x: M.l - 6, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, root).textContent = String(v);
  }
  const xTicks = n <= 10 ? [...Array(n).keys()] : [0, Math.round((n - 1) / 2), n - 1];
  for (const i of xTicks) {
    svg('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, root).textContent = String(i + 1);
  }

  const r = n > 40 ? 2.5 : 4;
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, root);
    s.values.forEach((v, i) => svg('circle', { cx: x(i), cy: y(v), r, fill: s.color, class: 'dot' }, root));
  }

  // Direct labels at the line ends, pushed apart so they never overlap.
  const ends = series
    .map((s) => ({ name: s.name, y: y(s.values[s.values.length - 1]) + 3, x: x(s.values.length - 1) + 8 }))
    .sort((a, b) => a.y - b.y);
  ends.forEach((e, i) => i && (e.y = Math.max(e.y, ends[i - 1].y + LABEL_GAP)));
  for (const e of ends) svg('text', { x: e.x, y: e.y, class: 'endlabel' }, root).textContent = e.name;

  // hover
  const cross = svg('line', { y1: M.t, y2: M.t + ih, class: 'crosshair', visibility: 'hidden' }, root);
  const tip = el('div', 'charttip', wrap);
  tip.hidden = true;
  const hit = svg('rect', { x: M.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }, root);
  hit.addEventListener('mousemove', (e) => {
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - M.l) / iw) * (n - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = tooltip(i);
    const left = (x(i) / W) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - tip.offsetWidth - 4)}px`;
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  return wrap;
}
