import { describe, expect, it } from 'vitest';
import { moveTopInList, restoreTopKeyedValues, stableTopIds, transcriptStructureKey } from './topHistory';

describe('moveTopInList', () => {
  it('moves titles and ids and renumbers assignments to follow their TOP', () => {
    expect(moveTopInList(['1. A', '2. B', '3. C'], ['a', 'b', 'c'], [0, 1, 2, null, 0], 0, 2)).toEqual({
      tops: ['2. B', '3. C', '1. A'],
      topIds: ['b', 'c', 'a'],
      assignments: [2, 0, 1, null, 2],
    });
    expect(moveTopInList(['A', 'B', 'C'], ['a', 'b', 'c'], [2, 1], 2, 1)).toEqual({
      tops: ['A', 'C', 'B'], topIds: ['a', 'c', 'b'], assignments: [1, 2],
    });
  });
});

describe('restoreTopKeyedValues', () => {
  it('brings back values of TOPs that no longer exist', () => {
    expect(restoreTopKeyedValues({ 0: 'A', 1: 'B' }, ['a', 'b'], { 0: 'A' }, ['a'])).toEqual({ 0: 'A', 1: 'B' });
  });

  it('keeps newer values of TOPs that still exist, at their snapshot position', () => {
    expect(restoreTopKeyedValues(
      { 0: 'A alt', 1: 'B' }, ['a', 'b'],
      { 0: 'B', 1: 'A neu', 2: 'C' }, ['b', 'a', 'c'],
    )).toEqual({ 0: 'A neu', 1: 'B' });
    // A value removed since the snapshot stays removed.
    expect(restoreTopKeyedValues({ 0: 'A' }, ['a'], {}, ['a'])).toEqual({});
  });

  it('treats the whole-session entry separately when there are no TOPs', () => {
    expect(restoreTopKeyedValues({ 0: 'alt' }, [], { 0: 'neu' }, [])).toEqual({ 0: 'neu' });
    expect(restoreTopKeyedValues({ 0: 'Sitzung' }, [], { 0: 'A' }, ['a'])).toEqual({ 0: 'Sitzung' });
  });
});

describe('helpers', () => {
  it('derives fallback ids and a transcript structure key', () => {
    expect(stableTopIds(['A', 'B'], ['a'])).toEqual(['a', 'top-1']);
    const lines = [{ line_id: 'x', speaker: 'S', text: 'eins', start: 0, end: 1 }];
    expect(transcriptStructureKey(lines)).toBe(transcriptStructureKey([{ ...lines[0]!, text: 'geändert' }]));
    expect(transcriptStructureKey(lines)).not.toBe(transcriptStructureKey([...lines, { ...lines[0]!, line_id: 'y' }]));
  });
});
