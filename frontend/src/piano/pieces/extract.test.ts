import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { cuttable, toggled } from './extract';
import { openPiece } from './importedScore';
import { addNotes, addPart, addToOrder, emptyScore, moveInOrder } from './score';
import type { StoredPiece } from './types';

const n = (midi: number, beat: number, hand: Hand = 'right', more: Partial<PieceNote> = {}): PieceNote =>
  ({ midi, time: beat * 0.5, duration: 0.45, velocity: 0.6, hand, ...more });
// A, B, A again and C, of four beats.
const notes = [n(60, 0), n(62, 2), n(64, 4), n(65, 6.3), n(60, 8), n(62, 10), n(70, 12), n(48, 13, 'left')];
const sections = [{ start: 0, label: 'A' }, { start: 2, label: 'B' }, { start: 4, label: 'A' }, { start: 6, label: 'C' }];
const piece = (more: Partial<StoredPiece> = {}): StoredPiece =>
  ({ id: 1, title: 'x', artist: 'y', source: 'midi', bpm: 120, notes, sections, ...more });
const heard = (list: PieceNote[]) => list.map((x) => `${x.midi}@${+(x.time * 2).toFixed(3)}`).join(' ');

describe('a new piece from parts of another', () => {
  it('takes parts of an imported piece, exactly as they are', () => {
    const source = cuttable(piece());
    expect(source.parts.map((p) => [p.label, p.start])).toEqual([['A', 0], ['B', 2], ['A2', 4], ['C', 6]]);
    const copy = source.take([1, 3]);
    expect(heard(copy.piece.notes)).toBe('64@0 65@2.3 70@4 48@5');
    expect(copy.piece.notes[0]).toEqual(n(64, 0));
    expect(copy.sections).toEqual([{ start: 0, label: 'B' }, { start: 2, label: 'C' }]);
    expect(copy).toMatchObject({ piece: { title: 'x', artist: 'y', bpm: 120, source: 'midi' } });
    expect(openPiece({ ...piece(), ...copy.piece, sections: copy.sections }).score.parts.map((p) => [p.label, p.notes.length])).toEqual([['B', 2], ['C', 2]]);
  });

  it('in another order, with one of them alone, or all of them', () => {
    const source = cuttable(piece());
    expect(heard(source.take([3, 0]).piece.notes)).toBe('70@0 48@1 60@4 62@6');
    expect(heard(source.take([2]).piece.notes)).toBe('60@0 62@2');
    expect(source.take([0, 1, 2, 3]).piece.notes).toEqual(notes);
    // The piece is left alone.
    expect(source.notes).toEqual(notes);
  });

  it('does not let a note run over a part that did not follow it', () => {
    const long = [...notes.slice(0, 1), { ...n(50, 3, 'left'), duration: 2.5 }, ...notes.slice(1)].sort((a, b) => a.time - b.time);
    const source = cuttable(piece({ notes: long }));
    const bass = (places: number[]) => source.take(places).piece.notes.find((x) => x.midi === 50)!.duration;
    expect(bass([0, 1])).toBe(2.5);
    expect(bass([0, 3])).toBeCloseTo(0.5);
  });

  it('keeps tracks, numbers and changes to the easier levels', () => {
    const p = piece({
      level: 'melody',
      notes: [...notes.map((x) => ({ ...x, track: 0 })), n(30, 5, 'left', { track: 1 })],
      tracks: [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: false }],
      numbers: [{ label: 'A', hand: 'right', midi: 60, number: 7 }, { label: 'B', hand: 'right', midi: 64, number: 5 }],
      edits: { melody: { removed: [{ midi: 64, time: 2 }, { midi: 70, time: 6 }], added: [] } },
    });
    const copy = cuttable(p).take([1]);
    expect(copy.piece.notes.filter((x) => x.track === 1)).toEqual([n(30, 1, 'left', { track: 1 })]);
    expect(copy.piece.tracks).toEqual(p.tracks);
    expect(copy.numbers).toEqual([{ label: 'B', hand: 'right', midi: 64, number: 5 }]);
    expect(copy.edits).toEqual({ melody: { removed: [{ midi: 64, time: 0 }], added: [] } });
    expect(copy.level).toBe('melody');
  });

  it('takes the lyrics sung in those parts', () => {
    const lyrics = [{ time: 0, text: 'a' }, { time: 2.5, text: 'b' }, { time: 6.1, text: 'c' }, { time: null, text: 'd' }];
    const copy = cuttable(piece({ lyrics })).take([3, 1]);
    expect(copy.lyrics!.map((l) => [l.text, Number(l.time!.toFixed(3))])).toEqual([['c', 0.1], ['b', 2.5]]);
    expect(cuttable(piece({ lyrics })).take([0, 1, 2, 3]).lyrics).toEqual(lyrics);
  });

  it('keeps the tempo of a piece that does not say it', () => {
    const many = Array.from({ length: 64 }, (_, i) => n(60 + (i % 7), i));
    const copy = cuttable(piece({ bpm: null, notes: many, sections: [{ start: 0, label: 'A' }, { start: 2, label: 'B' }] })).take([0]);
    expect(copy.piece.notes).toHaveLength(4);
    expect([60, 120, 240]).toContain(Math.round(copy.piece.bpm!));
  });

  it('takes parts of a piece written by hand', () => {
    let s = addNotes(emptyScore(), 'A', [{ hand: 'right', midi: 60, step: 0, length: 2 }]);
    s = addPart(s, 'A', false).score;
    s = addToOrder(addNotes(s, 'B', [{ hand: 'right', midi: 64, step: 2, length: 2 }]), 'A');
    const source = cuttable(piece({ source: 'manual', score: s, sections: null }));
    expect(source.parts.map((p) => p.label)).toEqual(['A', 'B', 'A']);
    const copy = source.take([1]);
    expect(copy.score!.order).toEqual(['B']);
    expect(copy.score!.parts.map((p) => p.label)).toEqual(['B']);
    expect(copy.piece.notes.map((x) => x.midi)).toEqual([64]);
    expect(moveInOrder(source.take([0, 1]).score!, 0, 1).order).toEqual(['B', 'A']);
  });

  it('picks parts in the order of the piece, until they are moved', () => {
    expect(toggled(toggled([], 2), 0)).toEqual([0, 2]);
    expect(toggled([0, 2], 0)).toEqual([2]);
    expect(toggled([2, 0], 1)).toEqual([2, 0, 1]);
  });
});
