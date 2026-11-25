import { expect, test } from 'vitest';
import { niceAxis } from './chart';

test('the axis runs from 0 to just above the biggest value', () => {
  expect(niceAxis(21)).toEqual({ max: 25, step: 5, ticks: 5 });
  expect(niceAxis(13)).toEqual({ max: 15, step: 5, ticks: 3 });
  expect(niceAxis(7.4)).toEqual({ max: 8, step: 2, ticks: 4 });
  expect(niceAxis(40)).toEqual({ max: 40, step: 10, ticks: 4 });
  expect(niceAxis(3)).toEqual({ max: 3, step: 1, ticks: 3 });
  expect(niceAxis(0)).toEqual({ max: 1, step: 0.2, ticks: 5 });
});
