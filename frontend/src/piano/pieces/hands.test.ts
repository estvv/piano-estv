import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { assignHands, credible } from './hands';

const n = (midi: number, time: number, hand: Hand | null = null, duration = 0.4): PieceNote => ({ midi, time, duration, velocity: 0.7, hand });
// Share of the notes given to the hand that plays them.
const right = (truth: PieceNote[], duration?: number) => {
  const out = assignHands(truth.map((x) => ({ ...x, hand: null, duration: duration ?? x.duration })));
  return out.filter((x, i) => x.hand === truth[i].hand).length / truth.length;
};
const shift = (notes: PieceNote[], by: number) => notes.map((x) => ({ ...x, midi: x.midi + by }));

// Left hand arpeggios over two octaves, going over middle C; a melody.
const arpeggios = Array.from({ length: 16 }, (_, b) => [
  ...[0, 7, 12, 16, 19, 16, 12, 7].map((d, i) => n([41, 43, 45, 38][b % 4] + d, b * 2 + i * 0.25, 'left', 0.25)),
  ...[72, 74, 76, 69].map((p, i) => n(p + (b % 3), b * 2 + i * 0.5, 'right', 0.5)),
]).flat();
// Octaves in the bass, right-hand chords mostly under middle C.
const chords = Array.from({ length: 24 }, (_, b) => {
  const r = [36, 33, 41, 43][b % 4];
  return [n(r, b, 'left', 0.9), n(r + 12, b, 'left', 0.9), ...[0, 0.5].flatMap((o) => [0, 4, 7].map((d) => n(r + 19 + d, b + o, 'right', 0.45)))];
}).flat();
const melody = (low: number, hand: Hand) => Array.from({ length: 60 }, (_, i) => n(low + Math.round(7 * Math.sin(i / 3)), i * 0.3, hand, 0.3));

describe('hands', () => {
  it('are found whatever the register', () => {
    for (const by of [-12, 0, 7, 12]) {
      expect(right(shift(arpeggios, by))).toBeGreaterThan(0.98);
      expect(right(shift(chords, by))).toBeGreaterThan(0.98);
    }
  });

  it('are found with a lot of pedal', () => {
    expect(right(arpeggios, 2)).toBeGreaterThan(0.85);
    expect(right(chords, 2)).toBeGreaterThan(0.85);
  });

  it('leave a melody or a bass line to one hand', () => {
    expect(right(melody(66, 'right'))).toBe(1);
    expect(right(melody(43, 'left'))).toBe(1);
    expect(right([...melody(70, 'right'), ...arpeggios.map((x) => ({ ...x, time: x.time + 20 }))])).toBeGreaterThan(0.98);
  });

  it('split chords no hand could reach', () => {
    const out = assignHands([n(40, 0), n(47, 0), n(64, 0), n(72, 0)]);
    expect(out.map((x) => x.hand)).toEqual(['left', 'left', 'right', 'right']);
  });

  it('keep the notes that are fixed, and the order', () => {
    const notes = [n(72, 1, 'left'), n(40, 0), n(74, 2)];
    const out = assignHands(notes, (x) => x.hand !== null);
    expect(out.map((x) => x.midi)).toEqual([72, 40, 74]);
    expect(out[0]).toBe(notes[0]);
    expect(assignHands([])).toEqual([]);
  });

  it('stay quick on long pieces', () => {
    const long = Array.from({ length: 12 }, (_, k) => arpeggios.map((x) => ({ ...x, time: x.time + k * 40 }))).flat();
    const start = performance.now();
    expect(assignHands(long)).toHaveLength(long.length);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('of a file are believed when they can be played', () => {
    expect(credible(arpeggios)).toBe(true);
    expect(credible(arpeggios.map((x) => ({ ...x, hand: 'right' })))).toBe(false);
    // A mere cut at middle C.
    expect(credible(arpeggios.map((x) => ({ ...x, hand: x.midi >= 60 ? 'right' : 'left' })))).toBe(false);
    // Chords out of reach.
    expect(credible([n(40, 0, 'left'), n(62, 0, 'left'), n(64, 1, 'right'), n(59, 2, 'right')])).toBe(false);
  });
});
