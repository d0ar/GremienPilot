import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

export interface PaneSeparatorProps {
  /** `vertical` separates side-by-side columns, `horizontal` stacked rows. */
  orientation: 'vertical' | 'horizontal';
  label: string;
  /** Size of the pane before the separator in px. */
  value: number;
  min: number;
  max: number;
  /** Keyboard step in px. */
  step: number;
  /** Called with the new size in px; `final` marks the end of a drag or a key press. */
  onChange: (value: number, final: boolean) => void;
  onReset: () => void;
  style?: CSSProperties;
}

interface DragState {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  lastValue: number;
  moved: boolean;
  previousUserSelect: string;
  previousCursor: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Accessible, draggable splitter between two grid panes (WAI-ARIA window
 * splitter pattern). Pointer drags use pointer capture; arrow keys move in
 * steps, Home/End jump to the limits and a double click restores the default.
 */
export default function PaneSeparator({
  orientation,
  label,
  value,
  min,
  max,
  step,
  onChange,
  onReset,
  style,
}: PaneSeparatorProps) {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === 'vertical';
  const cursor = vertical ? 'col-resize' : 'row-resize';

  // Restore the body styles if the separator disappears mid-drag (e.g. on a breakpoint change).
  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    document.body.style.userSelect = drag.previousUserSelect;
    document.body.style.cursor = drag.previousCursor;
  }, []);

  const coordinate = (event: PointerEvent<HTMLDivElement>) => (vertical ? event.clientX : event.clientY);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    // Text selection is only suppressed while dragging.
    document.body.style.userSelect = drag.previousUserSelect;
    document.body.style.cursor = drag.previousCursor;
    const target = event.currentTarget;
    if (typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) onChange(drag.lastValue, true);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    // Prevents text selection from starting at the separator; focus is set manually.
    event.preventDefault();
    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startCoordinate: coordinate(event),
      startValue: value,
      lastValue: value,
      moved: false,
      previousUserSelect: document.body.style.userSelect,
      previousCursor: document.body.style.cursor,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clamp(drag.startValue + coordinate(event) - drag.startCoordinate, min, max);
    if (next === drag.lastValue) return;
    drag.lastValue = next;
    drag.moved = true;
    onChange(next, false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
    const increase = vertical ? 'ArrowRight' : 'ArrowDown';
    let next: number;
    if (event.key === decrease) next = value - step;
    else if (event.key === increase) next = value + step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    onChange(clamp(next, min, max), true);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title="Ziehen oder Pfeiltasten zum Anpassen, Doppelklick setzt zurück"
      className="pane-separator"
      data-dragging={dragging ? 'true' : undefined}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
    />
  );
}
