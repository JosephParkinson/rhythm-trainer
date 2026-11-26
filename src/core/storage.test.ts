import { expect, test } from 'vitest';
import { Listeners, MemoryStore, readJson, writeJson } from './storage';

test('JSON round-trip; missing or corrupt values read as null', () => {
  const store = new MemoryStore();
  writeJson(store, 'k', { a: 1 });
  expect(readJson(store, 'k')).toEqual({ a: 1 });
  expect(readJson(store, 'missing')).toBeNull();
  store.setItem('bad', '{oops');
  expect(readJson(store, 'bad')).toBeNull();
});

test('a failing store does not throw', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  expect(() => writeJson(full, 'k', 1)).not.toThrow();
});

test('listeners are all notified', () => {
  const l = new Listeners();
  let n = 0;
  l.add(() => n++);
  l.add(() => n++);
  l.notify();
  expect(n).toBe(2);
});
