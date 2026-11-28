import { useEffect, useState } from 'react';
import {
  HighlightTermsConflictError,
  parseHighlightTermsInput,
  refreshHighlightTerms,
  saveHighlightTerms,
  useHighlightTerms,
  type HighlightTermsSnapshot,
} from '../highlightTerms';

const joinTerms = (terms: readonly string[]) => terms.join('\n');

/** Settings section "Hervorhebungen": the shared list of bold transcript terms. */
export default function HighlightTermsEditor() {
  const shared = useHighlightTerms();
  const [draft, setDraft] = useState(() => joinTerms(shared.terms));
  const [dirty, setDirty] = useState(false);
  // Revision the draft is based on; sent with the save request.
  const [baseRevision, setBaseRevision] = useState(shared.revision);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<HighlightTermsSnapshot | null>(null);

  // Always show the latest list when the dialog opens.
  useEffect(() => {
    void refreshHighlightTerms();
  }, []);

  // Follow server updates until the user starts editing.
  useEffect(() => {
    if (dirty) return;
    setDraft(joinTerms(shared.terms));
    setBaseRevision(shared.revision);
  }, [dirty, shared.terms, shared.revision]);

  const save = async (revision: number) => {
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await saveHighlightTerms(parseHighlightTermsInput(draft), revision);
      setConflict(null);
      setDirty(false);
      setDraft(joinTerms(saved.terms));
      setBaseRevision(saved.revision);
      setMessage(
        saved.terms.length === 1 ? '1 Begriff gespeichert.' : `${saved.terms.length} Begriffe gespeichert.`,
      );
    } catch (saveError) {
      if (saveError instanceof HighlightTermsConflictError) {
        setConflict(saveError.current);
      } else {
        setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const discardOwnChanges = () => {
    if (!conflict) return;
    setDraft(joinTerms(conflict.terms));
    setBaseRevision(conflict.revision);
    setDirty(false);
    setConflict(null);
    setMessage(null);
  };

  return (
    <section aria-labelledby="highlight-terms-heading" className="space-y-3 border-t border-gray-200 pt-6">
      <div>
        <h3 id="highlight-terms-heading" className="text-base font-semibold text-gray-900">
          Hervorhebungen
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Diese Begriffe erscheinen in den Transkripten der Zuordnungs- und der Protokollseite <strong>fett</strong>.
          Zusammenfassungen und Export bleiben unverändert.
        </p>
      </div>
      <label htmlFor="highlight-terms" className="block text-sm font-medium text-gray-700">
        Begriffe (einer pro Zeile)
      </label>
      <textarea
        id="highlight-terms"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setMessage(null);
        }}
        rows={8}
        spellCheck={false}
        placeholder={'Haushalt\nBebauungsplan\nRat*'}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
      />
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-600">
        <li>Ohne Platzhalter zählt nur das ganze Wort, Groß-/Kleinschreibung egal.</li>
        <li><code>Rat*</code> findet Wörter, die mit „Rat“ beginnen (Ratsbeschluss).</li>
        <li><code>*rat</code> findet Wörter, die auf „rat“ enden (Stadtrat).</li>
        <li><code>*rat*</code> findet Wörter, die „rat“ enthalten (Beratung).</li>
        <li>Mehrere Wörter wie <code>Erster Beigeordneter</code> sind erlaubt.</li>
      </ul>
      {conflict && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Die Liste wurde zwischenzeitlich geändert, vermutlich an einem anderen Arbeitsplatz
            (jetzt {conflict.terms.length} {conflict.terms.length === 1 ? 'Begriff' : 'Begriffe'}).
            Beim Überschreiben gehen diese Änderungen verloren.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save(conflict.revision)}
              disabled={isSaving}
              className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Trotzdem speichern
            </button>
            <button
              type="button"
              onClick={discardOwnChanges}
              disabled={isSaving}
              className="rounded border border-amber-400 bg-white px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50"
            >
              Aktuelle Liste laden
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!error && shared.status === 'error' && !dirty && (
        <p className="text-sm text-red-700">Die Liste konnte nicht geladen werden.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-600">Gilt für alle Arbeitsplätze.</p>
        <div className="flex items-center gap-3">
          {message && <span role="status" className="text-sm text-green-700">{message}</span>}
          <button
            type="button"
            onClick={() => void save(baseRevision)}
            disabled={isSaving || !dirty || conflict !== null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Speichert …' : 'Hervorhebungen speichern'}
          </button>
        </div>
      </div>
    </section>
  );
}
