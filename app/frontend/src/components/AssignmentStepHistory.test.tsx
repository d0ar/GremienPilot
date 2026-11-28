import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentStepProps, TopHistoryControl, TranscriptLine } from '../types';
import AssignmentStep from './AssignmentStep';

const transcript: TranscriptLine[] = [
  { line_id: 'line-0', speaker: 'S1', text: 'Erste Zeile', start: 0, end: 1 },
  { line_id: 'line-1', speaker: 'S1', text: 'Zweite Zeile', start: 1, end: 2 },
  { line_id: 'line-2', speaker: 'S2', text: 'Dritte Zeile', start: 2, end: 3 },
];

const baseProps: AssignmentStepProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  tops: [],
  setTops: vi.fn(),
  transcript,
  setTranscript: vi.fn(),
  assignments: [],
  setAssignments: vi.fn(),
  agendaDetection: null,
  speakerNames: {},
  setSpeakerNames: vi.fn(),
};

// Keeps TOPs and assignments in state like App does, using the step's own
// fallback history.
function Harness(props: Partial<AssignmentStepProps>) {
  const [tops, setTops] = useState(['Eröffnung', 'Haushalt', 'Schulbau']);
  const [topIds, setTopIds] = useState(['id-a', 'id-b', 'id-c']);
  const [assignments, setAssignments] = useState<(number | null)[]>([0, 1, 2]);
  return (
    <>
      <AssignmentStep
        {...baseProps}
        tops={tops}
        topIds={topIds}
        onTopsChange={(nextTops, nextIds) => { setTops(nextTops); setTopIds(nextIds); }}
        assignments={assignments}
        setAssignments={setAssignments}
        {...props}
      />
      <pre data-testid="state">{JSON.stringify({ tops, topIds, assignments })}</pre>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!) as {
  tops: string[]; topIds: string[]; assignments: (number | null)[];
};
const agenda = () => screen.getByRole('region', { name: 'Tagesordnung' });
const topButton = (title: string) => within(agenda()).getByRole('button', { name: new RegExp(title) });
const original = { tops: ['Eröffnung', 'Haushalt', 'Schulbau'], topIds: ['id-a', 'id-b', 'id-c'], assignments: [0, 1, 2] };

afterEach(() => {
  vi.useRealTimers();
});

describe('moving TOPs', () => {
  it('moves the selected TOP with the arrow buttons, renumbers assignments and keeps titles', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(topButton('Haushalt'));
    await user.click(screen.getByRole('button', { name: 'TOP nach unten verschieben' }));

    expect(state()).toEqual({
      tops: ['Eröffnung', 'Schulbau', 'Haushalt'],
      topIds: ['id-a', 'id-c', 'id-b'],
      assignments: [0, 2, 1],
    });
    // The selection follows the moved TOP.
    expect(topButton('Haushalt')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText(/ausgewählter top/i)).toHaveValue('Haushalt');
    expect(screen.getByText('TOP ‚Haushalt‘ an Position 3 von 3 verschoben.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TOP nach unten verschieben' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'TOP nach oben verschieben' }));
    await user.click(screen.getByRole('button', { name: 'TOP nach oben verschieben' }));
    expect(state().tops).toEqual(['Haushalt', 'Eröffnung', 'Schulbau']);
    expect(state().assignments).toEqual([1, 0, 2]);
    expect(screen.getByRole('button', { name: 'TOP nach oben verschieben' })).toBeDisabled();
  });

  it('moves the focused TOP with Alt+Arrow keys and keeps the focus on it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    topButton('Schulbau').focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(state().tops).toEqual(['Eröffnung', 'Schulbau', 'Haushalt']);
    expect(state().assignments).toEqual([0, 2, 1]);
    expect(topButton('Schulbau')).toHaveFocus();
    expect(topButton('Schulbau')).toHaveAttribute('aria-current', 'true');

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(state().tops).toEqual(['Schulbau', 'Eröffnung', 'Haushalt']);
    expect(topButton('Schulbau')).toHaveFocus();
    // Moving past the start does nothing.
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(state().tops).toEqual(['Schulbau', 'Eröffnung', 'Haushalt']);

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(state().tops).toEqual(['Eröffnung', 'Schulbau', 'Haushalt']);
    expect(screen.getByText('TOP ‚Schulbau‘ an Position 2 von 3 verschoben.')).toBeInTheDocument();
  });

  it('ignores arrow keys without Alt', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    topButton('Schulbau').focus();
    await user.keyboard('{ArrowUp}');
    expect(state()).toEqual(original);
  });

  it('moves a TOP by drag and drop', () => {
    render(<Harness />);
    const rows = () => screen.getAllByTestId(/^top-drag-handle-/).map((handle) => handle.parentElement!);
    fireEvent.dragStart(screen.getByTestId('top-drag-handle-0'));
    fireEvent.dragOver(rows()[2]!);
    expect(rows()[2]).toHaveClass('ring-2');
    fireEvent.drop(rows()[2]!);

    expect(state()).toEqual({
      tops: ['Haushalt', 'Schulbau', 'Eröffnung'],
      topIds: ['id-b', 'id-c', 'id-a'],
      assignments: [2, 0, 1],
    });
    expect(topButton('Eröffnung')).toHaveAttribute('aria-current', 'true');
    expect(rows()[2]).not.toHaveClass('ring-2');
  });

  it('undoes a move', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(topButton('Eröffnung'));
    await user.click(screen.getByRole('button', { name: 'TOP nach unten verschieben' }));
    expect(state().tops).toEqual(['Haushalt', 'Eröffnung', 'Schulbau']);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(state()).toEqual(original);
    expect(topButton('Eröffnung')).toHaveAttribute('aria-current', 'true');
  });
});

describe('notice after deleting a TOP', () => {
  it('offers undo, restores the TOP and focuses it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(topButton('Haushalt'));
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));

    expect(state()).toEqual({ tops: ['Eröffnung', 'Schulbau'], topIds: ['id-a', 'id-c'], assignments: [0, null, 1] });
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('TOP ‚Haushalt‘ gelöscht – Rückgängig');

    await user.click(within(notice).getByRole('button', { name: 'Rückgängig' }));
    expect(state()).toEqual(original);
    expect(screen.queryByText('TOP ‚Haushalt‘ gelöscht')).not.toBeInTheDocument();
    expect(topButton('Haushalt')).toHaveAttribute('aria-current', 'true');
    expect(topButton('Haushalt')).toHaveFocus();
  });

  it('disappears after ten seconds', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(topButton('Haushalt'));
    fireEvent.click(screen.getByRole('button', { name: 'TOP löschen' }));
    expect(screen.getByText('TOP ‚Haushalt‘ gelöscht')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(9000); });
    expect(screen.getByText('TOP ‚Haushalt‘ gelöscht')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('TOP ‚Haushalt‘ gelöscht')).not.toBeInTheDocument();
    // The change itself can still be undone.
    expect(screen.getByRole('button', { name: /^rückgängig \(1\)/i })).toBeEnabled();
  });

  it('disappears with the next change', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(topButton('Haushalt'));
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    expect(screen.getByText('TOP ‚Haushalt‘ gelöscht')).toBeInTheDocument();

    await user.click(screen.getByText('Erste Zeile'));
    expect(screen.queryByText('TOP ‚Haushalt‘ gelöscht')).not.toBeInTheDocument();

    // Undo goes back step by step: first the line, then the deletion.
    await user.click(screen.getByRole('button', { name: /^rückgängig \(2\)/i }));
    expect(state().tops).toEqual(['Eröffnung', 'Schulbau']);
    await user.click(screen.getByRole('button', { name: /^rückgängig \(1\)/i }));
    expect(state()).toEqual(original);
  });
});

describe('shared history passed in by App', () => {
  function control(overrides: Partial<TopHistoryControl> = {}): TopHistoryControl {
    return {
      count: 0, lastEntryId: null, lastLabel: null, locked: false,
      commit: vi.fn(() => 1), undo: vi.fn(() => null), ...overrides,
    };
  }

  it('sends TOP changes to the shared history instead of applying them itself', async () => {
    const user = userEvent.setup();
    const history = control();
    const setTops = vi.fn();
    const setAssignments = vi.fn();
    render(<AssignmentStep {...baseProps} history={history} tops={['A', 'B']} topIds={['a', 'b']}
      assignments={[0, 1, null]} setTops={setTops} setAssignments={setAssignments} />);
    await user.click(screen.getByRole('button', { name: 'TOP nach unten verschieben' }));

    expect(history.commit).toHaveBeenCalledWith({
      label: 'TOP verschieben', tops: ['B', 'A'], topIds: ['b', 'a'], assignments: [1, 0, null], selectedTopId: 'a',
    });
    expect(setTops).not.toHaveBeenCalled();
    expect(setAssignments).not.toHaveBeenCalled();
  });

  it('selects the TOP that was selected before the undone change', async () => {
    const user = userEvent.setup();
    function SharedHarness() {
      const [tops, setTops] = useState(['A']);
      const [topIds, setTopIds] = useState(['a']);
      const history = control({
        count: tops.length === 1 ? 1 : 0, lastEntryId: 1, lastLabel: 'TOP löschen',
        undo: () => {
          setTops(['A', 'B']);
          setTopIds(['a', 'b']);
          return { label: 'TOP löschen', topIds: ['a', 'b'], selectedTopId: 'b' };
        },
      });
      return <AssignmentStep {...baseProps} history={history} tops={tops} topIds={topIds} />;
    }
    render(<SharedHarness />);
    const undoButton = screen.getByRole('button', { name: /^rückgängig \(1\)/i });
    expect(undoButton).toHaveAttribute('title', 'Rückgängig: TOP löschen (Strg+Z)');
    await user.click(undoButton);
    expect(topButton('B')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Rückgängig gemacht: TOP löschen')).toBeInTheDocument();
  });

  it('locks undo while summaries are generated and explains why', async () => {
    const user = userEvent.setup();
    const history = control({ count: 2, lastEntryId: 2, lastLabel: 'TOP löschen', locked: true });
    render(<AssignmentStep {...baseProps} history={history} tops={['A', 'B']} topIds={['a', 'b']} />);

    const undoButton = screen.getByRole('button', { name: /^rückgängig \(2\)/i });
    expect(undoButton).toBeDisabled();
    expect(undoButton).toHaveAccessibleDescription('Rückgängig ist gesperrt, solange Zusammenfassungen erzeugt werden.');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(history.undo).not.toHaveBeenCalled();

    // Deleting is still possible; the notice's undo is locked as well.
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    expect(history.commit).toHaveBeenCalled();
  });

  it('locks the undo button of the delete notice while summaries are generated', async () => {
    const user = userEvent.setup();
    let history = control({ locked: true, commit: vi.fn(() => 5) });
    const { rerender } = render(<AssignmentStep {...baseProps} history={history} tops={['A', 'B']} topIds={['a', 'b']} />);
    await user.click(screen.getByRole('button', { name: 'TOP löschen' }));
    history = { ...history, count: 1, lastEntryId: 5, lastLabel: 'TOP löschen' };
    rerender(<AssignmentStep {...baseProps} history={history} tops={['B']} topIds={['b']} />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('TOP ‚A‘ gelöscht');
    expect(within(notice).getByRole('button', { name: 'Rückgängig' })).toBeDisabled();
    expect(notice).toHaveTextContent('Rückgängig ist gesperrt, solange Zusammenfassungen erzeugt werden.');
  });
});
