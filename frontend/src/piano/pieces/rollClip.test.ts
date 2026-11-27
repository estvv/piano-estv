import type { Score } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { clipPlaces, copyNotes, pasteNotes, removeNotes, sheetOf, stillThere } from './roll';

const score: Score = {
  bpm: 100,
  division: 2,
  order: ['A', 'B'],
  parts: [
    { label: 'A', beats: 4, keys: [], notes: [{ step: 2, midi: 60, hand: 'right', length: 1 }, { step: 4, midi: 48, hand: 'left', length: 2 }] },
    { label: 'B', beats: 4, keys: [], notes: [{ step: 0, midi: 62, hand: 'right', length: 1 }] },
  ],
};

describe('several notes at once', () => {
  it('copies from the first note and pastes across parts', () => {
    const clip = copyNotes(score, [{ index: 0, note: score.parts[0].notes[0] }, { index: 0, note: score.parts[0].notes[1] }])!;
    expect(clip.notes.map((n) => n.at)).toEqual([0, 2]);
    // Column 6 of A, then column 0 of B.
    const places = clipPlaces(score, clip, 6, false);
    expect(places.map((p) => [p.index, p.note.step])).toEqual([[0, 6], [1, 0]]);
    const after = pasteNotes(score, places);
    expect(sheetOf(after)[1].notes.some((n) => n.midi === 48 && n.step === 0)).toBe(true);
  });

  it('leaves out what falls after the end when the piece cannot grow', () => {
    const clip = copyNotes(score, [{ index: 1, note: score.parts[1].notes[0] }])!;
    expect(clipPlaces(score, clip, 16, false)).toEqual([]);
    expect(clipPlaces(score, clip, 16, true)).toHaveLength(1);
  });

  it('removes them, and forgets those gone', () => {
    const picked = [{ index: 0, note: score.parts[0].notes[0] }];
    const after = removeNotes(score, picked);
    expect(after.parts[0].notes).toHaveLength(1);
    expect(stillThere(after, picked)).toEqual([]);
  });
});
