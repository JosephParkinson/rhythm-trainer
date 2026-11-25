import { beforeEach, describe, expect, test } from 'vitest';
import { History, withMetronome } from './history';
import { Library, sanitizeLibrary } from './library';
import { editorPlan, routinePlan, barRefs, type RunResult } from './plan';
import { Take } from './scoring';
import { defaultSettings, emptyPattern, type KeyValueStore } from './settings';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

let store: MemoryStore;
let lib: Library;

beforeEach(() => {
  store = new MemoryStore();
  lib = new Library(store);
});

const grid = () => {
  const g = emptyPattern();
  g[0][0] = true;
  return g;
};

describe('Library', () => {
  test('save creates, then overwrites by id, storing a copy', () => {
    const g = grid();
    const p = lib.savePattern({ name: 'Groove', folderId: null, bpm: 100, grid: g });
    g[0][1] = true;
    expect(lib.pattern(p.id)?.grid[0][1]).toBe(false);

    lib.savePattern({ id: p.id, name: 'Groove', folderId: null, bpm: 120, grid: g });
    expect(lib.patterns).toHaveLength(1);
    expect(lib.pattern(p.id)).toMatchObject({ bpm: 120 });
  });

  test('saves a copy of the keyboard part, defaulting to none', () => {
    const piano = [{ pitch: 60, step: 0, len: 4 }];
    const p = lib.savePattern({ name: 'Keys', folderId: null, bpm: 90, grid: grid(), piano });
    piano[0].len = 1;
    expect(new Library(store).pattern(p.id)?.piano).toEqual([{ pitch: 60, step: 0, len: 4 }]);
    expect(lib.savePattern({ name: 'NoKeys', folderId: null, bpm: 90, grid: grid() }).piano).toEqual([]);
  });

  test('persists and reloads', () => {
    const f = lib.addFolder('Funk');
    const p = lib.savePattern({ name: 'A', folderId: f.id, bpm: 90, grid: grid() });
    const r = lib.addRoutine('Warmup');
    lib.addItem(r.id, p.id);
    const again = new Library(store);
    expect(again.pattern(p.id)?.folderId).toBe(f.id);
    expect(again.routine(r.id)?.items).toHaveLength(1);
  });

  test('deleting a folder unfiles its patterns', () => {
    const f = lib.addFolder('Funk');
    const p = lib.savePattern({ name: 'A', folderId: f.id, bpm: 90, grid: grid() });
    lib.deleteFolder(f.id);
    expect(lib.pattern(p.id)?.folderId).toBeNull();
  });

  test('deleting a pattern removes it from routines', () => {
    const a = lib.savePattern({ name: 'A', folderId: null, bpm: 90, grid: grid() });
    const b = lib.savePattern({ name: 'B', folderId: null, bpm: 90, grid: grid() });
    const r = lib.addRoutine('R');
    lib.addItem(r.id, a.id);
    lib.addItem(r.id, b.id);
    lib.deletePattern(a.id);
    expect(lib.routine(r.id)?.items.map((i) => i.patternId)).toEqual([b.id]);
  });

  test('routine items: add uses pattern bpm, move, set all bpm, remove', () => {
    const a = lib.savePattern({ name: 'A', folderId: null, bpm: 80, grid: grid() });
    const b = lib.savePattern({ name: 'B', folderId: null, bpm: 140, grid: grid() });
    const r = lib.addRoutine('R');
    lib.addItem(r.id, a.id);
    lib.addItem(r.id, b.id);
    expect(lib.routine(r.id)?.items.map((i) => i.bpm)).toEqual([80, 140]);
    lib.moveItem(r.id, 0, 1);
    expect(lib.routine(r.id)?.items.map((i) => i.patternId)).toEqual([b.id, a.id]);
    lib.moveItem(r.id, 0, -1); // out of range: no-op
    lib.setAllBpm(r.id, 100);
    expect(lib.routine(r.id)?.items.map((i) => i.bpm)).toEqual([100, 100]);
    lib.removeItem(r.id, 0);
    expect(lib.routine(r.id)?.items).toHaveLength(1);
  });

  test('notifies listeners on change', () => {
    let n = 0;
    lib.onChange(() => n++);
    lib.addFolder('X');
    lib.renameFolder('missing', 'Y'); // no target: no change
    expect(n).toBe(1);
  });
});

test('sanitizeLibrary drops malformed and dangling entries', () => {
  const data = sanitizeLibrary({
    folders: [{ id: 'f', name: 'F' }, { id: 1 }],
    patterns: [
      { id: 'p', name: 'P', folderId: 'gone', bpm: 999, grid: emptyPattern() },
      { id: 'bad', name: 'B', grid: [[true]] },
    ],
    routines: [{ id: 'r', name: 'R', items: [{ patternId: 'p', bars: 0, bpm: 100 }, { patternId: 'bad' }] }],
  });
  expect(data.folders).toHaveLength(1);
  expect(data.patterns).toEqual([expect.objectContaining({ id: 'p', folderId: null, bpm: 240 })]);
  expect(data.routines[0].items).toEqual([expect.objectContaining({ patternId: 'p', bars: 1, click: expect.any(Array) })]);
});

describe('plans and history', () => {
  test('routine plan copies patterns and skips none; bar refs span segments', () => {
    const a = lib.savePattern({ name: 'A', folderId: null, bpm: 80, grid: grid() });
    const r = lib.addRoutine('R');
    lib.addItem(r.id, a.id);
    lib.addItem(r.id, a.id);
    lib.updateItem(r.id, 1, { bars: 2 });
    const plan = routinePlan(lib.routine(r.id)!, lib, { ...defaultSettings(), hearFirst: true, countIn: 2 });
    expect(plan.segments.map((s) => s.bars)).toEqual([4, 2]);
    expect(plan.segments[0].pattern).not.toBe(lib.pattern(a.id)!.grid);
    expect(plan).toMatchObject({ hearFirst: true, countIn: 2 });

    const result: RunResult = { plan, takes: [new Take(0, 0.1, 4), new Take(2, 0.1, 2)] };
    expect(barRefs(result).at(-1)).toEqual({ seg: 1, bar: 1 });
    expect(barRefs(result)).toHaveLength(6);
  });

  test('editor plan shares the editor pattern and maps metronome to the click', () => {
    const s = { ...defaultSettings(), metronome: false };
    const plan = editorPlan(s, 'X');
    expect(plan.segments[0].pattern).toBe(s.pattern);
    expect(plan.segments[0].click.flat().some(Boolean)).toBe(false);
  });

  test('history records summaries per run and filters by ref', () => {
    const h = new History(store);
    const s = defaultSettings();
    const plan = editorPlan(s, 'X');
    const take = new Take(0, 0.1, 1);
    take.record(0, 0.01, 1); // kick on step 0, +10ms
    h.add('pattern', 'p1', { plan, takes: [take] }, 1000);
    h.add('pattern', 'p2', { plan, takes: [take] }, 2000);

    const recs = new History(store).for('pattern', 'p1');
    expect(recs).toHaveLength(1);
    expect(recs[0].total).toMatchObject({ hit: 1, avg: 10 });
    expect(recs[0].tracks[0]).toMatchObject({ notes: 2, hit: 1 });
    expect(recs[0].subs[0].notes).toBeGreaterThan(0);

    h.remove('pattern', 'p1');
    expect(h.for('pattern', 'p1')).toHaveLength(0);
    expect(h.for('pattern', 'p2')).toHaveLength(1);
  });

  test('history records whether the metronome was on; old records count as on', () => {
    const h = new History(store);
    const take = new Take(0, 0.1, 1);
    h.add('pattern', 'm', { plan: editorPlan({ ...defaultSettings(), metronome: true }, 'X'), takes: [take] });
    h.add('pattern', 'm', { plan: editorPlan({ ...defaultSettings(), metronome: false }, 'X'), takes: [take] });
    expect(h.for('pattern', 'm').map(withMetronome)).toEqual([true, false]);
    const { metronome: _, ...old } = h.for('pattern', 'm')[1];
    expect(withMetronome(old)).toBe(true);
  });
});
