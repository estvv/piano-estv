import type { Hand, PieceNote } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { changeOf, editable, layoutOf, levelNotes, numbersAt, numbersOf, playedSpan, trusted, untouched, visible, withNumbers } from './derive';
import type { StoredPiece } from './types';

const n = (midi: number, beat: number, hand: Hand = 'left', track?: number): PieceNote =>
  ({ midi, time: beat * 0.5, duration: 0.45, velocity: 0.7, hand, ...(track === undefined ? {} : { track }) });
const piece = (notes: PieceNote[], more: Partial<StoredPiece> = {}): StoredPiece =>
  ({ id: 1, title: 'x', source: 'midi', bpm: 120, notes, ...more });

// What is seen: "midi=number", in order.
const numbers = (p: StoredPiece, notes = levelNotes(p)) => {
  const { numbers: of } = numbersOf(notes, layoutOf(p));
  return notes.map((x) => `${x.midi}=${of.get(x)}`).join(' ');
};

// Left hand: chords C E G, then F A C.
const chords = [n(48, 0), n(52, 0), n(55, 0), n(53, 1), n(57, 1), n(48, 2), n(60, 2)];

describe('from a piece to its numbers', () => {
  it('follows the level', () => {
    expect(numbers(piece(chords))).toBe('48=1 52=2 55=3 53=4 57=5 48=1 60=6');
    expect(numbers(piece(chords, { level: 'simplified' }))).toBe('48=1 53=2 48=1');
  });

  it('follows the tracks', () => {
    const notes = [n(48, 0, 'left', 0), n(50, 1, 'left', 1), n(52, 2, 'left', 0), n(50, 3, 'left', 1)];
    const tracks = (a: boolean, b: boolean) => [{ name: 'a', instrument: null, enabled: a }, { name: 'b', instrument: null, enabled: b }];
    expect(numbers(piece(notes, { tracks: tracks(true, true) }))).toBe('48=1 50=2 52=3 50=2');
    expect(numbers(piece(notes, { tracks: tracks(true, false) }))).toBe('48=1 52=2');
    expect(numbers(piece(notes, { tracks: tracks(false, true) }))).toBe('50=1 50=1');
  });

  it('follows a note removed or added, at the original level', () => {
    const p = piece([n(48, 0), n(50, 1), n(52, 2)]);
    const without = { ...p, ...changeOf(p, p.notes.slice(1)) };
    expect(numbers(without)).toBe('50=1 52=2');
    const withNew = { ...p, ...changeOf(p, [n(40, 0), ...p.notes.slice(1)]) };
    expect(numbers(withNew)).toBe('40=1 50=2 52=3');
  });

  it('keeps changes to an easier level apart from the piece and the other levels', () => {
    const p = piece(chords, { level: 'simplified' });
    const wanted = levelNotes(p).filter((x) => x.midi !== 53).concat(n(50, 1));
    const changed = { ...p, ...changeOf(p, wanted) };
    expect(numbers(changed)).toBe('48=1 50=2 48=1');
    expect(changed.notes).toBe(p.notes);
    expect(numbers({ ...changed, level: 'original' })).toBe(numbers(piece(chords)));
    expect(levelNotes({ ...changed, level: 'melody' })).toEqual([]);
    // Back to the level as worked out: nothing left to remember.
    expect(changeOf(changed, untouched(changed)).edits).toBeNull();
  });

  it('keeps what was decided about a track while it is off', () => {
    const notes = [n(48, 0, 'left', 0), n(50, 1, 'left', 1)];
    const tracks = (b: boolean) => [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: b }];
    const p = piece(notes, { level: 'simplified', tracks: tracks(true) });
    // With both on: the second track's note goes, another comes.
    const both = { ...p, ...changeOf(p, [levelNotes(p)[0], n(53, 1, 'left', 1)]) };
    expect(numbers(both)).toBe('48=1 53=2');
    // Then the first track is changed alone.
    const off = { ...both, tracks: tracks(false) };
    expect(numbers(off)).toBe('48=1');
    const again = { ...off, ...changeOf(off, [n(47, 0, 'left', 0)]), tracks: tracks(true) };
    expect(numbers(again)).toBe('47=1 53=2');
  });

  it('edits hidden tracks along with the rest, unseen', () => {
    const notes = [n(48, 0, 'left', 0), n(50, 1, 'left', 1)];
    const p = piece(notes, { tracks: [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: false }] });
    expect(editable(p)).toHaveLength(2);
    expect(visible(p, editable(p)).map((x) => x.midi)).toEqual([48]);
  });

  it('moves parts and changes when the start goes', () => {
    const p = piece(chords, {
      sections: [{ start: 0, label: 'A' }, { start: 0.5, label: 'B' }],
      edits: { simplified: { removed: [{ midi: 53, time: 0.5 }], added: [n(40, 1)] } },
    });
    const change = changeOf(p, chords.slice(3));
    expect(change.sections).toEqual([{ start: 0, label: 'B' }]);
    expect(change.edits).toEqual({ simplified: { removed: [{ midi: 53, time: 0 }], added: [n(40, 0)] } });
  });

  it('leaves no silence at the start once its first notes are deleted', () => {
    const p = piece(chords, { sections: [{ start: 0, label: 'A' }, { start: 1, label: 'B' }] });
    const change = changeOf(p, chords.slice(3));
    expect(change.notes?.map((x) => x.time)).toEqual([0, 0, 0.5, 0.5]);
    expect(change.sections).toEqual([{ start: 0, label: 'A' }, { start: 0.5, label: 'B' }]);
    expect(changeOf(p, chords.slice(1))).toEqual({ notes: chords.slice(1) });
  });

  it('plays from the first note heard to the last', () => {
    const notes = [n(30, 0, 'left', 1), n(48, 4, 'left', 0), n(50, 6, 'left', 0), n(30, 20, 'left', 1)];
    const p = piece(notes, { tracks: [{ name: 'a', instrument: null, enabled: true }, { name: 'b', instrument: null, enabled: false }] });
    expect(playedSpan(p, levelNotes(p), 10.45)).toEqual([2, 3.45]);
    expect(playedSpan(piece(notes), notes, 10.45)).toEqual([0, 10.45]);
    expect(playedSpan(piece([]), [], 5)).toEqual([0, 5]);
  });

  it('works out the hands of files that do not say them, and keeps the owner’s choices', () => {
    // One track cut at middle C: a left-hand arpeggio going over it, a melody above.
    const left = [48, 55, 60, 64, 60, 55];
    const notes = Array.from({ length: 24 }, (_, i) => {
      const midi = left[i % 6];
      return n(midi, i / 2, midi >= 60 ? 'right' : 'left');
    }).concat(Array.from({ length: 12 }, (_, i) => n(76 + (i % 3), i, 'right')));
    const p = piece(notes);
    expect(trusted(p)).toBe(false);
    expect(levelNotes(p).every((x) => (x.hand === 'left') === x.midi < 70)).toBe(true);
    const pinned = notes.map((x, i) => (i === 0 ? { ...x, hand: 'right' as const, pinned: true } : x));
    expect(levelNotes(piece(pinned))[0].hand).toBe('right');
    // Editing starts from the hands shown.
    expect(editable(p).map((x) => x.hand)).toEqual(levelNotes(p).map((x) => x.hand));
  });

  it('believes a file that gives playable hands', () => {
    const notes = [n(48, 0), n(62, 1), n(64, 1, 'right'), n(50, 2), n(72, 3, 'right')];
    expect(trusted(piece(notes))).toBe(true);
    expect(levelNotes(piece(notes))).toEqual(notes);
    // But not all in one hand.
    expect(trusted(piece(notes.map((x) => ({ ...x, hand: 'right' }))))).toBe(false);
  });

  it('shares the hands out again when the tracks change', () => {
    // Right hand, left hand, and a third track cut at middle C when imported.
    const bars = [0, 1, 2, 3, 4, 5, 6, 7];
    const notes = bars.flatMap((b) => [
      n(76 + (b % 3), b, 'right', 0),
      n(43 + (b % 4), b, 'left', 1),
      n(58 + (b % 5), b + 0.5, 58 + (b % 5) >= 60 ? 'right' : 'left', 2),
    ]);
    const tracks = (...on: boolean[]) => on.map((enabled, i) => ({ name: String(i), instrument: null, enabled }));
    const withTracks = (...on: boolean[]) => piece(notes, { tracks: tracks(...on) });
    // The two tracks of a piano: as written.
    expect(trusted(withTracks(true, true, false))).toBe(true);
    // One more, or one less: worked out.
    expect(trusted(withTracks(true, true, true))).toBe(false);
    expect(trusted(withTracks(true, false, false))).toBe(false);
    expect(trusted(withTracks(false, true, true))).toBe(false);
    const handsOfThird = (p: StoredPiece) => new Set(levelNotes(p).filter((x) => x.track === 2).map((x) => x.hand));
    // Over a bass, the third track is the right hand; under a melody, the left one.
    expect([...handsOfThird(withTracks(false, true, true))]).toEqual(['right']);
    expect([...handsOfThird(withTracks(true, false, true))]).toEqual(['left']);
  });

  it('leaves a lone melody to its hand, at any level, but for what is too far', () => {
    const tune = [63, 64, 66, 67, 72, 71, 64, 67, 71, 70, 75, 74];
    const hands = (midis: number[], level: StoredPiece['level']) =>
      levelNotes({ ...piece(midis.map((m, i) => n(m, i / 2, 'right'))), level }).map((x) => x.hand![0]).join('');
    for (const level of ['original', 'melody'] as const) expect(hands(tune, level)).toBe('r'.repeat(12));
    expect(hands([84, 86, 84, 86, 88, 60, 62, 60, 59, 60, 62, 60], 'original')).toBe('rrrrrlllllll');
  });

  it('gives the hands anew at an easier level, even those that were chosen', () => {
    // High, then an octave and more lower in no time, all pinned to the right.
    const line = Array.from({ length: 80 }, (_, i) => ({ ...n((i % 16 < 8 ? 84 : 62) + (i % 3) * 2, i / 4, 'right'), duration: 0.12, pinned: true }));
    const p = piece([...line, n(43, 0), n(45, 19)]);
    expect(levelNotes(p).filter((x) => x.hand === 'left')).toHaveLength(2);
    const melody = levelNotes({ ...p, level: 'melody' });
    expect(melody).toHaveLength(80);
    expect(melody.filter((x) => x.midi >= 84).every((x) => x.hand === 'right')).toBe(true);
    expect(melody.filter((x) => x.midi < 70 && x.hand === 'left').length).toBeGreaterThan(20);
    // One note at a time in each hand.
    for (const hand of ['left', 'right']) {
      const own = levelNotes({ ...p, level: 'simplified' }).filter((x) => x.hand === hand);
      for (let i = 1; i < own.length; i++) expect(own[i - 1].time + own[i - 1].duration).toBeLessThanOrEqual(own[i].time + 1e-9);
    }
  });

  it('keeps the numbers of each level apart', () => {
    const p = piece(chords, { numbers: [{ label: 'A', hand: 'left', midi: 48, number: 9 }] });
    const easy = { ...p, level: 'simplified' as const };
    expect(numbers(p)).toContain('48=9');
    expect(numbers(easy)).toBe('48=1 53=2 48=1');
    const own = [{ label: 'A', hand: 'left' as const, midi: 53, number: 5 }];
    const both = withNumbers(easy, own);
    expect(numbersAt({ ...easy, numbers: both })).toEqual(own);
    expect(numbersAt({ ...p, numbers: both })).toEqual(p.numbers);
    expect(withNumbers({ ...p, numbers: both }, [])).toEqual([{ ...own[0], level: 'simplified' }]);
  });
});
