import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHighlightTermsStore } from '../highlightTerms';
import HighlightTermsEditor from './HighlightTermsEditor';
import LLMSettingsPanel, { DEFAULT_LLM_SETTINGS } from './LLMSettingsPanel';

const URL = '/api/settings/highlight-terms';

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

/** Minimal fake server: GET returns the stored list, PUT checks the revision. */
function fakeServer(initial: { terms: string[]; revision: number }) {
  const server = { ...initial };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== URL) return json(200, []);
    if (!init?.method || init.method === 'GET') return json(200, { ...server });
    const body = JSON.parse(String(init.body));
    if (body.revision !== server.revision) {
      return json(409, { detail: { message: 'Die Liste wurde zwischenzeitlich geändert.', ...server } });
    }
    server.terms = body.terms;
    server.revision += 1;
    return json(200, { ...server });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { server, fetchMock };
}

const textarea = () => screen.getByLabelText('Begriffe (einer pro Zeile)');

describe('HighlightTermsEditor', () => {
  beforeEach(() => resetHighlightTermsStore());
  afterEach(() => vi.unstubAllGlobals());

  it('loads the shared list and saves one term per line with the known revision', async () => {
    const user = userEvent.setup();
    const { fetchMock, server } = fakeServer({ terms: ['Haushalt'], revision: 3 });
    render(<HighlightTermsEditor />);

    await waitFor(() => expect(textarea()).toHaveValue('Haushalt'));
    expect(screen.getByText('Gilt für alle Arbeitsplätze.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hervorhebungen speichern' })).toBeDisabled();

    await user.type(textarea(), '{Enter}{Enter}  Rat* {Enter}Kita');
    await user.click(screen.getByRole('button', { name: 'Hervorhebungen speichern' }));

    expect(await screen.findByText('3 Begriffe gespeichert.')).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ terms: ['Haushalt', 'Rat*', 'Kita'], revision: 3 });
    expect(server.revision).toBe(4);
    expect(textarea()).toHaveValue('Haushalt\nRat*\nKita');
  });

  it('warns about a concurrent change and overwrites only after confirmation', async () => {
    const user = userEvent.setup();
    const { server } = fakeServer({ terms: ['Haushalt'], revision: 1 });
    render(<HighlightTermsEditor />);
    await waitFor(() => expect(textarea()).toHaveValue('Haushalt'));

    // Another workstation saves in the meantime.
    server.terms = ['Haushalt', 'Feuerwehr'];
    server.revision = 2;

    await user.type(textarea(), '{Enter}Kita');
    await user.click(screen.getByRole('button', { name: 'Hervorhebungen speichern' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Die Liste wurde zwischenzeitlich geändert');
    expect(alert).toHaveTextContent('jetzt 2 Begriffe');
    expect(server.terms).toEqual(['Haushalt', 'Feuerwehr']);

    await user.click(screen.getByRole('button', { name: 'Trotzdem speichern' }));

    await screen.findByText('2 Begriffe gespeichert.');
    expect(server.terms).toEqual(['Haushalt', 'Kita']);
    expect(server.revision).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can discard own edits in favour of the current list after a conflict', async () => {
    const user = userEvent.setup();
    const { server } = fakeServer({ terms: [], revision: 0 });
    render(<HighlightTermsEditor />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hervorhebungen speichern' })).toBeDisabled());
    server.terms = ['Feuerwehr'];
    server.revision = 1;

    await user.type(textarea(), 'Kita');
    await user.click(screen.getByRole('button', { name: 'Hervorhebungen speichern' }));
    await user.click(await screen.findByRole('button', { name: 'Aktuelle Liste laden' }));

    expect(textarea()).toHaveValue('Feuerwehr');
    expect(server.terms).toEqual(['Feuerwehr']);
  });

  it('shows validation errors from the server', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? json(422, { detail: 'Höchstens 200 Begriffe erlaubt' })
        : json(200, { terms: [], revision: 0 })));
    render(<HighlightTermsEditor />);

    await user.type(textarea(), 'Kita');
    await user.click(screen.getByRole('button', { name: 'Hervorhebungen speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Höchstens 200 Begriffe erlaubt');
  });
});

describe('settings dialog', () => {
  beforeEach(() => resetHighlightTermsStore());
  afterEach(() => vi.unstubAllGlobals());

  it('is titled "Einstellungen" and keeps the AI settings next to the highlight section', async () => {
    fakeServer({ terms: ['Haushalt'], revision: 1 });
    render(<LLMSettingsPanel isOpen onClose={vi.fn()} settings={DEFAULT_LLM_SETTINGS} onSettingsChange={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByLabelText('System-Prompt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hervorhebungen' })).toBeInTheDocument();
    expect(screen.getByText(/findet Wörter, die mit „Rat“ beginnen/)).toBeInTheDocument();
    await waitFor(() => expect(textarea()).toHaveValue('Haushalt'));
  });
});
