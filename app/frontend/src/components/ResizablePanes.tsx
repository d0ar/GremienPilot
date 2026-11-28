import { Children, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import PaneSeparator from './PaneSeparator';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePaneSize, type PaneSize } from '../hooks/usePaneSize';

/** Below this width all panes stack in document flow and no separators are shown. */
export const RESIZABLE_PANES_QUERY = '(min-width: 64rem)';
/** From this width summary and transcript sit side by side instead of stacked. */
export const SUMMARY_SIDE_BY_SIDE_QUERY = '(min-width: 80rem)';

export const PANE_STORAGE_PREFIX = 'gremienpilot-pane-size';

export type ResizablePage = 'assignment' | 'protocol';
export type PaneSeparatorId = 'agenda' | 'summary-columns' | 'summary-rows';

export function paneStorageKey(page: ResizablePage, separator: PaneSeparatorId) {
  return `${PANE_STORAGE_PREFIX}:${page}:${separator}`;
}

// Defaults mirror the fallback values in index.css.
const AGENDA_DEFAULT_REM = 17;
const AGENDA_MIN_REM = 12;
const CONTENT_MIN_REM = 20;
const STACKED_CONTENT_MIN_REM = 10;
const SUMMARY_DEFAULT_RATIO = 0.6;
/** Gap between summary and transcript (`gap-3`). */
const SUMMARY_GAP_REM = 0.75;

type ContainerProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & { children: ReactNode };

/**
 * Inserts the separator between the first child and the remaining ones. The
 * slot is always present (null when inactive), so crossing a breakpoint never
 * remounts the panes and their scroll positions survive.
 */
function withSeparator(children: ReactNode, separator: ReactNode) {
  const [first, ...rest] = Children.toArray(children);
  return (
    <>
      {first}
      {separator}
      {rest}
    </>
  );
}

function separatorFor(pane: PaneSize, orientation: 'vertical' | 'horizontal', label: string) {
  if (!pane.ready) return null;
  const position: CSSProperties = orientation === 'vertical'
    ? { left: `${pane.valuePx}px`, width: `${pane.gapPx}px` }
    : { top: `${pane.valuePx}px`, height: `${pane.gapPx}px` };
  return (
    <PaneSeparator
      orientation={orientation}
      label={label}
      value={pane.valuePx}
      min={pane.minPx}
      max={pane.maxPx}
      step={pane.stepPx}
      onChange={pane.setValuePx}
      onReset={pane.reset}
      style={position}
    />
  );
}

/**
 * `.review-workspace` grid (agenda | content) with a draggable agenda width.
 * The width is exposed as `--review-agenda-width`.
 */
export function ResizableWorkspace({ page, children, style, ...props }: ContainerProps & { page: ResizablePage }) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useMediaQuery(RESIZABLE_PANES_QUERY);
  const summarySideBySide = useMediaQuery(SUMMARY_SIDE_BY_SIDE_QUERY);
  // On the protocol page the content holds summary and transcript next to each other from 80rem.
  const contentMinRem = page === 'protocol' && summarySideBySide
    ? 2 * CONTENT_MIN_REM + SUMMARY_GAP_REM
    : CONTENT_MIN_REM;
  const pane = usePaneSize(ref, {
    storageKey: paneStorageKey(page, 'agenda'),
    mode: 'absolute',
    defaultValue: AGENDA_DEFAULT_REM,
    axis: 'x',
    minFirstRem: AGENDA_MIN_REM,
    minSecondRem: contentMinRem,
    enabled,
  });
  const containerStyle = pane.ready
    ? ({ ...style, '--review-agenda-width': `${pane.rem}rem` } as CSSProperties)
    : style;
  return (
    <div ref={ref} style={containerStyle} {...props}>
      {withSeparator(children, separatorFor(pane, 'vertical', 'Breite der Tagesordnung anpassen'))}
    </div>
  );
}

/**
 * `.summary-panes` grid (summary | transcript) on the protocol page. Columns
 * from 80rem, stacked rows between 64rem and 80rem; each layout keeps its own
 * stored share. Sizes are exposed as `--summary-pane-size` and
 * `--transcript-pane-size` (fr values).
 */
export function ResizableSummaryPanes({ children, style, ...props }: ContainerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useMediaQuery(RESIZABLE_PANES_QUERY);
  const sideBySide = useMediaQuery(SUMMARY_SIDE_BY_SIDE_QUERY);
  const columns = usePaneSize(ref, {
    storageKey: paneStorageKey('protocol', 'summary-columns'),
    mode: 'ratio',
    defaultValue: SUMMARY_DEFAULT_RATIO,
    axis: 'x',
    minFirstRem: CONTENT_MIN_REM,
    minSecondRem: CONTENT_MIN_REM,
    enabled: enabled && sideBySide,
  });
  const rows = usePaneSize(ref, {
    storageKey: paneStorageKey('protocol', 'summary-rows'),
    mode: 'ratio',
    defaultValue: SUMMARY_DEFAULT_RATIO,
    axis: 'y',
    minFirstRem: STACKED_CONTENT_MIN_REM,
    minSecondRem: STACKED_CONTENT_MIN_REM,
    enabled: enabled && !sideBySide,
  });
  const pane = sideBySide ? columns : rows;
  const summaryPercent = Math.round(pane.ratio * 10000) / 100;
  const containerStyle = pane.ready
    ? ({
        ...style,
        '--summary-pane-size': `${summaryPercent}fr`,
        '--transcript-pane-size': `${Math.round((100 - summaryPercent) * 100) / 100}fr`,
      } as CSSProperties)
    : style;
  const separator = sideBySide
    ? separatorFor(columns, 'vertical', 'Breite von Zusammenfassung und Transkript anpassen')
    : separatorFor(rows, 'horizontal', 'Höhe von Zusammenfassung und Transkript anpassen');
  return (
    <div ref={ref} style={containerStyle} {...props}>
      {withSeparator(children, separator)}
    </div>
  );
}
