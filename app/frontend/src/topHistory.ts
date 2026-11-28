import type {
  AgendaProposals,
  PdfAgendaExtractionResult,
  SummaryReview,
  SummaryState,
  TranscriptLine,
} from './types';

// How many past states of the assignment page the "Rückgängig" history keeps.
export const MAX_TOP_HISTORY = 20;

export const UNDO_LOCKED_HINT = 'Rückgängig ist gesperrt, solange Zusammenfassungen erzeugt werden.';

/** State that only changes when a PDF agenda is adopted. */
export interface PdfAgendaSnapshot {
  candidate: PdfAgendaExtractionResult | null;
  pdfExtraction: PdfAgendaExtractionResult | null;
  pdfSourceJobId: string | null;
  hasPdfSource: boolean;
  agendaProposals: AgendaProposals | null;
  skippedAssignment: boolean;
  skipAgendaDetection: boolean;
}

/**
 * Everything needed to bring the assignment page back to an earlier state.
 * Summaries, reviews and states are keyed by TOP position, like in App state;
 * `topIds` gives each position its stable identity.
 */
export interface TopEditSnapshot {
  tops: string[];
  topIds: string[];
  assignments: (number | null)[];
  summaries: Record<number, string>;
  summaryReviews: Record<number, SummaryReview>;
  summaryStates: Record<number, SummaryState>;
  /** TOP that was selected before the change; it is selected again on undo. */
  selectedTopId: string | null;
  pdfAgenda?: PdfAgendaSnapshot;
}

/** Same fallback identities AssignmentStep uses for TOPs without a stored id. */
export function stableTopIds(tops: string[], topIds: string[]): string[] {
  return tops.map((_, index) => topIds[index] ?? `top-${index}`);
}

/**
 * Identifies the line structure of the transcript. Assignments are positional,
 * so a snapshot only fits a transcript with the same lines (splitting or
 * joining lines changes this key, editing a line's text does not).
 */
export function transcriptStructureKey(transcript: TranscriptLine[]): string {
  return `${transcript.length}:${transcript.map((line, index) => line.line_id ?? `#${index}`).join('\u0000')}`;
}

/**
 * Restores position-keyed summary data for the TOP list of a snapshot.
 * TOPs that still exist keep their current value (a summary generated or
 * edited after the snapshot is not thrown away); TOPs that no longer exist,
 * e.g. a deleted one, get their value from the snapshot back.
 */
export function restoreTopKeyedValues<T>(
  snapshotValues: Record<number, T>,
  snapshotIds: string[],
  currentValues: Record<number, T>,
  currentIds: string[],
): Record<number, T> {
  // Without TOPs on either side the single entry covers the whole session.
  if (snapshotIds.length === 0) {
    return currentIds.length === 0 ? { ...currentValues } : { ...snapshotValues };
  }
  const restored: Record<number, T> = {};
  snapshotIds.forEach((topId, index) => {
    const currentIndex = currentIds.indexOf(topId);
    const value = currentIndex >= 0 ? currentValues[currentIndex] : snapshotValues[index];
    if (value !== undefined) restored[index] = value;
  });
  return restored;
}

/**
 * Moves one TOP to another position. Titles stay as they are; assignments
 * are renumbered so every line keeps pointing at the same TOP.
 */
export function moveTopInList(
  tops: string[],
  topIds: string[],
  assignments: (number | null)[],
  from: number,
  to: number,
): { tops: string[]; topIds: string[]; assignments: (number | null)[] } {
  const order = tops.map((_, index) => index);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  const newIndexOf = new Map(order.map((previousIndex, nextIndex) => [previousIndex, nextIndex]));
  return {
    tops: order.map((index) => tops[index]!),
    topIds: order.map((index) => topIds[index]!),
    assignments: assignments.map((assignment) =>
      assignment === null ? null : newIndexOf.get(assignment) ?? assignment),
  };
}
