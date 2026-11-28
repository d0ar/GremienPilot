/**
 * Matching and segmentation for transcript highlighting.
 *
 * Two independent range sets are merged into one segmentation: search hits
 * (rendered with a background) and highlight terms (rendered bold). Ranges may
 * overlap freely; every segment carries the flags of all ranges covering it.
 */

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchRange extends TextRange {
  current?: boolean;
}

export interface TextSegment extends TextRange {
  text: string;
  bold: boolean;
  search: boolean;
  current: boolean;
}

// Letters (incl. umlauts/ß), combining marks, digits and underscore form a word.
// `\b` is ASCII-only in JavaScript and would treat "ü" as a word boundary.
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
const NOT_AFTER_WORD = `(?<!${WORD_CHAR})`;
const NOT_BEFORE_WORD = `(?!${WORD_CHAR})`;

export function escapeRegExp(value: string): string {
  // Only syntax characters: other identity escapes (e.g. `\-`) are invalid with the `u` flag.
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleWhitespace(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map(escapeRegExp)
    .join('\\s+');
}

/**
 * Build the regular expression for one highlight term.
 *
 * - `Rat`   whole word
 * - `Rat*`  words starting with "Rat"
 * - `*rat`  words ending with "rat"
 * - `*rat*` words containing "rat"
 *
 * With a wildcard the whole word is matched, so the complete word is shown bold.
 * Multi-word terms match any whitespace between the words.
 */
export function compileHighlightTerm(term: string): RegExp | null {
  const trimmed = term.trim();
  const openStart = trimmed.startsWith('*');
  const openEnd = trimmed.endsWith('*');
  const core = trimmed.replace(/^\*+/u, '').replace(/\*+$/u, '').trim();
  if (!core) return null;
  const pattern =
    NOT_AFTER_WORD +
    (openStart ? `${WORD_CHAR}*` : '') +
    flexibleWhitespace(core) +
    (openEnd ? `${WORD_CHAR}*` : '') +
    NOT_BEFORE_WORD;
  return new RegExp(pattern, 'giu');
}

function collectMatches(pattern: RegExp, text: string, into: TextRange[]): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length > 0 && match.index !== undefined) {
      into.push({ start: match.index, end: match.index + match[0].length });
    }
  }
}

/** Sort ranges and merge overlapping or touching ones. */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export interface HighlightMatcher {
  readonly terms: readonly string[];
  readonly isEmpty: boolean;
  /** Merged ranges of all term matches in `text`. */
  find(text: string): TextRange[];
}

const MAX_CACHED_TEXTS = 5000;

export function compileHighlightTerms(terms: readonly string[]): HighlightMatcher {
  const patterns = terms
    .map(compileHighlightTerm)
    .filter((pattern): pattern is RegExp => pattern !== null);
  // Transcripts re-render often (every click assigns lines); cache per text.
  const cache = new Map<string, TextRange[]>();
  return {
    terms,
    isEmpty: patterns.length === 0,
    find(text: string) {
      if (patterns.length === 0 || !text) return [];
      const cached = cache.get(text);
      if (cached) return cached;
      const ranges: TextRange[] = [];
      for (const pattern of patterns) collectMatches(pattern, text, ranges);
      const merged = mergeRanges(ranges);
      if (cache.size >= MAX_CACHED_TEXTS) cache.clear();
      cache.set(text, merged);
      return merged;
    },
  };
}

export const EMPTY_MATCHER: HighlightMatcher = compileHighlightTerms([]);

/** Case-insensitive substring search; whitespace in the query matches any whitespace. */
export function findSearchRanges(text: string, query: string): TextRange[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];
  const ranges: TextRange[] = [];
  collectMatches(new RegExp(flexibleWhitespace(trimmed), 'giu'), text, ranges);
  return ranges;
}

/**
 * Split `text` into segments so that each segment is uniformly bold or not,
 * inside a search hit or not, and inside the current search hit or not.
 */
export function segmentText(
  text: string,
  boldRanges: readonly TextRange[] = [],
  searchRanges: readonly SearchRange[] = [],
): TextSegment[] {
  const length = text.length;
  const clip = (range: TextRange) => ({
    start: Math.max(0, Math.min(length, range.start)),
    end: Math.max(0, Math.min(length, range.end)),
  });
  const bold = boldRanges.map(clip).filter((range) => range.end > range.start);
  const search = searchRanges
    .map((range) => ({ ...clip(range), current: Boolean(range.current) }))
    .filter((range) => range.end > range.start);

  const boundaries = new Set<number>([0, length]);
  for (const range of [...bold, ...search]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: TextSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (end <= start) continue;
    const covers = (range: TextRange) => range.start <= start && range.end >= end;
    const isBold = bold.some(covers);
    const hits = search.filter(covers);
    const segment: TextSegment = {
      start,
      end,
      text: text.slice(start, end),
      bold: isBold,
      search: hits.length > 0,
      current: hits.some((hit) => hit.current),
    };
    const previous = segments[segments.length - 1];
    if (
      previous &&
      previous.bold === segment.bold &&
      previous.search === segment.search &&
      previous.current === segment.current
    ) {
      previous.end = end;
      previous.text += segment.text;
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) {
    segments.push({ start: 0, end: 0, text: '', bold: false, search: false, current: false });
  }
  return segments;
}
