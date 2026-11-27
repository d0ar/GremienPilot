import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { checkBackendHealth, loadSession, pollSummaryJob, reextractSessionPDF, saveSession } from './api';
import { agendaSource } from './agendaProposals';
import type { AgendaDetectionResponse, PdfAgendaExtractionResult, SessionResponse, TranscriptLine } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  checkBackendHealth: vi.fn(), loadSession: vi.fn(), saveSession: vi.fn(), detectAgenda: vi.fn(),
  reextractSessionPDF: vi.fn(), pollModelJob: vi.fn(), pollSummaryJob: vi.fn(),
  listSpeakerProfiles: vi.fn(async () => []),
}));

const tops = ['Haushalt', 'Schulbau'];
const topIds = ['top-a', 'top-b'];
const transcript: TranscriptLine[] = [
  { line_id: 'line-a', speaker: 'S1', text: 'TOP 1 Haushalt.', start: 0, end: 2 },
  { line_id: 'line-b', speaker: 'S2', text: 'TOP 2 Schulbau.', start: 2, end: 4 },
];

function detection(): AgendaDetectionResponse {
  return {
    tops, transcript, assignments: [0, 1], strategy: 'test', uncertain_count: 0,
    segments: [0, 1].map((index) => ({
      top_index: index, top_title: tops[index]!, start_index: index, end_index: index,
      confidence: 0.9, uncertain: false, transition_type: 'explicit', reason: 'Aufruf',
    })),
  };
}

const extractedPdf: PdfAgendaExtractionResult = {
  tops: ['Schulbau', 'Neuer TOP'], metadata: {}, processing_complete: true,
  processing_mode: 'fast', review_status: 'skipped', review_required: true,
  document: { job_id: 'pdf-new', sha256: 'pdf-hash', page_count: 2 },
};

let stored: SessionResponse;
const draft = () => JSON.parse(localStorage.getItem('active-session-draft')!) as SessionResponse;
// Everything the undo history is responsible for.
const editorState = () => {
  const { tops, top_ids, assignments, summaries, summary_reviews, summary_states } = draft();
  return { tops, top_ids, assignments, summaries, summary_reviews, summary_states };
};
const agenda = () => screen.getByRole('region', { name: 'Tagesordnung' });
// The main button, not the one in the notice after deleting a TOP.
const undoButton = () => screen.getAllByRole('button', { name: /^Rückgängig/ })
  .find((button) => !button.closest('[role="status"]'))!;

async function openSession() {
  render(<App />);
  await screen.findByRole('button', { name: 'Alle übernehmen' });
  await waitFor(() => expect(localStorage.getItem('active-session-draft')).not.toBeNull());
  return editorState();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/sessions/session-1');
  stored = {
    session_id: 'session-1', revision: 1, current_step: 2, tops, top_ids: topIds, transcript,
    assignments: [0, null], speaker_names: { S1: 'Anna', S2: 'Ben' },
    summaries: { 0: 'Haushaltstext', 1: 'Schulbautext' },
    summary_reviews: { 1: { review_warnings: [], source_links: [{
      section: 'discussion', item_index: 0, item_text: 'Schulbau beraten', line_indices: [1], excerpt: 'TOP 2 Schulbau.',
      confidence: 1, missing_source: false,
    }] } },
    summary_states: {
      0: { top_id: 'top-a', status: 'ready', origin: 'pipeline',
        source_snapshot: [{ line_id: 'line-a', speaker: 'S1', text: 'TOP 1 Haushalt.' }] },
      1: { top_id: 'top-b', status: 'ready', origin: 'pipeline', generated_at: 1234, source_snapshot: [] },
    },
    skipped_assignment: false,
    agenda_proposals: { version: 1, source: agendaSource(tops, topIds, transcript), result: detection() },
  };
  vi.mocked(checkBackendHealth).mockResolvedValue(true);
  vi.mocked(loadSession).mockImplementation(async () => structuredClone(stored));
  vi.mocked(saveSession).mockImplementation(async (payload) => {
    stored = { ...structuredClone(payload), session_id: payload.session_id!, revision: stored.revision! + 1 };
    return structuredClone(stored);
  });
});

describe('shared undo history on the assignment page', () => {
  const select = (user: ReturnType<typeof userEvent.setup>, title: string) =>
    user.click(within(agenda()).getByRole('button', { name: new RegExp(title) }));

  it.each([
    ['line assignment', async () => {
      await userEvent.click(screen.getByText('TOP 1 Haushalt.'));
    }],
    ['adopting all suggestions', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Alle übernehmen' }));
    }],
    ['adopting one suggestion', async () => {
      await userEvent.click(screen.getAllByRole('button', { name: 'Übernehmen' })[1]!);
    }],
    ['renaming', async () => {
      const user = userEvent.setup();
      await user.clear(screen.getByLabelText(/ausgewählter top/i));
      await user.type(screen.getByLabelText(/ausgewählter top/i), 'Finanzen');
      await user.click(screen.getByRole('button', { name: 'TOP umbenennen' }));
    }],
    ['adding', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'TOP hinzufügen' }));
    }],
    ['deleting', async () => {
      const user = userEvent.setup();
      await select(user, 'Schulbau');
      await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    }],
    ['merging', async () => {
      const user = userEvent.setup();
      await select(user, 'Schulbau');
      await user.click(screen.getByRole('button', { name: 'TOP zusammenlegen' }));
    }],
    ['moving', async () => {
      const user = userEvent.setup();
      await select(user, 'Schulbau');
      await user.click(screen.getByRole('button', { name: 'TOP nach oben verschieben' }));
    }],
  ])('undoes %s exactly', async (_name, action) => {
    const initial = await openSession();
    await action();
    await waitFor(() => expect(editorState()).not.toEqual(initial));
    expect(undoButton()).toHaveTextContent('Rückgängig (1)');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(editorState()).toEqual(initial));
    expect(undoButton()).toBeDisabled();
  });

  it('restores a deleted TOP with its summary, review and state from the notice', async () => {
    const user = userEvent.setup();
    const initial = await openSession();
    await select(user, 'Schulbau');
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    expect(draft().tops).toEqual(['Haushalt']);
    expect(draft().summaries).toEqual({ 0: 'Haushaltstext' });
    expect(Object.values(draft().summary_states!).map((state) => state.top_id)).toEqual(['top-a']);
    await waitFor(() => expect(stored.summaries).toEqual({ 0: 'Haushaltstext' }));

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('TOP ‚Schulbau‘ gelöscht – Rückgängig');
    await user.click(within(notice).getByRole('button', { name: 'Rückgängig' }));

    expect(editorState()).toEqual(initial);
    expect(draft().summaries![1]).toBe('Schulbautext');
    expect(draft().summary_reviews![1]!.source_links).toHaveLength(1);
    expect(draft().summary_states![1]).toMatchObject({ top_id: 'top-b', status: 'ready', generated_at: 1234 });
    expect(within(agenda()).getByRole('button', { name: /Schulbau/ })).toHaveAttribute('aria-current', 'true');
    // The restored state is saved again.
    await waitFor(() => expect(stored.summaries).toEqual({ 0: 'Haushaltstext', 1: 'Schulbautext' }));
  });

  it('undoes several changes in reverse order', async () => {
    const user = userEvent.setup();
    const initial = await openSession();
    await select(user, 'Schulbau');
    await user.click(screen.getByRole('button', { name: 'TOP nach oben verschieben' }));
    const moved = editorState();
    expect(moved.tops).toEqual(['Schulbau', 'Haushalt']);
    expect(moved.assignments).toEqual([1, null]);
    expect(moved.summaries).toEqual({ 0: 'Schulbautext', 1: 'Haushaltstext' });
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    expect(draft().tops).toEqual(['Haushalt']);

    await user.click(undoButton());
    expect(editorState()).toEqual(moved);
    await user.click(undoButton());
    expect(editorState()).toEqual(initial);
  });

  it('keeps the history when switching to the protocol step and back', async () => {
    const user = userEvent.setup();
    const initial = await openSession();
    await select(user, 'Schulbau');
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));

    await user.click(screen.getByRole('button', { name: /zum protokollentwurf/i }));
    await user.click(await screen.findByRole('button', { name: /zurück zur zuordnung/i }));
    await user.click(screen.getByRole('button', { name: 'Rückgängig (1)' }));

    expect(editorState()).toEqual(initial);
  });

  it('undoes adopting a PDF agenda and offers the candidate again', async () => {
    stored.has_pdf_source = true;
    stored.processing_mode = 'fast';
    vi.mocked(reextractSessionPDF).mockResolvedValue(extractedPdf);
    const user = userEvent.setup();
    const initial = await openSession();
    const proposals = draft().agenda_proposals;

    await user.click(screen.getByRole('button', { name: 'TOPs aus PDF neu extrahieren' }));
    await user.click(await screen.findByRole('button', { name: 'TOP-Liste übernehmen' }));
    expect(draft().tops).toEqual(['Schulbau', 'Neuer TOP']);
    expect(draft().summaries).toEqual({ 0: 'Schulbautext' });
    expect(draft().pdf_source_job_id).toBe('pdf-new');
    expect(draft().agenda_proposals).toBeNull();

    await user.click(undoButton());

    expect(editorState()).toEqual(initial);
    expect(draft().pdf_source_job_id).toBeNull();
    expect(draft().agenda_proposals).toEqual(proposals);
    expect(screen.getByRole('button', { name: 'TOP-Liste übernehmen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Alle übernehmen' })).toBeEnabled();
  });

  it('locks undo while a summary job is running', async () => {
    stored.latest_summary_job = {
      summary_job_id: 'summary-1', session_id: 'session-1', status: 'processing',
      progress: 10, current_top: 0, total_tops: 1, top_ids: ['top-a'],
    };
    vi.mocked(pollSummaryJob).mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Alle übernehmen' });
    const firstLine = screen.getByRole('button', { name: 'Zeile 1 zuordnen' });
    expect(firstLine).toHaveAttribute('aria-pressed', 'true');

    await user.click(firstLine);
    expect(firstLine).toHaveAttribute('aria-pressed', 'false');
    expect(undoButton()).toBeDisabled();
    expect(screen.getByText('Rückgängig ist gesperrt, solange Zusammenfassungen erzeugt werden.')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(firstLine).toHaveAttribute('aria-pressed', 'false');
  });

  it('forgets the history when another session is opened', async () => {
    const user = userEvent.setup();
    await openSession();
    await user.click(screen.getByText('TOP 1 Haushalt.'));
    expect(undoButton()).toBeEnabled();

    stored = { ...structuredClone(stored), session_id: 'session-2' };
    act(() => {
      window.history.pushState(null, '', '/sessions/session-2');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(loadSession).toHaveBeenCalledWith('session-2'));
    await screen.findByRole('button', { name: 'Alle übernehmen' });
    expect(undoButton()).toBeDisabled();
  });
});
