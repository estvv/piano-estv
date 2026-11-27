import { describe, expect, it } from 'vitest';
import { chordPoints, takeOf, TakeTracker, type ChordResult } from './takes';

const right = (waited = 0): ChordResult => ({ wrong: 0, waited });

describe('a take', () => {
  it('counts right the first time, and found at once', () => {
    expect(chordPoints(right(0.2))).toBe(1);
    expect(chordPoints(right(10))).toBeCloseTo(0.6);
    expect(chordPoints({ wrong: 1, waited: 0 })).toBe(0.6);
    expect(chordPoints({ wrong: 4, waited: 10 })).toBeCloseTo(0.18);
  });

  it('gives stars', () => {
    expect(takeOf(Array.from({ length: 20 }, () => right()))).toMatchObject({ score: 100, stars: 3, chords: 20, clean: 20, wrong: 0 });
    const some = [...Array.from({ length: 8 }, () => right()), { wrong: 2, waited: 3 }, { wrong: 1, waited: 0 }];
    expect(takeOf(some)).toMatchObject({ score: 88, stars: 2, clean: 8, wrong: 3 });
    expect(takeOf([])).toMatchObject({ score: 0, stars: 0 });
  });

  it('only counts what is played through from its start', () => {
    const t = new TakeTracker(() => 10);
    const play = (n: number) => {
      for (let i = 0; i < n; i++) t.feed({ kind: 'chord', result: right() });
    };
    // Started in the middle.
    play(10);
    expect(t.feed({ kind: 'end' })).toBeNull();
    // The loop starts again: this time from its start.
    play(10);
    expect(t.feed({ kind: 'end' })?.score).toBe(100);
    // Gone elsewhere, then back to the start.
    play(4);
    expect(t.feed({ kind: 'jump' })).toBeNull();
    t.begin();
    play(5);
    expect(t.feed({ kind: 'end' })).toBeNull();
    t.begin();
    play(9);
    expect(t.feed({ kind: 'end' })?.chords).toBe(9);
  });
});

describe('a loop that goes faster', () => {
  it('goes faster after a good take, up to the tempo wanted', async () => {
    const { cleanedProgressive, nextRate } = await import('./progressive');
    const p = cleanedProgressive({ on: true, from: 0.6, to: 1 });
    expect(nextRate(0.6, 85, p)).toBe(0.65);
    expect(nextRate(0.6, 79, p)).toBe(0.6);
    expect(nextRate(0.98, 100, p)).toBe(1);
    expect(nextRate(1, 100, p)).toBe(1);
    // Nonsense kept on the device.
    expect(cleanedProgressive({ from: 0.8, to: 0.5 as never })).toEqual({ on: false, from: 0.8, to: 1 });
    expect(cleanedProgressive({ from: 0.8, to: 0.8 })).toEqual({ on: false, from: 0.8, to: 0.9 });
  });
});

describe('notes heard by a microphone', () => {
  it('count at any octave close by', async () => {
    const { matches } = await import('./player');
    expect([matches(60, 60), matches(60, 72), matches(60, 36), matches(60, 61), matches(60, 96)]).toEqual([true, true, true, false, false]);
  });
});
