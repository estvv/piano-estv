import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { beatGrid } from './grid';

const note = (time: number, midi = 60): PieceNote => ({ midi, time, duration: 0.2, velocity: 0.7, hand: 'right' });

describe('beat grid', () => {
  it('keeps a tempo the notes follow', () => {
    const grid = beatGrid(Array.from({ length: 40 }, (_, i) => note(1 + i * 0.25)), 120)!;
    expect(grid.toBeats(1)).toBeCloseTo(0);
    expect(grid.toBeats(3)).toBeCloseTo(4);
    expect(grid.toTime(6)).toBeCloseTo(4);
  });

  it('follows a performance that ignores its file’s tempo', () => {
    // Beats of 0.38 s slowly stretching to 0.44 s, played ±15 ms off, in a file said to be at 120.
    const times: number[] = [];
    let t = 0.9;
    for (let i = 0; i < 120; i++) {
      times.push(t + 0.015 * Math.sin(i * 12.9898));
      t += 0.38 + (0.06 * i) / 120;
    }
    const grid = beatGrid(times.map((x, i) => note(x, i % 2 ? 50 : 62)), 120)!;
    const off = times.map((x, i) => Math.abs(grid.toBeats(x) - i));
    expect(off.filter((o) => o < 0.15).length).toBeGreaterThan(110);
  });

  it('goes back and forth between seconds and beats', () => {
    const grid = beatGrid(Array.from({ length: 60 }, (_, i) => note(0.5 + i * 0.4 + (i % 3) * 0.01)), 97)!;
    for (const b of [-2, 0, 0.5, 7.25, 80]) expect(grid.toBeats(grid.toTime(b))).toBeCloseTo(b);
  });

  it('finds nothing in a handful of notes without a tempo', () => {
    expect(beatGrid([note(0), note(1)], null)).toBeNull();
    expect(beatGrid([], 120)).toBeNull();
  });
});
