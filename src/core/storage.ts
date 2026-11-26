/*
 * Persistence and change notification shared by settings, the library and history.
 * Everything is stored as JSON in a key-value store: localStorage in the
 * browser, MemoryStore in tests or when localStorage is unavailable.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

/** localStorage if usable; otherwise data lasts for this visit only. */
export function browserStore(): KeyValueStore {
  try {
    localStorage.getItem('');
    return localStorage;
  } catch {
    return new MemoryStore();
  }
}

/** The parsed value under `key`, or null if missing or corrupt. Always sanitise the result. */
export function readJson(store: KeyValueStore, key: string): unknown {
  try {
    return JSON.parse(store.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage gone: keep working from memory */
  }
}

/** Change listeners for a model; views re-render when notified. */
export class Listeners {
  private readonly fns = new Set<() => void>();
  add(fn: () => void) {
    this.fns.add(fn);
  }
  notify() {
    this.fns.forEach((fn) => fn());
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
