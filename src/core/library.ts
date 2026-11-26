import {
  cloneGrid,
  clonePiano,
  defaultClick,
  isClickPattern,
  isPatternGrid,
  patternSteps,
  sanitizePiano,
  type ClickPattern,
  type Pattern,
  type PianoNote,
} from './pattern';
import { clampSetting } from './settings';
import { Listeners, newId, readJson, writeJson, type KeyValueStore } from './storage';
import { isObj, isStr, objects } from './validate';

export interface Folder {
  id: string;
  name: string;
}

export interface SavedPattern {
  id: string;
  name: string;
  /** null = unfiled */
  folderId: string | null;
  bpm: number;
  grid: Pattern;
  /** drawn keyboard part (backing) */
  piano: PianoNote[];
}

export interface RoutineItem {
  patternId: string;
  bars: number;
  bpm: number;
  click: ClickPattern;
}

export interface Routine {
  id: string;
  name: string;
  items: RoutineItem[];
}

interface LibraryData {
  folders: Folder[];
  patterns: SavedPattern[];
  routines: Routine[];
}

const STORE_KEY = 'rhythm-trainer-library';
const DEFAULT_BPM = 90;
const DEFAULT_BARS = 4;

/** Builds library data from untrusted stored JSON, dropping anything malformed or dangling. */
export function sanitizeLibrary(raw: unknown): LibraryData {
  const r = isObj(raw) ? raw : {};
  const folders = objects(r.folders)
    .filter((f) => isStr(f.id) && isStr(f.name))
    .map((f) => ({ id: f.id as string, name: f.name as string }));
  const folderIds = new Set(folders.map((f) => f.id));

  const patterns = objects(r.patterns)
    .filter((p) => isStr(p.id) && isStr(p.name) && isPatternGrid(p.grid))
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      folderId: isStr(p.folderId) && folderIds.has(p.folderId) ? p.folderId : null,
      bpm: clampSetting('bpm', Number(p.bpm), DEFAULT_BPM),
      grid: p.grid as Pattern,
      piano: sanitizePiano(p.piano, patternSteps(p.grid as Pattern)),
    }));
  const patternIds = new Set(patterns.map((p) => p.id));

  const routines = objects(r.routines)
    .filter((x) => isStr(x.id) && isStr(x.name))
    .map((x) => ({
      id: x.id as string,
      name: x.name as string,
      items: objects(x.items)
        .filter((i) => isStr(i.patternId) && patternIds.has(i.patternId))
        .map((i) => ({
          patternId: i.patternId as string,
          bars: clampSetting('bars', Number(i.bars), DEFAULT_BARS),
          bpm: clampSetting('bpm', Number(i.bpm), DEFAULT_BPM),
          click: isClickPattern(i.click) ? i.click : defaultClick(),
        })),
    }));

  return { folders, patterns, routines };
}

/**
 * Saved patterns (in one level of folders) and routines. Every mutation saves
 * and notifies listeners.
 */
export class Library {
  private data: LibraryData;
  private readonly listeners = new Listeners();

  constructor(private readonly store: KeyValueStore) {
    this.data = sanitizeLibrary(readJson(store, STORE_KEY));
  }

  get folders(): readonly Folder[] {
    return this.data.folders;
  }

  get patterns(): readonly SavedPattern[] {
    return this.data.patterns;
  }

  get routines(): readonly Routine[] {
    return this.data.routines;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  pattern(id: string | null) {
    return this.data.patterns.find((p) => p.id === id);
  }

  routine(id: string | null) {
    return this.data.routines.find((r) => r.id === id);
  }

  routinesUsing(patternId: string) {
    return this.data.routines.filter((r) => r.items.some((i) => i.patternId === patternId));
  }

  // ---------- folders ----------

  addFolder(name: string): Folder {
    const f = { id: newId(), name };
    this.data.folders.push(f);
    this.commit();
    return f;
  }

  renameFolder(id: string, name: string) {
    this.edit(this.data.folders.find((f) => f.id === id), (f) => (f.name = name));
  }

  /** Its patterns become unfiled. */
  deleteFolder(id: string) {
    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    for (const p of this.data.patterns) if (p.folderId === id) p.folderId = null;
    this.commit();
  }

  // ---------- patterns ----------

  /** Creates, or overwrites when `id` is given. Stores copies of the grid and keyboard part. */
  savePattern(p: Omit<SavedPattern, 'id' | 'piano'> & { id?: string; piano?: PianoNote[] }): SavedPattern {
    const existing = this.pattern(p.id ?? null);
    const saved: SavedPattern = { ...p, id: existing?.id ?? newId(), grid: cloneGrid(p.grid), piano: clonePiano(p.piano ?? []) };
    if (existing) Object.assign(existing, saved);
    else this.data.patterns.push(saved);
    this.commit();
    return existing ?? saved;
  }

  renamePattern(id: string, name: string) {
    this.edit(this.pattern(id), (p) => (p.name = name));
  }

  movePattern(id: string, folderId: string | null) {
    this.edit(this.pattern(id), (p) => (p.folderId = folderId));
  }

  /** Also removes it from every routine. */
  deletePattern(id: string) {
    this.data.patterns = this.data.patterns.filter((p) => p.id !== id);
    for (const r of this.data.routines) r.items = r.items.filter((i) => i.patternId !== id);
    this.commit();
  }

  // ---------- routines ----------

  addRoutine(name: string): Routine {
    const r = { id: newId(), name, items: [] };
    this.data.routines.push(r);
    this.commit();
    return r;
  }

  renameRoutine(id: string, name: string) {
    this.edit(this.routine(id), (r) => (r.name = name));
  }

  deleteRoutine(id: string) {
    this.data.routines = this.data.routines.filter((r) => r.id !== id);
    this.commit();
  }

  addItem(routineId: string, patternId: string) {
    const p = this.pattern(patternId);
    if (!p) return;
    this.edit(this.routine(routineId), (r) => r.items.push({ patternId, bars: DEFAULT_BARS, bpm: p.bpm, click: defaultClick() }));
  }

  updateItem(routineId: string, index: number, changes: Partial<RoutineItem>) {
    this.edit(this.routine(routineId)?.items[index], (item) => Object.assign(item, changes));
  }

  moveItem(routineId: string, index: number, delta: number) {
    this.edit(this.routine(routineId), (r) => {
      const to = index + delta;
      if (to < 0 || to >= r.items.length) return;
      [r.items[index], r.items[to]] = [r.items[to], r.items[index]];
    });
  }

  removeItem(routineId: string, index: number) {
    this.edit(this.routine(routineId), (r) => r.items.splice(index, 1));
  }

  setAllBpm(routineId: string, bpm: number) {
    this.edit(this.routine(routineId), (r) => r.items.forEach((i) => (i.bpm = bpm)));
  }

  private edit<T>(target: T | undefined, fn: (t: T) => void) {
    if (!target) return;
    fn(target);
    this.commit();
  }

  private commit() {
    writeJson(this.store, STORE_KEY, this.data);
    this.listeners.notify();
  }
}
