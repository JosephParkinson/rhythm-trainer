import { expect, test } from 'vitest';
import { History, summariseRun, withMetronome } from './history';
import { editorPlan } from './plan';
import { Take } from './scoring';
import { defaultSettings } from './settings';
import { MemoryStore } from './storage';

/** A one-bar run of the default pattern with a kick on step 0, 10 ms late. */
function run(metronome = true) {
  const take = new Take(0, 0.1, 1);
  take.record(0, 0.01, 1);
  return { plan: editorPlan({ ...defaultSettings(), metronome }, 'X'), takes: [take] };
}

test('records summaries per run, persists, and filters by ref', () => {
  const store = new MemoryStore();
  const h = new History(store);
  h.add('pattern', 'p1', run(), 1000);
  h.add('pattern', 'p2', run(), 2000);

  const recs = new History(store).for('pattern', 'p1');
  expect(recs).toHaveLength(1);
  expect(recs[0].total).toMatchObject({ hit: 1, avg: 10 });
  expect(recs[0].tracks[0]).toMatchObject({ notes: 2, hit: 1 });
  expect(recs[0].subs[0].notes).toBeGreaterThan(0);

  h.remove('pattern', 'p1');
  expect(h.for('pattern', 'p1')).toHaveLength(0);
  expect(h.for('pattern', 'p2')).toHaveLength(1);
});

test('records whether the metronome was on; old records count as on', () => {
  const h = new History(new MemoryStore());
  h.add('pattern', 'm', run(true));
  h.add('pattern', 'm', run(false));
  expect(h.for('pattern', 'm').map(withMetronome)).toEqual([true, false]);
  const { metronome: _, ...old } = h.for('pattern', 'm')[1];
  expect(withMetronome(old)).toBe(true);
});

test('muted tracks are left out of the summary', () => {
  const sum = summariseRun(run(), [true, false, false, false]);
  expect(sum.total.hit).toBe(0);
  expect(sum.tracks[0].notes).toBe(0);
});

test('drops malformed stored records', () => {
  const store = new MemoryStore();
  store.setItem('rhythm-trainer-history', JSON.stringify([{ id: 'x' }, 'junk', null]));
  expect(new History(store).for('pattern', 'x')).toEqual([]);
});
