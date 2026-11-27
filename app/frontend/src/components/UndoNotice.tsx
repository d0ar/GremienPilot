import { useEffect } from 'react';

export interface UndoNoticeContent {
  id: number;
  message: string;
}

interface UndoNoticeProps {
  notice: UndoNoticeContent | null;
  onUndo: () => void;
  /** Called when the notice times out; should be a stable callback. */
  onExpire: () => void;
  undoDisabled?: boolean;
  undoDisabledHint?: string;
  timeoutMs?: number;
}

/**
 * Transient confirmation with an undo button. The outer live region stays
 * mounted so screen readers announce the message when it appears.
 */
export default function UndoNotice({
  notice,
  onUndo,
  onExpire,
  undoDisabled = false,
  undoDisabledHint,
  timeoutMs = 10000,
}: UndoNoticeProps) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onExpire, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [notice, onExpire, timeoutMs]);

  return (
    <div aria-live="polite" aria-atomic="true">
      {notice && (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="min-w-0 break-words">{notice.message}</span>
          <span aria-hidden="true"> – </span>
          <button
            type="button"
            onClick={onUndo}
            disabled={undoDisabled}
            title={undoDisabled ? undoDisabledHint : undefined}
            className="rounded border border-amber-400 bg-white px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
          >
            Rückgängig
          </button>
          {undoDisabled && undoDisabledHint && <span className="w-full text-xs">{undoDisabledHint}</span>}
        </div>
      )}
    </div>
  );
}
