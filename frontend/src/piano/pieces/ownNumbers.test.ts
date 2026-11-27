import type { PieceNote, PieceNumber } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { layoutOf, levelNotes, numbersOf } from './derive';
import { isOwn, keysOf, orderNumbers, resetNumbers, setNumber } from './ownNumbers';
import type { StoredPiece } from './types';

const n = (midi: number, time: number): PieceNote => ({ midi, time, duration: 0.4, velocity: 0.7, hand: 'right' });
// Part A: 72 76 79, part B: 79 72 81. A bass, so that both hands play.
const notes = [n(72, 0), n(76, 1), n(79, 2), n(79, 4), n(72, 5), n(81, 6), ...[0, 2, 4, 6].map((t) => ({ ...n(48 - t, t), hand: 'left' as const }))];
const piece = (numbers: PieceNumber[] | null): StoredPiece => ({
  id: 1, title: 'x', source: 'video', bpm: 60, notes, numbers, sections: [{ start: 0, label: 'A' }, { start: 4, label: 'B' }],
});
const partsOf = (numbers: PieceNumber[] | null) => numbersOf(levelNotes(piece(numbers)), layoutOf(piece(numbers))).parts;
const shown = (numbers: PieceNumber[], label: string) => keysOf(partsOf(numbers), label, 'right').map((k) => `${k.midi}=${k.number}`).join(' ');
const at = (label: string, everywhere = false) => ({ label, hand: 'right' as const, everywhere });

describe('numbers of one’s own', () => {
  it('start from the automatic ones', () => {
    expect([shown([], 'A'), shown([], 'B')]).toEqual(['72=1 76=2 79=3', '79=1 72=2 81=3']);
  });

  it('change for one key, swapping with the one that had it', () => {
    const own = setNumber([], partsOf([]), at('A'), 72, 3);
    expect([shown(own, 'A'), shown(own, 'B')]).toEqual(['79=1 76=2 72=3', '79=1 72=2 81=3']);
    // Any number will do, 0 too.
    expect(shown(setNumber(own, partsOf(own), at('A'), 76, 0), 'A')).toBe('76=0 79=1 72=3');
    expect([isOwn(own, 'A', 'right'), isOwn(own, 'B', 'right')]).toEqual([true, false]);
  });

  it('follow the order keys are pressed in', () => {
    const own = orderNumbers([], partsOf([]), at('A'), [79, 72]);
    expect(shown(own, 'A')).toBe('79=1 72=2 76=3');
  });

  it('change in every part at once', () => {
    const own = orderNumbers([], partsOf([]), at('A', true), [79, 72]);
    expect([shown(own, 'A'), shown(own, 'B')]).toEqual(['79=1 72=2 76=3', '79=1 72=2 81=3']);
    const swapped = setNumber([], partsOf([]), at('A', true), 72, 9);
    expect([shown(swapped, 'A'), shown(swapped, 'B')]).toEqual(['76=2 79=3 72=9', '79=1 81=3 72=9']);
  });

  it('leave room for keys that come later', () => {
    const own = setNumber([], partsOf([]), at('A'), 72, 2);
    const more = { ...piece(own), notes: [...notes, n(74, 3)] };
    expect(keysOf(numbersOf(levelNotes(more), layoutOf(more)).parts, 'A', 'right').map((k) => `${k.midi}=${k.number}`).join(' ')).toBe('76=1 72=2 79=3 74=4');
  });

  it('go back to the automatic ones', () => {
    const own = orderNumbers([], partsOf([]), at('A', true), [79, 72]);
    const back = resetNumbers(own, partsOf(own), at('A'));
    expect([shown(back, 'A'), shown(back, 'B')]).toEqual(['72=1 76=2 79=3', '79=1 72=2 81=3']);
    expect(resetNumbers(own, partsOf(own), at('A', true))).toEqual([]);
  });
});
