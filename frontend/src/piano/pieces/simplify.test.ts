import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { simplify } from './simplify';

const note = (midi: number, time: number, duration: number, hand: PieceNote['hand']): PieceNote => ({ midi, time, duration, velocity: 0.8, hand });

// Right hand: a held pad (C5 E5 G5, 4 s) under a melody on top (A5 then B5);
// left hand: a 3-note chord (C3 E3 G3) held 4 s, then a bass F2.
const dense = [
  note(72, 0, 4, 'right'), note(76, 0, 4, 'right'), note(79, 0, 4, 'right'), note(81, 0.01, 1, 'right'),
  note(83, 1, 1, 'right'),
  note(48, 0, 4, 'left'), note(52, 0, 4, 'left'), note(55, 0.02, 4, 'left'),
  note(41, 2, 1, 'left'),
];
const pitches = (notes: PieceNote[]) => notes.map((n) => n.midi);

describe('simplified levels', () => {
  it('leaves the original untouched', () => {
    expect(simplify(dense, 'original')).toBe(dense);
  });

  it('melody: the highest right-hand note of each chord, one at a time', () => {
    const m = simplify(dense, 'melody');
    expect(pitches(m)).toEqual([81, 83]);
    // A5 (0.01 s) stops when B5 starts (1 s).
    expect(m[0].duration).toBeCloseTo(0.99, 6);
  });

  it('simplified: melody on top, the lowest note of each left-hand chord below', () => {
    const s = simplify(dense, 'simplified');
    expect(pitches(s)).toEqual([48, 81, 83, 41]);
    // The held chord stops when the next bass note comes.
    expect(s.find((n) => n.midi === 48)?.duration).toBe(2);
  });

  it('never plays two notes at once in a hand', () => {
    const s = simplify(dense, 'simplified');
    for (const hand of ['right', 'left'] as const) {
      const line = s.filter((n) => n.hand === hand);
      for (let i = 1; i < line.length; i++) expect(line[i - 1].time + line[i - 1].duration).toBeLessThanOrEqual(line[i].time + 1e-9);
    }
  });

  it('splits notes without a hand at middle C, and keeps their track', () => {
    const audio = [note(64, 0, 1, null), note(67, 0, 1, null), note(43, 0, 1, null), note(36, 0, 1, null)].map((n) => ({ ...n, track: 2 }));
    const s = simplify(audio, 'simplified');
    expect(pitches(s)).toEqual([36, 67]);
    expect(s.every((n) => n.track === 2)).toBe(true);
  });

  it('does not change its input', () => {
    const before = JSON.stringify(dense);
    simplify(dense, 'simplified');
    expect(JSON.stringify(dense)).toBe(before);
  });

  it('takes a rolled chord as one, not a fast line', () => {
    const rolled = [note(43, 0, 3.6, 'left'), note(50, 0.03, 3.6, 'left'), note(58, 0.06, 3, 'left'), note(38, 4, 3, 'left')];
    expect(pitches(simplify(rolled, 'simplified'))).toEqual([43, 38]);
    const fast = [43, 50, 58].map((m, i) => note(m, i * 0.06, 0.06, 'left'));
    expect(pitches(simplify(fast, 'simplified'))).toEqual([43, 50, 58]);
  });
});
