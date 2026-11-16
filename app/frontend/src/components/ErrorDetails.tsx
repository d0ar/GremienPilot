import { useEffect, useRef, useState } from 'react';
import { getModelJobErrorDetails, type JobErrorDetails } from '../api';

export default function ErrorDetails({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<JobErrorDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setCopyStatus('');
    try {
      const data = await getModelJobErrorDetails(jobId, controller.signal);
      if (!controller.signal.aborted) setReport(data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Fehlerdetails konnten nicht geladen werden.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function copy() {
    const text = JSON.stringify(report, null, 2);
    try {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
      } catch {
        // LAN installations commonly use HTTP, where Clipboard API is unavailable.
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand?.('copy')) throw new Error('Copy failed');
        } finally {
          field.remove();
        }
      }
      setCopyStatus('Fehlerbericht kopiert.');
    } catch {
      setCopyStatus('Bitte den Bericht markieren und manuell kopieren.');
    }
  }

  return <details className="mt-4 rounded border border-gray-300 bg-white p-3 text-sm text-gray-800"
    onToggle={event => { if (event.currentTarget.open && !report && !loading && !error) void load(); }}>
    <summary className="cursor-pointer font-medium">Technische Fehlerdetails</summary>
    <p className="mt-2 break-all">Job-ID: {jobId}</p>
    {loading && <p role="status">Fehlerdetails werden geladen …</p>}
    {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
    {report && <>
      {!report.reports.length && <p className="mt-2">Für diesen Auftrag sind keine ausführlichen Fehler aufgezeichnet. Bei älteren Aufträgen ist möglicherweise nur der Fehlername verfügbar.</p>}
      {(report.truncated || report.reports.some(item => item.truncated)) && <p className="mt-2">Der Bericht ist begrenzt; Kürzungen sind im Bericht gekennzeichnet.</p>}
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-100 p-3 text-xs" aria-label="Technischer Fehlerbericht">{JSON.stringify(report, null, 2)}</pre>
      <button type="button" onClick={() => void copy()} className="mt-2 rounded border px-3 py-2">Fehlerbericht kopieren</button>
    </>}
    {!loading && <button type="button" onClick={() => void load()} className="mt-2 ml-2 rounded border px-3 py-2">{error ? 'Erneut laden' : 'Aktualisieren'}</button>}
    {copyStatus && <p role="status" className="mt-2">{copyStatus}</p>}
  </details>;
}
