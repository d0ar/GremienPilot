import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * How the size of the first pane is stored:
 * - `absolute`: a fixed size in rem (e.g. the agenda column width).
 * - `ratio`: the share (0..1) of the space available to both panes.
 */
export type PaneSizeMode = 'absolute' | 'ratio';

export interface PaneSizeOptions {
  /** localStorage key; must stay constant for the lifetime of the component. */
  storageKey: string;
  mode: PaneSizeMode;
  /** Default size: rem for `absolute`, share of the available space for `ratio`. */
  defaultValue: number;
  /** `x` resizes columns, `y` resizes rows. */
  axis: 'x' | 'y';
  minFirstRem: number;
  minSecondRem: number;
  /** Measuring and resizing only happen while enabled (i.e. above the breakpoint). */
  enabled: boolean;
}

export interface PaneSize {
  /** Whether the container has been measured; separators render only afterwards. */
  ready: boolean;
  /** Current size of the first pane in px, clamped to the minimums. */
  valuePx: number;
  minPx: number;
  maxPx: number;
  /** Size of one keyboard step in px (1rem). */
  stepPx: number;
  /** Gap between the panes in px. */
  gapPx: number;
  /** Clamped size in rem (`absolute` mode). */
  rem: number;
  /** Clamped share of the available space (`ratio` mode). */
  ratio: number;
  /** Sets the first pane size in px; `persist` also writes it to localStorage. */
  setValuePx: (px: number, persist: boolean) => void;
  /** Restores the default and removes the stored value. */
  reset: () => void;
}

interface Metrics {
  size: number;
  gap: number;
  rem: number;
}

const DEFAULT_REM_PX = 16;

function readStored(key: string, mode: PaneSizeMode): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (mode === 'ratio' && value >= 1) return null;
    return value;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable (private mode, quota); sizes then last only for this page view.
  }
}

function parsePx(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function measure(element: HTMLElement, axis: 'x' | 'y'): Metrics {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const rem = parsePx(window.getComputedStyle(document.documentElement).fontSize, DEFAULT_REM_PX) || DEFAULT_REM_PX;
  const gap = parsePx(axis === 'x' ? style.columnGap : style.rowGap, rem);
  return { size: axis === 'x' ? rect.width : rect.height, gap, rem };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Keeps the size of the first of two panes in a grid container, clamped to
 * minimum pane sizes and persisted per browser. The returned values are meant
 * to be written to CSS custom properties, so the stylesheet keeps its defaults
 * as fallback whenever the hook is disabled.
 */
export function usePaneSize(containerRef: RefObject<HTMLElement | null>, options: PaneSizeOptions): PaneSize {
  const { storageKey, mode, defaultValue, axis, minFirstRem, minSecondRem, enabled } = options;
  const [stored, setStored] = useState<number | null>(() => readStored(storageKey, mode));
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // Re-measure on container and window resizes so the clamping follows the layout.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!enabled || !element) {
      setMetrics(null);
      return;
    }
    const update = () => {
      const next = measure(element, axis);
      setMetrics((current) => (
        current && current.size === next.size && current.gap === next.gap && current.rem === next.rem ? current : next
      ));
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [containerRef, enabled, axis]);

  const rem = metrics?.rem ?? DEFAULT_REM_PX;
  const gapPx = metrics?.gap ?? 0;
  const available = metrics ? metrics.size - metrics.gap : 0;
  const ready = enabled && available > 0;

  let minPx = minFirstRem * rem;
  let maxPx = available - minSecondRem * rem;
  if (maxPx < minPx) {
    // Not enough room for both minimums: split the space in proportion to them.
    minPx = maxPx = Math.max(0, available * (minFirstRem / (minFirstRem + minSecondRem)));
  }

  const desired = stored ?? defaultValue;
  const desiredPx = mode === 'absolute' ? desired * rem : desired * available;
  const valuePx = ready ? clamp(desiredPx, minPx, maxPx) : desiredPx;
  const clampedRem = ready ? valuePx / rem : desired;
  const ratio = ready ? valuePx / available : desired;

  const setValuePx = useCallback((px: number, persist: boolean) => {
    if (!ready) return;
    const clampedPx = clamp(px, minPx, maxPx);
    const next = mode === 'absolute'
      ? Math.round((clampedPx / rem) * 100) / 100
      : Math.round((clampedPx / available) * 10000) / 10000;
    setStored(next);
    if (persist) writeStored(storageKey, next);
  }, [ready, minPx, maxPx, mode, rem, available, storageKey]);

  const reset = useCallback(() => {
    setStored(null);
    writeStored(storageKey, null);
  }, [storageKey]);

  return {
    ready,
    valuePx,
    minPx,
    maxPx,
    stepPx: rem,
    gapPx,
    rem: clampedRem,
    ratio,
    setValuePx,
    reset,
  };
}
