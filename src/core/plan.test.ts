import { expect, test } from 'vitest';
import { Library } from './library';
import { emptyPattern } from './pattern';
import { barRefs, editorPlan, leadIn, routinePlan, usesMetronome, type RunResult } from './plan';
import { Take } from './scoring';
import { defaultSettings } from './settings';
import { MemoryStore } from './storage';

test('routine plan copies each pattern; bar refs span segments', () => {
  const lib = new Library(new MemoryStore());
  const a = lib.savePattern({ name: 'A', folderId: null, bpm: 80, grid: emptyPattern() });
  const r = lib.addRoutine('R');
  lib.addItem(r.id, a.id);
  lib.addItem(r.id, a.id);
  lib.updateItem(r.id, 1, { bars: 2 });
  const plan = routinePlan(lib.routine(r.id)!, lib, { ...defaultSettings(), hearFirst: true, countIn: 2 });
  expect(plan.segments.map((s) => s.bars)).toEqual([4, 2]);
  expect(plan.segments[0].pattern).not.toBe(lib.pattern(a.id)!.grid);
  expect(plan).toMatchObject({ hearFirst: true, countIn: 2 });

  const result: RunResult = { plan, takes: [new Take(0, 0.1, 4), new Take(2, 0.1, 2)] };
  expect(barRefs(result)).toHaveLength(6);
  expect(barRefs(result).at(-1)).toEqual({ seg: 1, bar: 1 });
});

test('editor plan shares the editor pattern and maps the metronome to the click', () => {
  const s = { ...defaultSettings(), metronome: false };
  const plan = editorPlan(s, 'X');
  expect(plan.segments[0].pattern).toBe(s.pattern);
  expect(usesMetronome(plan)).toBe(false);
  expect(usesMetronome(editorPlan(defaultSettings(), 'X'))).toBe(true);
});

test('lead-in: the whole pattern once if hearFirst, then the count-in', () => {
  const s = { ...defaultSettings(), hearFirst: true, countIn: 2, pattern: emptyPattern(3) };
  const plan = editorPlan(s, 'X');
  expect(leadIn(plan, plan.segments[0])).toEqual({ hear: 48, count: 32 });
  expect(leadIn({ ...plan, hearFirst: false }, plan.segments[0]).hear).toBe(0);
});
