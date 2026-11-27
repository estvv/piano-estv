import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { changeFrom, openPiece } from './importedScore';
import { divisionFor, offGrid, snapItems, snapPiece, snapScore } from './snap';
import type { StoredPiece } from './types';

// Deterministic jitter, within ±20 ms.
const jitter = (i: number) => 0.02 * Math.sin(i * 12.9898);
const BEAT = 60 / 93;
// A video of 24 bars: a bass per bar, chords on the beats, some halves.
const played = (stretch = 0): PieceNote[] => {
  const out: PieceNote[] = [];
  const time = (b: number) => 0.3 + b * BEAT * (1 + stretch * b);
  for (let b = 0; b < 96; b++) {
    const add = (midi: number, at: number, length: number, i: number, hand: 'left' | 'right') => out.push({
      midi, hand, velocity: 0.7, time: time(at) + (at ? jitter(i) : 0), duration: (time(at + length) - time(at)) * 0.88,
    });
    if (b % 4 === 0) add(43 + (b % 3), b, 4, b, 'left');
    add(60 + (b % 5), b, 0.5, 3 * b + 1, 'right');
    add(67 + (b % 2), b, 0.5, 3 * b + 2, 'right');
    if (b % 8 === 5) add(72, b + 0.5, 0.5, 5 * b, 'right');
  }
  return out.sort((a, b) => a.time - b.time || a.midi - b.midi);
};
const stored = (notes: PieceNote[], more: Partial<StoredPiece> = {}): StoredPiece =>
  ({ id: 1, title: 'x', source: 'video', bpm: null, notes, ...more });

describe('notes on the grid', () => {
  it('finds the columns', () => {
    expect(divisionFor([0, 1.02, 1.49, 2, 3.5])).toBe(2);
    expect(divisionFor([0, 0.34, 0.66, 1, 1.33])).toBe(3);
    expect(divisionFor([0, 0.26, 0.5, 0.74, 1])).toBe(4);
  });

  it('keeps chords together, notes apart, and never lets a key cover itself', () => {
    const it = (at: number, length: number, midi: number) => ({ at, length, midi, hand: 'right' as const });
    expect(snapItems([it(1.45, 0.9, 60), it(1.55, 0.9, 64), it(2.6, 1, 60)], 2)).toEqual([
      { at: 2, length: 1 }, { at: 2, length: 1 }, { at: 3, length: 1 },
    ]);
    expect(snapItems([it(0, 3, 60), it(2, 0.1, 60)], 2)).toEqual([{ at: 0, length: 2 }, { at: 2, length: 1 }]);
    expect(snapItems([it(0, 1, 60), it(0.3, 1, 60)], 2).filter(Boolean)).toHaveLength(1);
  });

  it.each([['steady', 0], ['slowing down', 0.0004]])('puts an imported piece on it: %s', (_, stretch) => {
    const notes = played(stretch);
    expect(offGrid(openPiece(stored(notes)).score)).toBe(true);
    const piece = snapPiece({ notes, bpm: null });
    expect(piece.notes).toHaveLength(notes.length);
    expect(piece.notes[0].time).toBe(0);
    // Opened again, every note fills its columns.
    const src = openPiece(stored(piece.notes, { bpm: piece.bpm }));
    expect(offGrid(src.score)).toBe(false);
    expect(changeFrom(src, src.score).notes).toBeNull();
  });

  it.each([['steady', 0], ['slowing down', 0.0004]])('does it later in the editor: %s', (_, stretch) => {
    const p = stored(played(stretch));
    const src = openPiece(p);
    const snapped = snapScore(src.score);
    expect(offGrid(snapped)).toBe(false);
    const change = changeFrom(src, snapped).notes!;
    expect(change.notes).toHaveLength(p.notes.length);
    expect(change.notes!.some((n) => n.pinned)).toBe(false);
    const again = openPiece({ ...p, ...change } as StoredPiece);
    expect(offGrid(again.score)).toBe(false);
    expect(again.score.bpm).toBe(src.score.bpm);
    // Same parts, same notes in each.
    expect(again.score.parts.map((x) => [x.label, x.beats, x.notes.length])).toEqual(snapped.parts.map((x) => [x.label, x.beats, x.notes.length]));
  });

  it('leaves alone a piece with no beat to find', () => {
    const few = { notes: played().slice(0, 3), bpm: null };
    expect(snapPiece(few)).toBe(few);
  });

  it('keeps the place of a piece that does not start on a beat', () => {
    const notes = [0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((b): PieceNote => ({ midi: 60, time: (b - 0.75) * 0.5, duration: 0.2, velocity: 0.7, hand: 'right' }));
    const p = stored(notes, { bpm: 120, sections: [{ start: 0, label: 'A' }, { start: 1.625, label: 'B' }] });
    const { score } = openPiece(p);
    expect(score.parts[0].notes.map((n) => n.step / score.division)).toEqual([0.75, 1, 2, 3]);
    expect(score.parts[1].notes[0].step).toBe(0);
  });
});
