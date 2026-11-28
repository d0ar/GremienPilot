import { describe, expect, it } from 'vitest';
import {
  compileHighlightTerm,
  compileHighlightTerms,
  findSearchRanges,
  mergeRanges,
  segmentText,
} from './textHighlight';

function matches(terms: string[], text: string): string[] {
  return compileHighlightTerms(terms).find(text).map(({ start, end }) => text.slice(start, end));
}

describe('highlight term matching', () => {
  it('matches whole words case-insensitively by default', () => {
    expect(matches(['rat'], 'Der Rat tagt. RAT! Stadtrat, Ratsherr, Beratung')).toEqual(['Rat', 'RAT']);
  });

  it('treats umlauts and ß as word characters', () => {
    expect(matches(['Bürger'], 'Bürger, Mitbürger und Bürgerin')).toEqual(['Bürger']);
    expect(matches(['Straße'], 'Die Straße, die Straßenbahn')).toEqual(['Straße']);
    expect(matches(['Öl'], 'Öl und Heizöl, öl')).toEqual(['Öl', 'öl']);
    // "über" must not match inside "gegenüber": ü is a letter, not a boundary.
    expect(matches(['ber'], 'gegenüber ber')).toEqual(['ber']);
    expect(matches(['größe'], 'GRÖSSE Größe')).toEqual(['Größe']);
  });

  it('supports prefix, suffix and infix wildcards and bolds the whole word', () => {
    expect(matches(['Rat*'], 'Rat Ratsbeschluss Stadtrat Beratung')).toEqual(['Rat', 'Ratsbeschluss']);
    expect(matches(['*rat'], 'Rat Ratsbeschluss Stadtrat Beratung')).toEqual(['Rat', 'Stadtrat']);
    expect(matches(['*rat*'], 'Rat Ratsbeschluss Stadtrat Beratung Haus')).toEqual([
      'Rat',
      'Ratsbeschluss',
      'Stadtrat',
      'Beratung',
    ]);
    expect(matches(['*ört*'], 'Gehörtes, Störtebeker und Störung')).toEqual(['Gehörtes', 'Störtebeker']);
  });

  it('matches multi-word terms across flexible whitespace', () => {
    expect(matches(['Erster Beigeordneter'], 'Der erster   Beigeordneter sowie Erster\nBeigeordneter.')).toEqual([
      'erster   Beigeordneter',
      'Erster\nBeigeordneter',
    ]);
    expect(matches(['Erster Beigeordneter'], 'Ersterer Beigeordneter')).toEqual([]);
    expect(matches(['Haupt aus*'], 'Haupt ausschuss')).toEqual(['Haupt ausschuss']);
  });

  it('escapes regular expression characters', () => {
    expect(matches(['§ 34'], 'nach § 34 BauGB')).toEqual(['§ 34']);
    expect(matches(['(Bau)'], 'x (Bau) y Bau')).toEqual(['(Bau)']);
    expect(matches(['a.b'], 'axb a.b')).toEqual(['a.b']);
    expect(matches(['C++'], 'C++ und C')).toEqual(['C++']);
    expect(matches(['Nord-Süd'], 'Die Nord-Süd-Achse und Nord-Süd')).toEqual(['Nord-Süd', 'Nord-Süd']);
    expect(() => compileHighlightTerm('[a-z]{2}\\')).not.toThrow();
  });

  it('ignores bare wildcards and empty terms', () => {
    expect(compileHighlightTerm('*')).toBeNull();
    expect(compileHighlightTerm('  ')).toBeNull();
    expect(compileHighlightTerms(['', '**']).isEmpty).toBe(true);
    expect(matches(['', '*'], 'Text')).toEqual([]);
  });

  it('merges overlapping matches from several terms', () => {
    const text = 'Haupt ausschuss sitzung';
    expect(compileHighlightTerms(['Haupt ausschuss', 'ausschuss sitzung']).find(text)).toEqual([
      { start: 0, end: text.length },
    ]);
  });
});

describe('search ranges', () => {
  it('finds every case-insensitive occurrence including inside words', () => {
    const text = 'Haushalt und haushaltsplan, HAUSHALT';
    expect(findSearchRanges(text, 'haushalt').map(({ start, end }) => text.slice(start, end))).toEqual([
      'Haushalt',
      'haushalt',
      'HAUSHALT',
    ]);
  });

  it('treats the query literally and ignores blank queries', () => {
    expect(findSearchRanges('Rat* und Rat', 'rat*')).toEqual([{ start: 0, end: 4 }]);
    expect(findSearchRanges('Text', '   ')).toEqual([]);
    expect(findSearchRanges('Über über', 'ÜBER')).toHaveLength(2);
  });
});

describe('segmentText', () => {
  it('returns the whole text when nothing is highlighted', () => {
    expect(segmentText('abc')).toEqual([
      { start: 0, end: 3, text: 'abc', bold: false, search: false, current: false },
    ]);
  });

  it('combines overlapping bold and search ranges', () => {
    // "Haushaltsplan": bold term covers the whole word, search hit covers "haltspl".
    const text = 'Der Haushaltsplan wird';
    const segments = segmentText(text, [{ start: 4, end: 17 }], [{ start: 8, end: 15, current: true }]);
    expect(segments.map(({ text: part, bold, search, current }) => [part, bold, search, current])).toEqual([
      ['Der ', false, false, false],
      ['Haus', true, false, false],
      ['haltspl', true, true, true],
      ['an', true, false, false],
      [' wird', false, false, false],
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('keeps the current flag only on the current hit', () => {
    const segments = segmentText('ab ab', [], [
      { start: 0, end: 2 },
      { start: 3, end: 5, current: true },
    ]);
    expect(segments.map(({ text, search, current }) => [text, search, current])).toEqual([
      ['ab', true, false],
      [' ', false, false],
      ['ab', true, true],
    ]);
  });

  it('clips out-of-range ranges', () => {
    expect(segmentText('abc', [{ start: -2, end: 1 }], [{ start: 2, end: 10 }]).map((s) => s.text)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('mergeRanges joins overlapping and touching ranges', () => {
    expect(mergeRanges([{ start: 5, end: 7 }, { start: 0, end: 2 }, { start: 2, end: 3 }, { start: 6, end: 9 }])).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 9 },
    ]);
  });
});
