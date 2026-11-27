import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { clearRange, copyRange, inRange, pasteClip, rangeOf, targetOf } from './gridClip';
import { BeatGrid } from './grid';
import { numberPiece } from './numbers';

const n = (midi: number, beat: number, hand: Hand = 'right', duration = 0.4): PieceNote => ({ midi, time: beat * 0.5, duration, velocity: 0.6, hand });
const grid = BeatGrid.regular(0, 0.5);
const notes = [n(60, 0), n(62, 0.5), n(64, 1.02), n(40, 0, 'left'), n(67, 4)];
const sections = [{ start: 0, end: 2, label: 'A' }, { start: 2, end: 4, label: 'B' }];
const parts = (list = notes, division = 2) => numberPiece(list, sections, grid, { division, exact: true }).parts;
const text = (list: PieceNote[]) => list.map((x) => `${x.midi}${x.hand![0]}@${+(x.time / 0.5).toFixed(2)}`).join(' ');

describe('cells of the grid', () => {
  it('are picked from a corner to another', () => {
    expect(rangeOf({ hand: 'right', step: 5 }, { hand: 'right', step: 2 })).toEqual({ from: 2, to: 5, hands: ['right'] });
    expect(rangeOf({ hand: 'right', step: 2 }, { hand: 'left', step: 5 }).hands).toEqual(['left', 'right']);
    const r = rangeOf({ hand: 'left', step: 2 }, { hand: 'left', step: 3 });
    expect([inRange(r, 'left', 2), inRange(r, 'right', 2), inRange(r, 'left', 4), inRange(null, 'left', 2)]).toEqual([true, false, false, false]);
  });

  it('are copied and pasted further, replacing what was there', () => {
    const [a] = parts();
    const clip = copyRange(a, grid, { from: 0, to: 2, hands: ['right'] });
    expect(clip.beats).toBe(1.5);
    const out = pasteClip(notes, a, grid, clip, { hand: 'right', step: 1 });
    // 0.5 and 1 are taken over; the loose one stays loose.
    expect(text(out)).toBe('40l@0 60r@0 60r@0.5 62r@1 64r@1.52 67r@4');
    expect(out.find((x) => x.midi === 64)!.duration).toBeCloseTo(0.4);
  });

  it('are cut, then pasted in another part and another hand', () => {
    const [a, b] = parts();
    const range = { from: 0, to: 1, hands: ['right' as Hand] };
    const clip = copyRange(a, grid, range);
    const cut = clearRange(notes, a, range);
    expect(text(cut)).toBe('64r@1.02 40l@0 67r@4');
    expect(text(pasteClip(cut, parts(cut)[1], grid, clip, { hand: 'left', step: 4 }))).toBe('40l@0 64r@1.02 67r@4 60l@6 62l@6.5');
    expect(targetOf(clip, b, { hand: 'left', step: 4 })).toEqual({ from: 4, to: 5, hands: ['left'] });
  });

  it('keep both hands together', () => {
    const [a] = parts();
    const clip = copyRange(a, grid, { from: 0, to: 0, hands: ['left', 'right'] });
    expect(text(pasteClip(notes, a, grid, clip, { hand: 'right', step: 6 }))).toBe('40l@0 60r@0 62r@0.5 64r@1.02 40l@3 60r@3 67r@4');
  });

  it('paste silences too, fit a finer grid, and stop at the end of the part', () => {
    const [a] = parts();
    const silence = copyRange(a, grid, { from: 4, to: 5, hands: ['right'] });
    expect(text(pasteClip(notes, a, grid, silence, { hand: 'right', step: 0 }))).toBe('40l@0 64r@1.02 67r@4');
    const clip = copyRange(a, grid, { from: 0, to: 2, hands: ['right'] });
    const fine = parts(notes, 4)[0];
    expect(targetOf(clip, fine, { hand: 'right', step: 8 })).toEqual({ from: 8, to: 13, hands: ['right'] });
    expect(text(pasteClip(notes, a, grid, clip, { hand: 'right', step: 7 }))).toBe('40l@0 60r@0 62r@0.5 64r@1.02 60r@3.5 67r@4');
  });
});
