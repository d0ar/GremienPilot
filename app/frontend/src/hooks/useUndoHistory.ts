import { useCallback, useMemo, useRef, useState } from 'react';

export interface UndoEntry<T> {
  id: number;
  label: string;
  snapshot: T;
  scope: string;
}

export interface UndoHistory<T> {
  /** Entries that still fit the current scope, oldest first. */
  entries: UndoEntry<T>[];
  last: UndoEntry<T> | null;
  /** Remembers the state before a change; returns the new entry's id. */
  push: (snapshot: T, label: string) => number;
  /** Removes and returns the newest entry, or null if there is none. */
  pop: () => UndoEntry<T> | null;
  clear: () => void;
}

/**
 * An in-memory undo stack of full snapshots. Nothing is persisted, so the
 * history is gone after a reload.
 *
 * `scope` describes what the snapshots depend on but do not contain (e.g. the
 * transcript line structure). Entries recorded under another scope are hidden
 * and dropped with the next change.
 */
export function useUndoHistory<T>(scope: string, maxEntries: number): UndoHistory<T> {
  const [allEntries, setAllEntries] = useState<UndoEntry<T>[]>([]);
  const nextIdRef = useRef(1);
  const entries = useMemo(
    () => allEntries.filter((entry) => entry.scope === scope),
    [allEntries, scope],
  );
  const last = entries[entries.length - 1] ?? null;

  const push = useCallback((snapshot: T, label: string) => {
    const id = nextIdRef.current++;
    setAllEntries((current) => [
      ...current.filter((entry) => entry.scope === scope),
      { id, label, snapshot, scope },
    ].slice(-maxEntries));
    return id;
  }, [maxEntries, scope]);

  const pop = useCallback(() => {
    if (!last) return null;
    setAllEntries((current) =>
      current.filter((entry) => entry.scope === scope && entry.id !== last.id));
    return last;
  }, [last, scope]);

  const clear = useCallback(() => setAllEntries([]), []);

  return { entries, last, push, pop, clear };
}
