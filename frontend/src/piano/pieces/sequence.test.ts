import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { BeatGrid } from './grid';
import { numberPiece } from './numbers';
import { sequenceLines, sequenceText } from './sequence';

// Times in halves of a beat (a beat: half a second).
const n = (midi: number, half: number, hand: Hand = 'right'): PieceNote => ({ midi, time: half * 0.25, duration: 0.2, velocity: 0.7, hand });
const grid = BeatGrid.regular(0, 0.5);
const parts = (notes: PieceNote[], sections: { start: number; end: number; label: string }[] = []) => numberPiece(notes, sections, grid, { division: 2 }).parts;

describe('the order of the keys, as written by hand', () => {
  it('joins keys with "-", chords with "+", breathes with a space and a new line', () => {
    // C D C (each half beat), a breath, C D, a long rest, E with G.
    const notes = [n(60, 0), n(62, 1), n(60, 2), n(60, 4), n(62, 5), n(64, 12), n(67, 12), n(64, 13)];
    const [part] = parts(notes);
    const lines = sequenceLines(part, 'right');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d+-\d+-\d+ \d+-\d+$/);
    expect(lines[1]).toMatch(/^\d+\+\d+-\d+$/);
    expect(sequenceLines(part, 'left')).toEqual([]);
  });

  it('cuts long lines, and leaves a blank line between parts', () => {
    const run = Array.from({ length: 16 }, (_, i) => n(60 + (i % 3), i));
    const [part] = parts(run);
    expect(sequenceLines(part, 'right').every((l) => l.split(/[- ]/).length <= 10)).toBe(true);
    const two = parts([n(60, 0), n(62, 1), n(60, 16), n(62, 17)], [{ start: 0, end: 4, label: 'A' }, { start: 4, end: 9, label: 'B' }]);
    expect(sequenceText(two, 'right').split('\n\n')).toHaveLength(2);
  });
});
