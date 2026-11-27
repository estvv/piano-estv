import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { BeatGrid } from './grid';
import { breakLines, lineWidth } from './numberLines';
import { numberPiece } from './numbers';

const sizing = { font: 13, char: 8, min: 20, beat: 40, cap: 120 };
const part = (beats: number[]) => numberPiece(
  beats.map((b): PieceNote => ({ midi: 60, time: b * 0.5, duration: 0.2, velocity: 0.7, hand: 'right' })), [], BeatGrid.regular(0, 0.5),
).parts[0];

describe('lines of numbers', () => {
  it('puts as many beats on a line as fit', () => {
    const p = part(Array.from({ length: 32 }, (_, i) => i / 2)); // 16 beats, 32 columns
    expect(breakLines(p, 640, sizing)).toHaveLength(1);
    expect(breakLines(p, 639, sizing).map((l) => l.from)).toEqual([0, 16]);
    expect(breakLines(p, 170, sizing)).toHaveLength(4);
    expect(breakLines(p, 5, sizing)).toHaveLength(16);
  });

  it('gives a beat the same width whatever the columns in it', () => {
    const fine = part([0, 0.5, 1.5]);
    const coarse = part([0, 1, 2]);
    expect([fine.division, coarse.division]).toEqual([2, 1]);
    const width = (p: typeof fine) => lineWidth(breakLines(p, 1000, sizing)[0], p, sizing);
    expect(width(fine)).toBe(width(coarse));
  });
});
