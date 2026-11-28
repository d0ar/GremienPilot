import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishHighlightTerms, resetHighlightTermsStore } from '../highlightTerms';
import type { AssignmentStepProps, SummaryStepProps, TranscriptLine } from '../types';
import AssignmentStep from './AssignmentStep';
import SummaryStep from './SummaryStep';

vi.mock('../api', () => ({ exportProtocol: vi.fn() }));

const transcript: TranscriptLine[] = [
  { line_id: 'l0', speaker: 'SPEAKER_00', text: 'Willkommen zum Stadtrat', start: 0, end: 4 },
  { line_id: 'l1', speaker: 'SPEAKER_01', text: 'Der Haushalt wird beraten', start: 5, end: 9 },
  { line_id: 'l2', speaker: 'SPEAKER_00', text: 'Haushaltsdebatte beendet', start: 10, end: 14 },
];
const speakerNames = { SPEAKER_00: 'Frau Vorsitzende', SPEAKER_01: 'Herr Kämmerer' };

const assignmentProps: AssignmentStepProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  tops: ['Begrüßung', 'Haushalt'],
  setTops: vi.fn(),
  transcript,
  setTranscript: vi.fn(),
  assignments: [0, 1, 1],
  setAssignments: vi.fn(),
  speakerNames,
  setSpeakerNames: vi.fn(),
};

const summaryProps: SummaryStepProps = {
  onBack: vi.fn(),
  tops: ['Begrüßung', 'Haushalt'],
  transcript,
  assignments: [0, 1, 1],
  summaries: { 0: 'Begrüßung durch den Stadtrat.', 1: 'Der Haushalt wurde beraten.' },
  setSummaries: vi.fn(),
  onRegenerateSummary: vi.fn().mockResolvedValue(undefined),
  onAcceptSummary: vi.fn().mockResolvedValue(undefined),
  isGenerating: false,
  summariesAreFresh: true,
  speakerNames,
  exportMetadata: {
    committee: 'Hauptausschuss', date: '2026-06-30', location: 'Rathaus', title: 'Sitzung',
    participants: [], includeSpeakerList: true, includeTranscript: false,
    groupTranscriptByTop: false, includeGenerationNote: true,
  },
  setExportMetadata: vi.fn(),
};

const boldTerms = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-highlight-term]')).map((element) => element.textContent);

beforeEach(() => {
  resetHighlightTermsStore();
  // Highlight terms are published directly; no request should be needed.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  act(() => publishHighlightTerms({ terms: ['Haushalt*', '*rat'], revision: 1 }));
});

afterEach(() => vi.unstubAllGlobals());

describe('assignment page transcript', () => {
  it('shows highlight terms in bold and search hits without hiding lines', async () => {
    const user = userEvent.setup();
    render(<AssignmentStep {...assignmentProps} />);
    const region = screen.getByRole('region', { name: 'Transkript' });

    expect(boldTerms(region)).toEqual(['Stadtrat', 'Haushalt', 'Haushaltsdebatte']);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'haus');
    expect(screen.getByTestId('transcript-search-status')).toHaveTextContent('1 / 2');
    const current = region.querySelector('mark[data-search-hit="current"]');
    // Search background and bold term overlap on the same text.
    expect(current).toHaveTextContent('Haus');
    expect(current?.querySelector('[data-highlight-term]')).not.toBeNull();
    expect(within(region).getAllByRole('button', { name: /^Zeile \d zuordnen$/ })).toHaveLength(3);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('transcript-search-status')).toHaveTextContent('2 / 2');
    expect(region.querySelector('mark[data-search-hit="current"]')?.closest('[id]')?.id).toBe(
      'assignment-original-2',
    );
  });

  it('finds speaker display names and keeps line assignment working', async () => {
    const user = userEvent.setup();
    const setAssignments = vi.fn();
    render(<AssignmentStep {...assignmentProps} setAssignments={setAssignments} />);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'kämmerer');
    expect(screen.getByTestId('transcript-search-status')).toHaveTextContent('1 / 1');

    await user.click(screen.getByRole('button', { name: 'Zeile 1 zuordnen' }));
    expect(setAssignments).toHaveBeenCalled();
  });

  it('keeps line editing unaffected by highlighting', async () => {
    const user = userEvent.setup();
    const setTranscript = vi.fn();
    render(<AssignmentStep {...assignmentProps} setTranscript={setTranscript} />);
    await user.type(screen.getByLabelText('Im Transkript suchen'), 'Haushalt');

    await user.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[1]!);
    const editor = screen.getByLabelText('Transkriptzeile 2 korrigieren');
    expect(editor).toHaveValue('Der Haushalt wird beraten');
    fireEvent.change(editor, { target: { value: 'Der Haushalt 2027 wird beraten' } });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(setTranscript).toHaveBeenCalled();
    expect(setTranscript.mock.calls[0]![0][1].text).toBe('Der Haushalt 2027 wird beraten');
  });

  it('does not intercept Ctrl+F', () => {
    render(<AssignmentStep {...assignmentProps} />);
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('protocol page transcript', () => {
  it('highlights terms only in the transcript, not in the summary', async () => {
    const user = userEvent.setup();
    render(<SummaryStep {...summaryProps} />);
    await user.click(screen.getByRole('button', { name: 'Haushalt' }));

    const region = screen.getByRole('region', { name: 'Originaltranskript' });
    expect(boldTerms(region)).toEqual(['Haushalt', 'Haushaltsdebatte']);
    expect(boldTerms(screen.getByRole('region', { name: 'Zusammenfassung' }))).toEqual([]);

    await user.type(screen.getByLabelText('Im Transkript suchen'), 'beraten');
    expect(screen.getByTestId('transcript-search-status')).toHaveTextContent('1 / 1');
    expect(region.querySelector('mark[data-search-hit="current"]')).toHaveTextContent('beraten');
    await user.keyboard('{Escape}');
    expect(region.querySelector('mark')).toBeNull();
  });
});
