/* Type guards for sanitising untrusted stored JSON. */

export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export const isStr = (x: unknown): x is string => typeof x === 'string';
export const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
export const isInt = (x: unknown, min: number, max: number): x is number =>
  Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

/** The objects in `x` if it's an array, else none. */
export const objects = (x: unknown) => (Array.isArray(x) ? x.filter(isObj) : []);

export const isArrayOf = <T>(x: unknown, len: number, ok: (v: unknown) => boolean): x is T[] =>
  Array.isArray(x) && x.length === len && x.every(ok);
