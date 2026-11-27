import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { layoutOf, levelNotes } from './derive';
import { changeFrom, openPiece, renderImported, sameLengths, shareKeys } from './importedScore';
import { addNotes, addPart, addToOrder, assignKey, moveInOrder, partOf, removeNote, renamePart, replaceNote, setBeats, setDivision } from './score';
import { moveEdge } from './roll';
import type { StoredPiece } from './types';

const n = (midi: number, beat: number, hand: Hand = 'right', more: Partial<PieceNote> = {}): PieceNote =>
  ({ midi, time: beat * 0.5, duration: 0.45, velocity: 0.6, hand, ...more });
// Two parts of four beats, some notes off the grid, the first letter twice.
const notes = [n(60, 0), n(48, 0, 'left'), n(64, 1.07), n(62, 3), n(65, 4), n(50, 4.04, 'left'), n(67, 5.5), n(60, 8), n(64, 9)]
  .sort((a, b) => a.time - b.time || a.midi - b.midi);
const sections = [{ start: 0, label: 'A' }, { start: 2, label: 'B' }, { start: 4, label: 'A' }];
const piece = (more: Partial<StoredPiece> = {}): StoredPiece =>
  ({ id: 1, title: 'x', source: 'midi', bpm: 120, notes, sections, ...more });
const times = (list: PieceNote[] | undefined) => list?.map((x) => Number(x.time.toFixed(3)));

describe('an imported piece in the editor', () => {
  it('opens with its parts and leaves its notes alone', () => {
    const src = openPiece(piece());
    expect(src.score.order).toEqual(['A', 'B', 'A2']);
    expect(src.score.parts.map((p) => p.beats)).toEqual([4, 4, 4]);
    expect(src.score.bpm).toBe(120);
    const { notes: out } = renderImported(src, src.score);
    expect(out).toEqual(notes);
    expect(out.every((x) => src.heard.includes(x))).toBe(true);
    expect(changeFrom(src, src.score)).toEqual({ notes: null, numbers: null });
    // Other columns: nothing moves either.
    expect(changeFrom(src, setDivision(setDivision(src.score, 3, true), 4, true)).notes).toBeNull();
  });

  it('numbers keys as the player does', () => {
    const right = (src: ReturnType<typeof openPiece>) => src.score.parts[0].keys.filter((k) => k.hand === 'right').map((k) => [k.midi, k.number]).sort((x, y) => x[0] - y[0]);
    // In the order they come…
    expect(right(openPiece(piece()))).toEqual([[60, 1], [62, 3], [64, 2]]);
    // …or from the lowest; numbers seen here are not the owner's own.
    const src = openPiece(piece({ numbering: 'hand' }));
    expect(right(src)).toEqual([[60, 1], [62, 2], [64, 3]]);
    expect(changeFrom(src, src.score)).toEqual({ notes: null, numbers: null });
  });

  it('keeps the beats of a piece that does not follow a tempo', () => {
    let t = 0;
    const played = Array.from({ length: 64 }, (_, i) => {
      t += 0.5 + 0.06 * Math.sin(i / 4);
      return { ...n(60 + (i % 5), 0), time: t, duration: 0.4 };
    });
    const src = openPiece(piece({ bpm: null, notes: played, sections: null }));
    expect(src.score.parts.length).toBeGreaterThan(0);
    expect(renderImported(src, src.score).notes).toEqual(levelNotes(src.piece));
    const label = src.score.order[0];
    const before = partOf(src.score, label).notes[2];
    const out = changeFrom(src, replaceNote(src.score, label, before, { ...before, midi: 80 })).notes!.notes!;
    expect(out).toHaveLength(64);
    expect(out.find((x) => x.midi === 80)!.time - out[0].time).toBeCloseTo(played[2].time - played[0].time, 6);
  });

  it('only changes the notes touched', () => {
    const src = openPiece(piece());
    const gone = partOf(src.score, 'A').notes.find((x) => x.midi === 64)!;
    const moved = partOf(src.score, 'B').notes.find((x) => x.midi === 67)!;
    let s = removeNote(src.score, 'A', gone);
    s = replaceNote(s, 'B', moved, { ...moved, midi: 69, step: moved.step + 1 });
    s = addNotes(s, 'B', [{ hand: 'left', midi: 40, step: 2, length: s.division }]);
    const change = changeFrom(src, s).notes!;
    expect(change.notes!.filter((x) => notes.includes(x))).toHaveLength(notes.length - 2);
    expect(change.notes!.find((x) => x.midi === 69)).toEqual({ ...n(69, 5.5 + 1 / s.division), pinned: true });
    expect(change.notes!.find((x) => x.midi === 40)).toMatchObject({ time: 2 + 1 / s.division, duration: 0.475, hand: 'left', pinned: true });
    expect(change.sections).toEqual(sections);
    expect(change.bpm).toBeUndefined();
  });

  it('never makes a part longer because of notes off the grid', () => {
    const src = openPiece(piece({ notes: [...notes, n(70, 3.8)] }));
    const s = addNotes(src.score, 'A', [{ hand: 'right', midi: 72, step: 0, length: 1 }]);
    expect(partOf(s, 'A').beats).toBe(4);
  });

  it('follows the order, the tempo and the length of the parts', () => {
    const src = openPiece(piece());
    const swapped = changeFrom(src, moveInOrder(src.score, 0, 1)).notes!;
    expect(swapped.sections).toEqual([{ start: 0, label: 'B' }, { start: 2, label: 'A' }, { start: 4, label: 'A' }]);
    expect(swapped.notes![0]).toEqual(n(65, 0));
    expect(swapped.notes!.find((x) => x.midi === 62)!.time).toBe(3.5);

    const slower = changeFrom(src, { ...src.score, bpm: 60 }).notes!;
    expect(slower.bpm).toBe(60);
    expect(times(slower.notes)).toEqual(notes.map((x) => Number((x.time * 2).toFixed(3))));
    expect(slower.notes!.every((x) => !x.pinned)).toBe(true);

    const shorter = changeFrom(src, setBeats(src.score, 'A', 2)).notes!;
    expect(shorter.sections!.map((x) => x.start)).toEqual([0, 1, 3]);
    expect(shorter.notes!.some((x) => x.midi === 62)).toBe(false);

    const copy = addPart(src.score, 'B', true);
    expect(changeFrom(src, copy.score).notes!.sections![3]).toEqual({ start: 6, label: copy.label });
    expect(changeFrom(src, addToOrder(src.score, 'B')).notes!.notes).toHaveLength(notes.length + 3);
  });

  it('moves what is not shown along with its part', () => {
    const hidden = [n(30, 1, 'left', { track: 1 }), n(31, 5, 'left', { track: 1 })];
    const p = piece({
      notes: [...notes.map((x) => ({ ...x, track: 0 })), ...hidden],
      tracks: [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: false }],
      edits: { melody: { removed: [{ midi: 65, time: 2 }], added: [] } },
    });
    const src = openPiece(p);
    expect(src.hidden).toHaveLength(2);
    const change = changeFrom(src, moveInOrder(src.score, 0, 1)).notes!;
    expect(change.notes!.filter((x) => x.track === 1).map((x) => [x.midi, x.time])).toEqual([[31, 0.5], [30, 2.5]]);
    expect(change.edits).toEqual({ melody: { removed: [{ midi: 65, time: 0 }], added: [] } });
    const added = addNotes(src.score, 'A', [{ hand: 'right', midi: 72, step: 0, length: 1 }]);
    const after = changeFrom(src, added).notes!;
    expect(after.notes!.filter((x) => x.track === 1)).toEqual(hidden);
    expect(after.notes!.find((x) => x.midi === 72)!.track).toBe(0);
  });

  it('keeps changes to an easier level apart', () => {
    const p = piece({ level: 'melody' });
    const src = openPiece(p);
    const first = src.score.parts[0].notes[0];
    const change = changeFrom(src, removeNote(src.score, 'A', first)).notes!;
    expect(change.notes).toBeUndefined();
    expect(change.edits!.melody!.removed).toHaveLength(1);
    const longer = addNotes(src.score, 'A', [{ hand: 'right', midi: 72, step: 200, length: 1 }]);
    expect(partOf(sameLengths(src.score, longer), 'A')).toMatchObject({ beats: 4 });
  });

  it('gives the numbers of a letter to all its parts, and saves those changed', () => {
    const src = openPiece(piece());
    const key = (label: string, s = src.score) => partOf(s, label).keys.find((k) => k.hand === 'right' && k.midi === 60)!.number;
    expect([key('A'), key('A2')]).toEqual([1, 1]);
    const s = shareKeys(src.score, assignKey(src.score, 'A', 'right', 9, 60));
    expect([key('A', s), key('A2', s)]).toEqual([9, 9]);
    const { notes: none, numbers } = changeFrom(src, s);
    expect(none).toBeNull();
    expect(numbers!.filter((x) => x.hand === 'left' || x.label === 'B')).toEqual([]);
    expect(numbers).toContainEqual({ label: 'A', hand: 'right', midi: 60, number: 9 });
    expect(layoutOf({ ...src.piece, numbers }).given.keys!.get('A')).toBeDefined();
  });

  it('moves where a part starts without touching a note', () => {
    const src = openPiece(piece());
    const moved = moveEdge(moveEdge(src.score, 1, 2), 2, -1);
    expect(renderImported(src, moved).notes.every((x) => notes.includes(x))).toBe(true);
    const change = changeFrom(src, moved).notes!;
    expect(change.notes).toEqual(notes);
    expect(change.sections).toEqual([{ start: 0, label: 'A' }, { start: 3, label: 'B' }, { start: 3.5, label: 'A' }]);
    const again = openPiece(piece({ ...change } as Partial<StoredPiece>));
    // The silence after the last note is not kept.
    const shape = (parts: typeof moved.parts) => parts.map((p, i) => [i === 2 ? null : p.beats, p.notes.length]);
    expect(shape(again.score.parts)).toEqual(shape(moved.parts));
    // And back.
    expect(changeFrom(src, moveEdge(moveEdge(moved, 2, 1), 1, -2)).notes).toBeNull();
  });

  it('moves the parts so cut, with what is not shown', () => {
    const hidden = [n(30, 5, 'left', { track: 1 })];
    const src = openPiece(piece({
      notes: [...notes.map((x) => ({ ...x, track: 0 })), ...hidden],
      tracks: [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: false }],
    }));
    // The first beat of B is now in A, then B comes first.
    const change = changeFrom(src, moveInOrder(moveEdge(src.score, 1, 1), 0, 1)).notes!;
    expect(change.sections!.map((x) => x.start)).toEqual([0, 1.5, 4]);
    expect(change.notes!.filter((x) => x.track === 1).map((x) => x.time)).toEqual([0]);
    expect(change.notes!.filter((x) => x.track === 0)).toHaveLength(notes.length);
  });

  it('renames a part', () => {
    const src = openPiece(piece());
    const change = changeFrom(src, renamePart(src.score, 'A2', 'Fin')).notes!;
    expect(change.sections!.map((x) => x.label)).toEqual(['A', 'B', 'Fin']);
    expect(change.notes).toEqual(notes);
  });

  it('opens a piece with nothing to show', () => {
    const src = openPiece(piece({ level: 'melody', notes: [n(48, 0, 'left')], sections: null }));
    expect(src.score.parts).toHaveLength(1);
    expect(changeFrom(src, src.score).notes).toBeNull();
  });
});
