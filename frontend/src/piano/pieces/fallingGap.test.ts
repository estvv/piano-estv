import type { PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { nextOf } from './FallingNotes';

const n = (midi: number, time: number): PieceNote => ({ midi, time, duration: 0.5, velocity: 0.7, hand: 'right' });

describe('notes played again', () => {
  it('know when their key is played next', () => {
    const notes = [n(60, 0), n(64, 0), n(60, 0.5), n(60, 1), n(64, 2)];
    const next = nextOf(notes);
    expect([next.get(notes[0]), next.get(notes[1]), next.get(notes[2]), next.get(notes[3])]).toEqual([0.5, 2, 1, undefined]);
    expect(nextOf(notes)).toBe(next);
  });
});
