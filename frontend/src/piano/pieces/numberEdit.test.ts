import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { BeatGrid } from './grid';
import { setStep } from './numberEdit';
import { numberPiece } from './numbers';

const n = (midi: number, time: number): PieceNote => ({ midi, time, duration: 0.4, velocity: 0.5, hand: 'right' });
const grid = BeatGrid.regular(0, 0.5);
const notes = [n(60, 0), n(62, 0.51), n(64, 1.5)];
const part = numberPiece(notes, [], grid, { division: 2 }).parts[0];
const text = (list: PieceNote[]) => list.map((x) => `${x.midi}@${+x.time.toFixed(2)}`).join(' ');

describe('changing imported notes by numbers', () => {
  it('replaces a note where it is played, loose timing kept', () => {
    const out = setStep(notes, part, grid, 'right', 2, [65]);
    expect(text(out)).toBe('60@0 65@0.51 64@1.5');
    expect(out[1].velocity).toBe(0.5);
  });

  it('adds a note on the grid, up to the next one', () => {
    const out = setStep(notes, part, grid, 'right', 4, [67], 3);
    expect(text(out)).toBe('60@0 62@0.51 67@1 64@1.5');
    expect(out[2].duration).toBeCloseTo(0.475);
    expect(out[2].track).toBe(3);
    expect(setStep(notes, part, grid, 'left', 0, [40])).toHaveLength(4);
  });

  it('adds a note with what the other hand plays in that column', () => {
    const out = setStep(notes, part, grid, 'left', 2, [48]);
    expect(out.find((x) => x.midi === 48)).toMatchObject({ time: 0.51, duration: 0.4, hand: 'left' });
  });

  it('adds to a chord, empties a column, and leaves the rest alone', () => {
    expect(text(setStep(notes, part, grid, 'right', 0, [60, 64]))).toBe('60@0 64@0 62@0.51 64@1.5');
    expect(text(setStep(notes, part, grid, 'right', 0, []))).toBe('62@0.51 64@1.5');
    expect(setStep(notes, part, grid, 'right', 0, [60])).toBe(notes);
  });
});
