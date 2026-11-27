import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { BeatGrid } from './grid';
import { compactText, numberPiece, partAt, partText } from './numbers';

const n = (midi: number, beat: number, hand: Hand | null = 'left'): PieceNote => ({ midi, time: beat * 0.5, duration: 0.4, velocity: 0.7, hand });
const grid = BeatGrid.regular(0, 0.5);
const text = (notes: PieceNote[]) => partText(numberPiece(notes, [], grid).parts[0]);

describe('numbers', () => {
  describe('other ways to number', () => {
    const notes = [n(50, 0), n(52, 1), n(60, 4), n(50, 5), n(52, 8), n(50, 9), n(53, 10), n(72, 0, 'right'), n(67, 1, 'right'), n(76, 9, 'right')];
    const sections = [{ start: 0, end: 2, label: 'A' }, { start: 2, end: 4, label: 'B' }, { start: 4, end: 6, label: 'A' }];
    const own = new Map([['A', [{ hand: 'left' as const, midi: 52, number: 9 }]]]);
    const of = (given: Parameters<typeof numberPiece>[3]) => {
      const { numbers } = numberPiece(notes, sections, grid, given);
      return notes.map((x) => numbers.get(x));
    };

    it('by position, each hand from its lowest key, part by part', () => {
      // A (both times): left 50 52 53, right 67 72 76. B: left 50 60.
      expect(of({ numbering: 'hand' })).toEqual([1, 2, 2, 1, 2, 1, 3, 2, 1, 3]);
    });

    it('by position on the whole keyboard, the same in every part', () => {
      expect(of({ numbering: 'fixed' })).toEqual(notes.map((x) => x.midi - 20));
    });

    it('without parts: one count for the whole piece', () => {
      expect(of({ whole: true })).toEqual([1, 2, 3, 1, 2, 1, 4, 1, 2, 3]);
      expect(of({ whole: true, numbering: 'hand' })).toEqual([1, 2, 4, 1, 2, 1, 3, 2, 1, 3]);
    });

    it('leaves the owner’s numbers for the usual way', () => {
      expect(of({ keys: own })[1]).toBe(9);
      expect(of({ keys: own, numbering: 'hand' })[1]).toBe(2);
      expect(of({ keys: own, whole: true })[1]).toBe(2);
    });
  });

  it('numbers keys in the order they are first pressed', () => {
    // G Bb D, F A C, Eb G Bb: the G and the Bb come back with their number.
    const keys = [55, 58, 62, 53, 57, 60, 51, 55, 58];
    const notes = keys.map((k, i) => n(k, i));
    const { numbers, parts } = numberPiece(notes, [], grid);
    expect(notes.map((x) => numbers.get(x))).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2]);
    expect(parts[0].keys.map((k) => `${k.midi}=${k.number}`).join(' ')).toBe('55=1 58=2 62=3 53=4 57=5 60=6 51=7');
  });

  it('starts each hand at 1, left first, and writes the rhythm', () => {
    expect(text([n(43, 0), n(50, 2), n(74, 0, 'right'), n(72, 1.5, 'right'), n(74, 3.5, 'right')])).toBe([
      '    1  .  2  .  3  .  4  .',
      'G : 1           2',
      'D : 1        2           1',
    ].join('\n'));
  });

  it('joins a chord with +, lowest key first', () => {
    expect(text([n(55, 0), n(50, 0.02), n(58, 0.04), n(50, 1)])).toBe('    1      2  3  4\nG : 1+2+3  1');
  });

  it('goes by pitch when the hand is unknown', () => {
    expect(numberPiece([n(40, 0, null), n(70, 0, null)], [], grid).parts[0].rows.map((r) => r.hand)).toEqual(['left', 'right']);
  });

  it('starts again at 1 in each part; the same letter shares its numbers', () => {
    const notes = [n(50, 0), n(52, 1), n(60, 4), n(50, 5), n(52, 8), n(50, 9), n(53, 10)];
    const sections = [{ start: 0, end: 2, label: 'A' }, { start: 2, end: 4, label: 'B' }, { start: 4, end: 6, label: 'A' }];
    const { numbers, parts } = numberPiece(notes, sections, grid);
    expect(notes.map((x) => numbers.get(x))).toEqual([1, 2, 1, 2, 2, 1, 3]);
    expect(parts.map((p) => p.columns)).toEqual([4, 4, 4]);
    expect(partAt(parts, 1.99)).toBe(1);
    expect(partAt(parts, 1)).toBe(0);
  });

  it('gives a note a hair early to the part it opens', () => {
    const early = { ...n(60, 4), time: 1.97 };
    const { parts } = numberPiece([n(50, 0), early], [{ start: 0, end: 2, label: 'A' }, { start: 2, end: 4, label: 'B' }], grid);
    expect(parts[1].rows[0].steps[0].step).toBe(0);
  });

  it('writes triplets on thirds, and loose eighths on halves', () => {
    const triplets = Array.from({ length: 24 }, (_, i) => n(60, i / 3));
    expect(numberPiece(triplets, [], grid).parts[0].division).toBe(3);
    const loose = Array.from({ length: 16 }, (_, i) => n(60, i / 2 + 0.04 * Math.sin(i * 9)));
    expect(numberPiece(loose, [], grid).parts[0].division).toBe(2);
  });

  it('handles parts cut in the middle of a bar, and empty ones', () => {
    const sections = [{ start: 0, end: 1, label: 'A' }, { start: 1, end: 3, label: 'B' }, { start: 3, end: 5, label: 'C' }];
    const { parts } = numberPiece([n(50, 0), n(52, 7)], sections, grid);
    expect(parts.map((p) => p.columns / p.division)).toEqual([2, 4, 4]);
    expect(parts[1].rows).toEqual([]);
    expect(partText(parts[0])).toBe('    1  2\nG : 1');
  });

  it('writes it compact: hands aligned, time left out', () => {
    // As written by hand: 1 3 5 under 4 - 4 6 2 5 3.
    const notes = [n(43, 0), n(50, 1), n(55, 2), ...[0, 1.5, 2, 2.5, 3, 3.5].map((b, i) => n(70 + (i % 5), b, 'right'))];
    const [p] = numberPiece(notes, [], grid).parts;
    expect(compactText(p)).toBe('G :  1  2     3\nD :  1     2  3  4  5  1');
  });

  it('fills lines with whole bars, and cuts the bars that are too long', () => {
    const two = numberPiece([0, 1, 2, 3, 4, 5].map((b) => n(60, b)), [], grid).parts[0];
    expect(compactText(two, 40)).toBe('G :  1  1  1  1    1  1');
    expect(compactText(two, 12)).toBe('G :  1  1  1  1\n\nG :  1  1');
    expect(compactText(two, 5)).toBe('G :  1  1\n\nG :  1  1\n\nG :  1  1');
  });
});
