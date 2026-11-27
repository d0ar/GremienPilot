/**
 * Shared highlight terms: API client and a small module-level store so that
 * every transcript view and the settings dialog see the same list.
 *
 * Kept separate from api.ts on purpose: several tests replace the whole api
 * module with a mock, and the transcript views must keep working there.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { compileHighlightTerms, type HighlightMatcher } from './textHighlight';

const API_BASE: string = import.meta.env.VITE_API_URL || '';
const ENDPOINT = `${API_BASE}/api/settings/highlight-terms`;
// Other workstations may change the list; refresh at most this often.
const REFRESH_AFTER_MS = 30_000;

export interface HighlightTermsSnapshot {
  terms: string[];
  revision: number;
}

export interface HighlightTermsState extends HighlightTermsSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export class HighlightTermsConflictError extends Error {
  current: HighlightTermsSnapshot;

  constructor(message: string, current: HighlightTermsSnapshot) {
    super(message);
    this.name = 'HighlightTermsConflictError';
    this.current = current;
  }
}

function parseSnapshot(data: unknown): HighlightTermsSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const { terms, revision } = data as Record<string, unknown>;
  if (!Array.isArray(terms) || typeof revision !== 'number') return null;
  return { terms: terms.filter((term): term is string => typeof term === 'string'), revision };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string') return body.detail;
    if (typeof body?.detail?.message === 'string') return body.detail.message;
    if (Array.isArray(body?.detail) && typeof body.detail[0]?.msg === 'string') {
      return `${fallback}: ${body.detail[0].msg}`;
    }
  } catch {
    // fall through
  }
  return fallback;
}

export async function fetchHighlightTerms(): Promise<HighlightTermsSnapshot> {
  const response = await fetch(ENDPOINT);
  if (!response?.ok) {
    throw new Error(
      response ? await errorMessage(response, 'Hervorhebungen konnten nicht geladen werden')
        : 'Hervorhebungen konnten nicht geladen werden',
    );
  }
  const snapshot = parseSnapshot(await response.json());
  if (!snapshot) throw new Error('Ungültige Antwort beim Laden der Hervorhebungen');
  return snapshot;
}

/** Save the list; throws HighlightTermsConflictError when `revision` is outdated. */
export async function saveHighlightTerms(
  terms: string[],
  revision: number,
): Promise<HighlightTermsSnapshot> {
  const response = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms, revision }),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    const current = parseSnapshot(body?.detail);
    if (current) {
      // The server's list is the truth for all transcript views meanwhile.
      publishHighlightTerms(current);
      throw new HighlightTermsConflictError(
        body?.detail?.message || 'Die Liste wurde zwischenzeitlich geändert.',
        current,
      );
    }
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Hervorhebungen konnten nicht gespeichert werden'));
  }
  const snapshot = parseSnapshot(await response.json());
  if (!snapshot) throw new Error('Ungültige Antwort beim Speichern der Hervorhebungen');
  publishHighlightTerms(snapshot);
  return snapshot;
}

/** Split the textarea content: one term per line. The server normalizes further. */
export function parseHighlightTermsInput(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// --- store -----------------------------------------------------------------

const INITIAL_STATE: HighlightTermsState = { terms: [], revision: 0, status: 'idle', error: null };
let state: HighlightTermsState = INITIAL_STATE;
let lastLoadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: HighlightTermsState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function publishHighlightTerms(snapshot: HighlightTermsSnapshot) {
  lastLoadedAt = Date.now();
  setState({ ...snapshot, status: 'ready', error: null });
}

/** Reload the list from the server; concurrent calls share one request. */
export function refreshHighlightTerms(): Promise<void> {
  if (inflight) return inflight;
  if (typeof fetch !== 'function') return Promise.resolve();
  setState({ ...state, status: state.status === 'ready' ? 'ready' : 'loading' });
  inflight = fetchHighlightTerms()
    .then(publishHighlightTerms)
    .catch((error: unknown) => {
      // Highlighting is optional: keep the last known list and stay quiet.
      lastLoadedAt = Date.now();
      setState({
        ...state,
        status: state.status === 'ready' ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function refreshIfStale() {
  if (state.status === 'idle' || Date.now() - lastLoadedAt > REFRESH_AFTER_MS) {
    void refreshHighlightTerms();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

/** Current shared list; loads it on first use and refreshes on window focus. */
export function useHighlightTerms(): HighlightTermsState {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    refreshIfStale();
    window.addEventListener('focus', refreshIfStale);
    return () => window.removeEventListener('focus', refreshIfStale);
  }, []);
  return current;
}

/** Compiled matcher for the shared list; stable while the list is unchanged. */
export function useHighlightMatcher(): HighlightMatcher {
  const { terms } = useHighlightTerms();
  return useMemo(() => compileHighlightTerms(terms), [terms]);
}

/** Test helper: forget the cached list. */
export function resetHighlightTermsStore() {
  state = INITIAL_STATE;
  lastLoadedAt = 0;
  inflight = null;
  listeners.forEach((listener) => listener());
}
