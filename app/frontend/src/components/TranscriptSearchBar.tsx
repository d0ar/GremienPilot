import type { KeyboardEvent } from 'react';
import type { TranscriptSearch } from '../hooks/useTranscriptSearch';

interface TranscriptSearchBarProps {
  search: TranscriptSearch;
  className?: string;
}

/**
 * Search field with hit counter and navigation for a transcript.
 * Enter = next hit, Shift+Enter = previous hit, Esc = clear.
 * Ctrl+F is deliberately left to the browser.
 */
export default function TranscriptSearchBar({ search, className = '' }: TranscriptSearchBarProps) {
  const { query, hits, currentIndex } = search;
  const hasHits = hits.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) search.previous();
      else search.next();
    } else if (event.key === 'Escape') {
      if (!query) return;
      event.preventDefault();
      event.stopPropagation();
      search.clear();
    }
  };

  let status = '';
  if (query.trim()) status = hasHits ? `${currentIndex + 1} / ${hits.length}` : 'Keine Treffer';

  return (
    <div role="search" className={`flex min-w-0 items-center gap-1 ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Im Transkript suchen"
        aria-label="Im Transkript suchen"
        className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <span
        aria-live="polite"
        data-testid="transcript-search-status"
        className="min-w-[4.5rem] text-center text-xs tabular-nums text-gray-600"
      >
        {status}
      </span>
      <button
        type="button"
        onClick={search.previous}
        disabled={!hasHits}
        aria-label="Vorheriger Treffer"
        title="Vorheriger Treffer (Umschalt+Enter)"
        className="rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-40"
      >
        ▲
      </button>
      <button
        type="button"
        onClick={search.next}
        disabled={!hasHits}
        aria-label="Nächster Treffer"
        title="Nächster Treffer (Enter)"
        className="rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-40"
      >
        ▼
      </button>
    </div>
  );
}
