import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getModelJobErrorDetails, type JobErrorDetails } from '../api';
import ErrorDetails from './ErrorDetails';

vi.mock('../api', () => ({ getModelJobErrorDetails: vi.fn() }));
const report: JobErrorDetails = { schema_version: 1, job_id: 'job-1', state: 'failed', truncated: false,
  reports: [{ truncated: false, phase: 'fast:context', exceptions: [{ type: 'RuntimeError', message: 'Concrete <script>error</script>', stack: ['agenda_llm.py:100 in context'] }] }] };
beforeEach(() => { vi.mocked(getModelJobErrorDetails).mockResolvedValue(report); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

it('loads details only when expanded, renders messages as text and copies the full report', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  render(<ErrorDetails jobId="job-1" />);
  expect(getModelJobErrorDetails).not.toHaveBeenCalled();
  await user.click(screen.getByText('Technische Fehlerdetails'));
  const details = await screen.findByLabelText('Technischer Fehlerbericht');
  expect(details).toHaveTextContent('Concrete <script>error</script>');
  expect(document.querySelector('script')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Fehlerbericht kopieren' }));
  expect(write).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  expect(await screen.findByText('Fehlerbericht kopiert.')).toBeInTheDocument();
});

it('allows retry after a failed request', async () => {
  vi.mocked(getModelJobErrorDetails).mockRejectedValueOnce(new Error('HTTP 404'));
  const user = userEvent.setup();
  render(<ErrorDetails jobId="job-1" />);
  await user.click(screen.getByText('Technische Fehlerdetails'));
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404');
  await user.click(screen.getByRole('button', { name: 'Erneut laden' }));
  expect(await screen.findByLabelText('Technischer Fehlerbericht')).toBeInTheDocument();
});

it('supports copying over HTTP without Clipboard API', async () => {
  const user = userEvent.setup();
  const copy = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<ErrorDetails jobId="job-1" />);
  await user.click(screen.getByText('Technische Fehlerdetails'));
  await screen.findByLabelText('Technischer Fehlerbericht');
  await user.click(screen.getByRole('button', { name: 'Fehlerbericht kopieren' }));
  expect(copy).toHaveBeenCalledWith('copy');
  expect(await screen.findByText('Fehlerbericht kopiert.')).toBeInTheDocument();
  expect(document.querySelector('textarea')).toBeNull();
});

it('explains unavailable historical details and can refresh', async () => {
  vi.mocked(getModelJobErrorDetails).mockResolvedValueOnce({ ...report, reports: [] });
  const user = userEvent.setup();
  render(<ErrorDetails jobId="job-1" />);
  await user.click(screen.getByText('Technische Fehlerdetails'));
  expect(await screen.findByText(/keine ausführlichen Fehler aufgezeichnet/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
  await waitFor(() => expect(screen.getByLabelText('Technischer Fehlerbericht')).toHaveTextContent('Concrete'));
});
