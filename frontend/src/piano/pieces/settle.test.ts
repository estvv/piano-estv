import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { settleHands } from './settle';

const n = (midi: number, time: number, hand: Hand = 'right', duration = 0.2): PieceNote => ({ midi, time, duration, velocity: 0.7, hand });
const letters = (notes: PieceNote[]) => settleHands(notes).map((x) => x.hand![0]).join('');
const line = (midis: number[], gap: number, hand: Hand = 'right') => midis.map((m, i) => n(m, i * gap, hand, gap * 0.95));

// --- Pieces somebody plays, of all sorts ---------------------------------------------

// Always the same for a seed.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 2 ** 32;
  };
}
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const degree = (d: number, root: number) => root + 12 * Math.floor(d / 7) + SCALE[((d % 7) + 7) % 7];

type Pattern = 'block' | 'broken' | 'rolled' | 'octaves' | 'stride' | 'held';
const PATTERNS: Pattern[] = ['block', 'broken', 'rolled', 'octaves', 'stride', 'held'];

// A left hand in that pattern, under a melody walking by steps, at times in thirds,
// on its side of the keyboard.
function piece(pattern: Pattern, seed: number, beat: number, shift = 0): PieceNote[] {
  const r = random(seed);
  const out: PieceNote[] = [];
  const add = (midi: number, time: number, duration: number, hand: Hand) => out.push(n(midi + shift, time, hand, duration));
  for (let bar = 0; bar < 16; bar++) {
    const root = [0, 5, 3, 4][bar % 4] - 14;
    const chord = [root, root + 2, root + 4].map((d) => degree(d, 60));
    const t = bar * 4 * beat;
    for (let b = 0; b < 4; b++) {
      const at = t + b * beat;
      if (pattern === 'block') chord.forEach((m) => add(m, at, beat * 0.9, 'left'));
      if (pattern === 'octaves') [chord[0] - 12, chord[0]].forEach((m) => add(m, at, beat * 0.9, 'left'));
      if (pattern === 'broken') [0, 1].forEach((h) => add([...chord, chord[0] + 12][(b * 2 + h) % 4], at + (h * beat) / 2, beat * 0.45, 'left'));
      if (pattern === 'stride') (b % 2 ? chord.map((m) => m) : [chord[0] - 12]).forEach((m) => add(m, at, beat * 0.8, 'left'));
      if (b === 0 && pattern === 'rolled') [chord[0], chord[2], chord[1] + 12].forEach((m, i) => add(m, at + i * 0.03, beat * 3.8, 'left'));
      if (b === 0 && pattern === 'held') [chord[0], chord[2]].forEach((m) => add(m, at, beat * 3.9, 'left'));
    }
    let d = 7 + (bar % 3);
    for (let k = 0; k < 8; k++) {
      if (r() < 0.2) continue;
      d = Math.min(14, Math.max(5, d + Math.round(r() * 4 - 2)));
      add(degree(d, 60), t + (k * beat) / 2, beat * 0.45, 'right');
      if (r() < 0.25) add(degree(d + 2, 60), t + (k * beat) / 2, beat * 0.45, 'right');
    }
  }
  return out.sort((a, b) => a.time - b.time || a.midi - b.midi);
}
const same = (a: PieceNote[], b: PieceNote[]) => a.filter((x, i) => x.hand === b[i].hand).length / a.length;

describe('who really plays what', () => {
  it.each(PATTERNS)('leaves what is well played as it is: %s', (pattern) => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const beat of [0.35, 0.55, 0.9]) {
        for (const shift of [-5, 0, 4]) {
          const notes = piece(pattern, seed, beat, shift);
          expect(same(settleHands(notes), notes)).toBeGreaterThan(0.985);
        }
      }
    }
  }, 60_000);

  it('does the same in every key', () => {
    for (const pattern of PATTERNS) {
      const hands = [0, 1, 6].map((shift) => letters(piece(pattern, 3, 0.5, shift)));
      expect(new Set(hands).size).toBe(1);
    }
  });

  it('never crosses the hands of a piece that does not', () => {
    for (const pattern of PATTERNS) {
      const out = settleHands(piece(pattern, 5, 0.4));
      for (const a of out) {
        for (const b of out) if (a.hand === 'left' && b.hand === 'right' && Math.abs(a.time - b.time) < 0.04) expect(a.midi).toBeLessThan(b.midi);
      }
    }
  });

  // --- What the other hand is for ---------------------------------------------------

  it('does not cut a line for nothing', () => {
    expect(letters(line([69, 69, 69, 69, 67, 67, 67, 65, 67, 69], 0.16))).toBe('r'.repeat(10));
    // Up and down more than two octaves, step by step.
    expect(letters(line([60, 64, 67, 72, 76, 79, 84, 79, 76, 72, 67, 64, 60], 0.25))).toBe('r'.repeat(13));
    expect(letters(line([48, 50, 52, 53, 52, 50, 48], 0.2, 'left'))).toBe('l'.repeat(7));
  });

  it('helps a line that goes too far too fast, if the other hand is free', () => {
    const run = [77, 79, 77, 79, 81, 79, 81, 64, 62, 60, 62, 60, 59, 81, 79, 77];
    expect(letters(line(run, 0.2))).toBe('rrrrrrrllllllrrr');
    // With time to go there, no need.
    expect(letters(run.map((m, i) => n(m, i * 4)))).toBe('r'.repeat(16));
    // Busy with a bass of its own: each hand keeps its part.
    const bass = Array.from({ length: 11 }, (_, i) => n([38, 45, 50][i % 3], i * 0.3, 'left', 0.28));
    const both = [...line(run, 0.2), ...bass].sort((a, b) => a.time - b.time || a.midi - b.midi);
    expect(same(settleHands(both), both)).toBeGreaterThan(0.95);
  });

  it('shares what one hand cannot hold', () => {
    const wide = [0, 1, 2, 3].flatMap((t) => [n(52, t), n(60, t), n(76, t), n(79, t)]);
    expect(letters(wide)).toBe('llrr'.repeat(4));
    const full = [0, 1, 2].flatMap((t) => [48, 52, 55, 60, 64, 67, 72].map((m) => n(m, t)));
    expect(letters(full).match(/^(l+r+){3}$/)).not.toBeNull();
    expect(letters([0, 1, 2, 3].flatMap((t) => [n(60 + t, t), n(64 + t, t), n(67 + t, t)]))).toBe('r'.repeat(12));
  });

  it('keeps a key under the finger that is on it, whoever the file gives it to', () => {
    for (const shift of [-12, 0, 5]) {
      const chord = [n(43, 0, 'left', 3.6), n(50, 0.03, 'left', 3.6), n(58, 0.06, 'left', 3)];
      const tune = [n(65, 2.6), n(64, 2.8), n(58, 3.07, 'right', 0.6), n(64, 3.3), n(65, 3.5)];
      const all = [...chord, ...tune].map((x) => ({ ...x, midi: x.midi + shift }));
      expect(letters(all)).toBe('lllrrlrr');
    }
  });

  it('puts right hands that cross', () => {
    const crossed = [0, 1, 2, 3].flatMap((i) => [n(48 + i, i * 0.5, 'right', 0.4), n(76 + i, i * 0.5, 'left', 0.4)]);
    expect(letters(crossed)).toBe('lr'.repeat(4));
  });

  it('keeps hands that were chosen, and does nothing to nothing', () => {
    const run = line([77, 79, 81, 79, 60, 59, 60, 62], 0.15);
    expect(settleHands(run, () => true)).toBe(run);
    expect(settleHands([])).toEqual([]);
    const fine = line([60, 62, 64], 0.3);
    expect(settleHands(fine)).toBe(fine);
  });

  it('stays quick on long pieces', () => {
    const long = Array.from({ length: 10 }, (_, k) => piece('broken', k + 1, 0.4).map((x) => ({ ...x, time: x.time + k * 30 }))).flat();
    const start = performance.now();
    expect(settleHands(long)).toHaveLength(long.length);
    expect(performance.now() - start).toBeLessThan(6000);
  });

  it('treats alike what is nearly the same', () => {
    // Played a little less evenly, a little faster: the same hands.
    const chord = [n(43, 0, 'left', 3.6), n(50, 0.03, 'left', 3.6), n(58, 0.06, 'left', 3)];
    const bar = [...chord, ...[69, 67, 65, 67, 65, 64].map((m, i) => n(m, 0.47 + i * 0.35)), n(58, 3.07, 'right', 0.6), n(64, 3.4), n(65, 3.6)];
    const all = Array.from({ length: 4 }, (_, k) => bar.map((x) => ({ ...x, time: x.time + k * 3.9 }))).flat();
    const base = letters(all);
    expect(base.slice(0, bar.length).repeat(4)).toBe(base);
    for (let seed = 1; seed <= 12; seed++) {
      const r = random(seed);
      const speed = 0.85 + r() * 0.3;
      const other = all.map((x) => ({ ...x, time: x.time * speed + r() * 0.008, duration: x.duration * speed }));
      expect(same(settleHands(other), all.map((x, i) => ({ ...x, hand: base[i] === 'l' ? 'left' as const : 'right' as const })))).toBe(1);
    }
  });

  it('gives a hand back its place once the other one has gone', () => {
    // The left hand climbs over where the right one was, long after.
    const notes = [n(60, 0), n(62, 0.3), n(48, 1.6, 'left'), n(55, 2, 'left', 2), n(62, 2.03, 'left', 2), n(70, 2.06, 'left', 2), n(81, 2.5), n(79, 2.7)];
    expect(letters(notes)).toBe('rrllllrr');
  });
});
