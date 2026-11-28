import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import HighlightedText from '../components/HighlightedText';
import TranscriptSearchBar from '../components/TranscriptSearchBar';
import { findTranscriptHits, useTranscriptSearch, type SearchableLine } from './useTranscriptSearch';

const lines: SearchableLine[] = [
  { speaker: 'Frau Haus', text: 'Der Haushalt wird eingebracht.' },
  { speaker: 'Herr Meier', text: 'Zum Haushalt habe ich Fragen.' },
  { speaker: 'Frau Haus', text: 'Bitte.' },
];

function Harness({ onScroll }: { onScroll?: (lineIndex: number) => void }) {
  const stableLines = useMemo(() => lines, []);
  const search = useTranscriptSearch(stableLines, onScroll);
  return (
    <div>
      <TranscriptSearchBar search={search} />
      {stableLines.map((line, index) => (
        <p key={index} data-testid={`line-${index}`}>
          <HighlightedText text={line.speaker} searchRanges={search.rangesFor(index, 'speaker')} />:{' '}
          <HighlightedText text={line.text} searchRanges={search.rangesFor(index, 'text')} />
        </p>
      ))}
    </div>
  );
}

const status = () => screen.getByTestId('transcript-search-status');
const currentHit = () => document.querySelector('mark[data-search-hit="current"]');

describe('findTranscriptHits', () => {
  it('lists hits in document order, speaker name before line text', () => {
    expect(findTranscriptHits(lines, 'haus').map((hit) => [hit.lineIndex, hit.field])).toEqual([
      [0, 'speaker'],
      [0, 'text'],
      [1, 'text'],
      [2, 'speaker'],
    ]);
    expect(findTranscriptHits(lines, ' ')).toEqual([]);
  });
});

describe('transcript search', () => {
  it('marks all hits, counts them and navigates with Enter and Shift+Enter with wraparound', async () => {
    const user = userEvent.setup();
    const onScroll = vi.fn();
    render(<Harness onScroll={onScroll} />);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'haushalt');

    expect(status()).toHaveTextContent('1 / 2');
    expect(document.querySelectorAll('mark[data-search-hit]')).toHaveLength(2);
    expect(currentHit()?.closest('p')).toBe(screen.getByTestId('line-0'));
    // The full transcript stays visible.
    expect(screen.getByTestId('line-2')).toHaveTextContent('Bitte.');
    expect(onScroll).toHaveBeenLastCalledWith(0);

    await user.keyboard('{Enter}');
    expect(status()).toHaveTextContent('2 / 2');
    expect(currentHit()?.closest('p')).toBe(screen.getByTestId('line-1'));
    expect(onScroll).toHaveBeenLastCalledWith(1);

    await user.keyboard('{Enter}');
    expect(status()).toHaveTextContent('1 / 2');
    expect(onScroll).toHaveBeenLastCalledWith(0);

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(status()).toHaveTextContent('2 / 2');

    await user.click(screen.getByRole('button', { name: 'Vorheriger Treffer' }));
    expect(status()).toHaveTextContent('1 / 2');
    await user.click(screen.getByRole('button', { name: 'Vorheriger Treffer' }));
    expect(status()).toHaveTextContent('2 / 2');
    await user.click(screen.getByRole('button', { name: 'Nächster Treffer' }));
    expect(status()).toHaveTextContent('1 / 2');
  });

  it('searches the speaker display name case-insensitively', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'MEIER');

    expect(status()).toHaveTextContent('1 / 1');
    expect(currentHit()).toHaveTextContent('Meier');
  });

  it('clears the search with Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Im Transkript suchen');

    await user.type(input, 'haus');
    expect(status()).toHaveTextContent('1 / 4');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('');
    expect(status()).toHaveTextContent('');
    expect(document.querySelector('mark')).toBeNull();
  });

  it('reports missing hits and disables navigation', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'Kita');

    expect(status()).toHaveTextContent('Keine Treffer');
    expect(screen.getByRole('button', { name: 'Nächster Treffer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vorheriger Treffer' })).toBeDisabled();
  });

  it('keeps the position within bounds when the transcript shrinks', () => {
    const { result, rerender } = renderHook(({ items }) => useTranscriptSearch(items), {
      initialProps: { items: lines },
    });
    act(() => result.current.setQuery('haus'));
    act(() => result.current.previous());
    expect(result.current.currentIndex).toBe(3);

    rerender({ items: lines.slice(0, 1) });

    expect(result.current.hits).toHaveLength(2);
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.rangesFor(0, 'text')).toEqual([{ start: 4, end: 8, current: true }]);
  });
});
