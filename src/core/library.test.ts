import { beforeEach, describe, expect, test } from 'vitest';
import { Library, sanitizeLibrary } from './library';
import { emptyPattern } from './pattern';
import { MemoryStore } from './storage';

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
