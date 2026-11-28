import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESIZABLE_PANES_QUERY,
  ResizableSummaryPanes,
  ResizableWorkspace,
  SUMMARY_SIDE_BY_SIDE_QUERY,
  paneStorageKey,
} from './ResizablePanes';

const AGENDA_KEY = paneStorageKey('assignment', 'agenda');

let viewportWidthRem = 90;
let containerRect = { width: 1280, height: 600 };

function installMatchMedia() {
  const matches = (query: string) => {
    if (query === RESIZABLE_PANES_QUERY) return viewportWidthRem >= 64;
    if (query === SUMMARY_SIDE_BY_SIDE_QUERY) return viewportWidthRem >= 80;
    return false;
  };
  window.matchMedia = vi.fn((query: string) => ({
    get matches() { return matches(query); },
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderWorkspace(page: 'assignment' | 'protocol' = 'assignment') {
  return render(
    <ResizableWorkspace page={page} className="review-workspace" data-testid="workspace">
      {/* Agenda */}
      <div>Tagesordnung</div>
      <div>Transkript</div>
    </ResizableWorkspace>,
  );
}

function agendaSeparator() {
  return screen.getByRole('separator', { name: 'Breite der Tagesordnung anpassen' });
}

beforeEach(() => {
  viewportWidthRem = 90;
  containerRect = { width: 1280, height: 600 };
  window.localStorage.clear();
  installMatchMedia();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...containerRect, x: 0, y: 0, top: 0, left: 0, right: containerRect.width, bottom: containerRect.height, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error -- jsdom has no matchMedia; remove the mock again.
  delete window.matchMedia;
});

describe('ResizableWorkspace', () => {
  it('renders the agenda separator between the panes with its limits', () => {
    renderWorkspace();
    const separator = agendaSeparator();
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('tabindex', '0');
    // Default 17rem, minimum 12rem, maximum = width - gap - 20rem.
    expect(separator).toHaveAttribute('aria-valuenow', '272');
    expect(separator).toHaveAttribute('aria-valuemin', '192');
    expect(separator).toHaveAttribute('aria-valuemax', String(1280 - 16 - 320));
    expect(separator.previousElementSibling).toHaveTextContent('Tagesordnung');
    expect(separator.nextElementSibling).toHaveTextContent('Transkript');
  });

  it('shows no separator and keeps the CSS defaults below 64rem', () => {
    viewportWidthRem = 50;
    renderWorkspace();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace').style.getPropertyValue('--review-agenda-width')).toBe('');
  });

  it('shows no separator without matchMedia support', () => {
    // @ts-expect-error -- simulate an environment without matchMedia.
    delete window.matchMedia;
    renderWorkspace();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('resizes with the arrow keys and jumps to the limits with Home and End', () => {
    renderWorkspace();
    const separator = agendaSeparator();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '288');
    expect(screen.getByTestId('workspace').style.getPropertyValue('--review-agenda-width')).toBe('18rem');
    expect(window.localStorage.getItem(AGENDA_KEY)).toBe('18');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '256');

    // Up/Down belong to horizontal separators and are ignored here.
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(separator).toHaveAttribute('aria-valuenow', '256');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '192');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', String(1280 - 16 - 320));
  });

  it('clamps to the minimum sizes, also after a window resize', () => {
    renderWorkspace();
    const separator = agendaSeparator();
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '192');
    expect(window.localStorage.getItem(AGENDA_KEY)).toBe('12');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(window.localStorage.getItem(AGENDA_KEY)).toBe(String((1280 - 16 - 320) / 16));

    // Narrower window: the agenda shrinks so the transcript keeps 20rem.
    containerRect = { width: 600, height: 600 };
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(separator).toHaveAttribute('aria-valuenow', String(600 - 16 - 320));
    expect(screen.getByTestId('workspace').style.getPropertyValue('--review-agenda-width')).toBe(`${(600 - 16 - 320) / 16}rem`);
    // The stored preference is kept for when the window grows again.
    expect(window.localStorage.getItem(AGENDA_KEY)).toBe(String((1280 - 16 - 320) / 16));
  });

  it('clamps an out-of-range stored value and ignores invalid ones', () => {
    window.localStorage.setItem(AGENDA_KEY, '2');
    const { unmount } = renderWorkspace();
    expect(agendaSeparator()).toHaveAttribute('aria-valuenow', '192');
    unmount();

    window.localStorage.setItem(AGENDA_KEY, 'kaputt');
    renderWorkspace();
    expect(agendaSeparator()).toHaveAttribute('aria-valuenow', '272');
  });

  it('restores the stored width and keeps pages separate', () => {
    window.localStorage.setItem(AGENDA_KEY, '20');
    const { unmount } = renderWorkspace('assignment');
    expect(agendaSeparator()).toHaveAttribute('aria-valuenow', '320');
    unmount();

    renderWorkspace('protocol');
    expect(agendaSeparator()).toHaveAttribute('aria-valuenow', '272');
  });

  it('leaves room for summary and transcript on the wide protocol page', () => {
    renderWorkspace('protocol');
    // Content needs 20rem + 0.75rem gap + 20rem.
    expect(agendaSeparator()).toHaveAttribute('aria-valuemax', String(1280 - 16 - 40.75 * 16));
  });

  it('resizes by dragging with the pointer and persists on release', () => {
    renderWorkspace();
    const separator = agendaSeparator();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 300 });
    expect(document.body.style.userSelect).toBe('none');
    expect(separator).toHaveFocus();
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 380 });
    expect(separator).toHaveAttribute('aria-valuenow', '352');
    // Not persisted until the drag ends.
    expect(window.localStorage.getItem(AGENDA_KEY)).toBeNull();
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 380 });
    expect(window.localStorage.getItem(AGENDA_KEY)).toBe('22');
    expect(document.body.style.userSelect).toBe('');

    // Moves after release are ignored.
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 500 });
    expect(separator).toHaveAttribute('aria-valuenow', '352');
  });

  it('resets to the default and clears the stored value on double click', () => {
    window.localStorage.setItem(AGENDA_KEY, '25');
    renderWorkspace();
    const separator = agendaSeparator();
    expect(separator).toHaveAttribute('aria-valuenow', '400');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '272');
    expect(window.localStorage.getItem(AGENDA_KEY)).toBeNull();
  });

  it('keeps working when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderWorkspace();
    const separator = agendaSeparator();
    expect(separator).toHaveAttribute('aria-valuenow', '272');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '288');
  });
});

describe('ResizableSummaryPanes', () => {
  function renderPanes() {
    return render(
      <ResizableSummaryPanes className="summary-panes" data-testid="panes" style={{ columnGap: '12px', rowGap: '12px' }}>
        <div>Zusammenfassung</div>
        <div>Originaltranskript</div>
      </ResizableSummaryPanes>,
    );
  }

  it('resizes the columns side by side from 80rem', () => {
    renderPanes();
    const separator = screen.getByRole('separator', { name: 'Breite von Zusammenfassung und Transkript anpassen' });
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    const available = 1280 - 12;
    expect(separator).toHaveAttribute('aria-valuenow', String(Math.round(available * 0.6)));
    expect(separator).toHaveAttribute('aria-valuemin', '320');
    expect(separator).toHaveAttribute('aria-valuemax', String(available - 320));

    fireEvent.keyDown(separator, { key: 'End' });
    const stored = Number(window.localStorage.getItem(paneStorageKey('protocol', 'summary-columns')));
    expect(stored).toBeCloseTo((available - 320) / available, 3);
    expect(screen.getByTestId('panes').style.getPropertyValue('--summary-pane-size')).toMatch(/fr$/);
    expect(window.localStorage.getItem(paneStorageKey('protocol', 'summary-rows'))).toBeNull();
  });

  it('resizes stacked rows between 64rem and 80rem with their own stored value', () => {
    viewportWidthRem = 70;
    renderPanes();
    const separator = screen.getByRole('separator', { name: 'Höhe von Zusammenfassung und Transkript anpassen' });
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
    const available = 600 - 12;
    expect(separator).toHaveAttribute('aria-valuenow', String(Math.round(available * 0.6)));

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', String(Math.round(available * 0.6)));
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(separator).toHaveAttribute('aria-valuenow', String(Math.round(available * 0.6 + 16)));
    expect(window.localStorage.getItem(paneStorageKey('protocol', 'summary-rows'))).not.toBeNull();
    expect(window.localStorage.getItem(paneStorageKey('protocol', 'summary-columns'))).toBeNull();

    fireEvent.doubleClick(separator);
    expect(window.localStorage.getItem(paneStorageKey('protocol', 'summary-rows'))).toBeNull();
    expect(screen.getByTestId('panes').style.getPropertyValue('--summary-pane-size')).toBe('60fr');
  });

  it('shows no separator below 64rem', () => {
    viewportWidthRem = 40;
    renderPanes();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByTestId('panes').style.getPropertyValue('--summary-pane-size')).toBe('');
  });
});
