import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { estimateBeat } from './grid';
import { PiecePlayer } from './player';
import { detectSections } from './sections';

const BPM = 120;
const BAR = (60 / BPM) * 4;

// A deterministic, distinct bar for each seed: four quarter notes + a bass.
function bar(seed: number, at: number): PieceNote[] {
  const notes: PieceNote[] = [];
  for (let b = 0; b < 4; b++) {
    notes.push({ midi: 60 + ((seed * 7 + b * 5) % 24), time: at * BAR + b * 0.5, duration: 0.45, velocity: 0.7, hand: 'right' });
  }
  notes.push({ midi: 36 + (seed % 12), time: at * BAR, duration: BAR, velocity: 0.6, hand: 'left' });
  return notes;
}

// Phrases as lists of bar seeds, laid one after the other.
function piece(phrases: number[][]): PieceNote[] {
  return phrases.flat().flatMap((seed, i) => bar(seed, i));
}

const labels = (notes: PieceNote[], bpm: number | null = BPM) => detectSections(notes, bpm).map((s) => s.label).join(' ');

describe('section detection', () => {
  it('labels a verse / chorus form', () => {
    const A = [1, 2, 3, 4];
    const B = [5, 6, 7, 8];
    const C = [9, 10, 11, 12];
    expect(labels(piece([A, B, A, C]))).toBe('A B A C');
  });

  it('finds a whole piece played twice, even with an odd number of bars', () => {
    // 17 bars repeated, as a score with a repeat sign played straight through.
    const once = Array.from({ length: 17 }, (_, i) => i + 1);
    const sections = detectSections(piece([once, once]), BPM);
    const half = sections.length / 2;
    expect(Number.isInteger(half)).toBe(true);
    expect(sections.slice(0, half).map((s) => s.label)).toEqual(sections.slice(half).map((s) => s.label));
    // The second pass starts exactly on bar 18.
    expect(sections[half].start).toBeCloseTo(17 * BAR, 6);
    expect(sections.every((s) => (s.end - s.start) / BAR >= 2 && (s.end - s.start) / BAR <= 8)).toBe(true);
  });

  it('keeps a repeat with a different last bar (second ending)', () => {
    const A1 = [1, 2, 3, 4, 5, 6];
    const A2 = [1, 2, 3, 4, 5, 99];
    expect(labels(piece([A1, A2, [7, 8, 9, 10]]))).toBe('A A B');
  });

  it('covers the whole piece without gaps', () => {
    const notes = piece([[1, 2, 3, 4], [5, 6, 7, 8], [1, 2, 3, 4]]);
    const sections = detectSections(notes, BPM);
    expect(sections[0].start).toBe(0);
    for (let i = 1; i < sections.length; i++) expect(sections[i].start).toBe(sections[i - 1].end);
    expect(sections.at(-1)!.end).toBeCloseTo(12 * BAR, 6);
  });

  it('tolerates the timing jitter of a recording', () => {
    let seed = 1;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    const notes = piece([[1, 2, 3, 4], [5, 6, 7, 8], [1, 2, 3, 4], [9, 10, 11, 12]]).map((n) => ({ ...n, time: Math.max(0, n.time + jitter()) }));
    expect(labels(notes)).toBe('A B A C');
  });

  it('keeps a repeated block whole when it is short enough to practise', () => {
    // A+B played twice: one 8-bar section, repeated.
    expect(labels(piece([[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]]))).toBe('A A');
  });

  it('returns nothing for a piece too short to split', () => {
    expect(detectSections(piece([[1, 2]]), BPM)).toEqual([]);
  });

  it('estimates the beat of a piece without tempo', () => {
    const notes = piece([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(60 / estimateBeat(notes.map((n) => n.time))!).toBeCloseTo(BPM, 0);
  });
});

describe('player loop', () => {
  it('jumps back to the loop start at its end', () => {
    const player = new PiecePlayer(piece([[1, 2, 3, 4]]));
    player.setLoop({ start: BAR, end: 2 * BAR });
    expect(player.position).toBeLessThanOrEqual(BAR);
    expect(player.position).toBeGreaterThan(BAR - 0.1);
    player.setLoop(null);
    expect(player.loop).toBeNull();
    player.dispose();
  });
});
