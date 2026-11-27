import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findSearchRanges, type SearchRange, type TextRange } from '../textHighlight';

export interface SearchableLine {
  /** Speaker display name as shown in the transcript. */
  speaker: string;
  text: string;
}

export type SearchField = 'speaker' | 'text';

export interface TranscriptSearchHit extends TextRange {
  lineIndex: number;
  field: SearchField;
}

export interface TranscriptSearch {
  query: string;
  setQuery: (query: string) => void;
  hits: TranscriptSearchHit[];
  /** Index into `hits`, or -1 when there is no hit. */
  currentIndex: number;
  next: () => void;
  previous: () => void;
  clear: () => void;
  /** Search ranges of one line field, with the current hit flagged. */
  rangesFor: (lineIndex: number, field: SearchField) => SearchRange[];
}

/** All hits in document order: per line the speaker name first, then the text. */
export function findTranscriptHits(
  lines: readonly SearchableLine[],
  query: string,
): TranscriptSearchHit[] {
  if (!query.trim()) return [];
  const hits: TranscriptSearchHit[] = [];
  lines.forEach((line, lineIndex) => {
    for (const field of ['speaker', 'text'] as const) {
      for (const range of findSearchRanges(line[field], query)) {
        hits.push({ ...range, lineIndex, field });
      }
    }
  });
  return hits;
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}

/**
 * Center `element` inside its own scroll container without moving the page.
 * Falls back to scrollIntoView when the container does not scroll itself
 * (stacked layout on narrow screens).
 */
export function scrollLineIntoView(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const container = findScrollContainer(element);
  if (!container) {
    element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return;
  }
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  const top =
    container.scrollTop +
    (elementBox.top - containerBox.top) -
    (container.clientHeight - elementBox.height) / 2;
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  } else {
    container.scrollTop = Math.max(0, top);
  }
}

const EMPTY_RANGES: SearchRange[] = [];

/**
 * Search state for a transcript. The transcript itself stays fully visible;
 * the caller renders hits via `rangesFor` and scrolls via `scrollToLine`.
 */
export function useTranscriptSearch(
  lines: readonly SearchableLine[],
  scrollToLine?: (lineIndex: number) => void,
): TranscriptSearch {
  const [query, setQueryState] = useState('');
  const [cursor, setCursor] = useState(0);
  // Incremented on every explicit navigation so the effect scrolls once.
  const [jumpRequest, setJumpRequest] = useState(0);
  const handledJump = useRef(0);
  const scrollRef = useRef(scrollToLine);

  useEffect(() => {
    scrollRef.current = scrollToLine;
  });

  const hits = useMemo(() => findTranscriptHits(lines, query), [lines, query]);
  // Edits may shrink the hit list; clamp instead of resetting the position.
  const currentIndex = hits.length > 0 ? Math.min(cursor, hits.length - 1) : -1;
  const currentLine = currentIndex >= 0 ? hits[currentIndex]!.lineIndex : -1;

  const rangesByLine = useMemo(() => {
    const map = new Map<string, SearchRange[]>();
    hits.forEach((hit, index) => {
      const key = `${hit.lineIndex}:${hit.field}`;
      const ranges = map.get(key) ?? [];
      ranges.push({ start: hit.start, end: hit.end, current: index === currentIndex });
      map.set(key, ranges);
    });
    return map;
  }, [hits, currentIndex]);

  useEffect(() => {
    if (jumpRequest === handledJump.current) return;
    handledJump.current = jumpRequest;
    if (currentLine >= 0) scrollRef.current?.(currentLine);
  }, [jumpRequest, currentLine]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setCursor(0);
    setJumpRequest((request) => request + 1);
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const from = currentIndex < 0 ? 0 : currentIndex;
      setCursor((from + delta + hits.length) % hits.length);
      setJumpRequest((request) => request + 1);
    },
    [currentIndex, hits.length],
  );
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const clear = useCallback(() => {
    setQueryState('');
    setCursor(0);
  }, []);

  const rangesFor = useCallback(
    (lineIndex: number, field: SearchField) =>
      rangesByLine.get(`${lineIndex}:${field}`) ?? EMPTY_RANGES,
    [rangesByLine],
  );

  return { query, setQuery, hits, currentIndex, next, previous, clear, rangesFor };
}
