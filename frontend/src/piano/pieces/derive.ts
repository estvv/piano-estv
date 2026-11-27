import { pieceDuration, renderScore, soundingSpan, trimSilence, type LyricLine, type PieceEdits, type PieceLevel, type PieceNote, type PieceNumber, type PieceSection } from '@piano/shared';
import { BeatGrid, beatGrid } from './grid';
import { assignHands, credible } from './hands';
import { applyEdit, editOf } from './levelEdits';
import { givenByOwner, givenByScore, numberPiece, type Given, type NumberedPiece } from './numbers';
import { fromSaved } from './parts';
import { detectSections, type Section } from './sections';
import { settleHands } from './settle';
import { oneByOne, simplify } from './simplify';
import type { StoredPiece } from './types';

// From a stored piece to what is shown, in one direction only:
//   notes -> tracks on -> hands -> level -> changes by hand -> numbers.
// Nothing in between is stored, so the numbers follow any change above them.

export const levelNames: Record<PieceLevel, string> = { original: 'Original', simplified: 'Simplifié', melody: 'Mélodie' };

export const levelOf = (piece: StoredPiece): PieceLevel => piece.level ?? 'original';

const trackOn = (piece: StoredPiece) => (track: number | undefined) => track === undefined || !piece.tracks || !!piece.tracks[track]?.enabled;

// The notes of the tracks turned on.
export function tracksOn(piece: StoredPiece, notes: PieceNote[] = piece.notes): PieceNote[] {
  const on = trackOn(piece);
  return piece.tracks ? notes.filter((n) => on(n.track)) : notes;
}

// Files with several instruments: their hands only mean something when two
// tracks are on, one for each hand. Any other choice of tracks is played by the
// two hands together, so it is shared out again.
function oneTrackPerHand(piece: StoredPiece, notes: PieceNote[]): boolean {
  if (!piece.tracks) return true;
  const hands = new Map<number | undefined, Set<string | null>>();
  for (const n of notes) {
    if (n.pinned) continue;
    const set = hands.get(n.track) ?? new Set();
    hands.set(n.track, set.add(n.hand));
  }
  const sets = [...hands.values()];
  return sets.length === 2 && sets.every((s) => s.size === 1) && [...sets[0]][0] !== [...sets[1]][0];
}

// The file's hands are kept when they make sense, else they are worked out.
export function trusted(piece: StoredPiece): boolean {
  const notes = tracksOn(piece);
  return oneTrackPerHand(piece, notes) && credible(notes, !!piece.tracks);
}

// The notes of the tracks turned on, each with its hand. The owner's choices
// are kept; notes of no known hand get one in any case.
function voices(piece: StoredPiece): PieceNote[] {
  const notes = tracksOn(piece);
  if (piece.score) return notes;
  const file = trusted(piece);
  if (file && notes.every((n) => n.hand)) return notes;
  return assignHands(notes, (n) => !!n.hand && (file || !!n.pinned));
}

// What the hands can really do, at any level (settle.ts). Hands chosen by the owner
// stay at the original level; an easier one is another piece.
const settled = new WeakMap<StoredPiece, PieceNote[]>();
export function played(piece: StoredPiece): PieceNote[] {
  let notes = settled.get(piece);
  if (!notes) settled.set(piece, (notes = piece.score ? voices(piece) : settleHands(voices(piece), (n) => !!n.pinned)));
  return notes;
}
// The melody and the bass are picked first, then who plays them.
const levels = new WeakMap<StoredPiece, PieceNote[]>();
function plainLevel(piece: StoredPiece): PieceNote[] {
  const level = levelOf(piece);
  if (level === 'original') return played(piece);
  let notes = levels.get(piece);
  if (!notes) {
    const left = simplify(voices(piece), level);
    const given = settleHands(left);
    notes = given === left ? left : oneByOne(given);
    levels.set(piece, notes);
  }
  return notes;
}

// The notes of the piece's level, as listened to.
export function levelNotes(piece: StoredPiece): PieceNote[] {
  const level = levelOf(piece);
  return level === 'original' ? played(piece) : applyEdit(plainLevel(piece), piece.edits?.[level], trackOn(piece));
}

// Parts start on a beat: when they all agree, they tell where the beats of a
// piece that does not start on one are.
function onParts(grid: BeatGrid, piece: StoredPiece): BeatGrid {
  if (!piece.bpm || grid.beats.length !== 2) return grid;
  const off = (piece.sections ?? []).slice(1).map((s) => grid.toBeats(s.start));
  if (!off.length) return grid;
  const late = off[0] - Math.floor(off[0]);
  const same = off.every((b) => Math.abs(b - late - Math.round(b - late)) < 0.02);
  if (!same || late < 0.02 || late > 0.98) return grid;
  return BeatGrid.regular(grid.toTime(late - 1), grid.beats[1] - grid.beats[0]);
}

// Each level has its own numbers: hands do not play the same keys.
const ofLevel = (piece: StoredPiece) => (n: PieceNumber) => (n.level ?? 'original') === levelOf(piece);
export const numbersAt = (piece: StoredPiece): PieceNumber[] =>
  (piece.numbers ?? []).filter(ofLevel(piece)).map(({ label, hand, midi, number }) => ({ label, hand, midi, number }));
// All of them, with those of this level changed.
export function withNumbers(piece: StoredPiece, numbers: PieceNumber[]): PieceNumber[] {
  const level = levelOf(piece);
  return [
    ...(piece.numbers ?? []).filter((n) => !ofLevel(piece)(n)),
    ...(level === 'original' ? numbers : numbers.map((n) => ({ ...n, level }))),
  ];
}

// Beats and parts. They come from the original notes: the same at every level.
export interface Layout {
  grid: BeatGrid;
  sections: Section[];
  duration: number;
  given: Given;
}

export function layoutOf(piece: StoredPiece): Layout {
  const base = tracksOn(piece);
  if (piece.score) {
    const { sections, duration } = renderScore(piece.score);
    return { grid: BeatGrid.regular(0, 60 / piece.score.bpm), sections: fromSaved(sections, duration), duration, given: givenByScore(piece.score) };
  }
  const duration = pieceDuration(piece.notes);
  const found = beatGrid(base, piece.bpm);
  const grid = found ?? BeatGrid.regular(base[0]?.time ?? 0, 0.5);
  const given = givenByOwner(numbersAt(piece));
  if (piece.sections) return { grid: onParts(grid, piece), sections: fromSaved(piece.sections, duration), duration, given };
  const auto = detectSections(base, piece.bpm, found);
  return { grid, sections: auto.length ? auto : [{ start: 0, end: duration, label: 'A' }], duration, given };
}

export const numbersOf = (notes: PieceNote[], { grid, sections, given }: Layout, division?: number): NumberedPiece =>
  numberPiece(notes, sections, grid, division ? { ...given, division } : given);

// Where it is worth playing: not the silences around the notes heard. Those of
// a piece written by hand are wanted.
export const playedSpan = (piece: StoredPiece, notes: PieceNote[], duration: number): [number, number] =>
  (piece.score || !notes.length ? [0, duration] : soundingSpan(notes));

// --- Changing notes -----------------------------------------------------------------

// What an editor works on: the piece's own notes, hidden tracks included, at
// the original level; what the level shows at the others.
// Hands stay put while editing.
export function editable(piece: StoredPiece): PieceNote[] {
  if (levelOf(piece) !== 'original') return levelNotes(piece);
  const on = tracksOn(piece);
  const withHands = played(piece);
  const given = new Map(on.map((n, i) => [n, withHands[i]]));
  return piece.notes.map((n) => given.get(n) ?? n);
}
export const visible = (piece: StoredPiece, edited: PieceNote[]) => (levelOf(piece) === 'original' ? tracksOn(piece, edited) : edited);
// The level without the changes made to it.
export const untouched = (piece: StoredPiece) => (levelOf(piece) === 'original' ? piece.notes : plainLevel(piece));

// `bpm`: the tempo changed with the notes.
export type PieceChange = { bpm?: number; notes?: PieceNote[]; sections?: PieceSection[] | null; edits?: PieceEdits | null; lyrics?: LyricLine[] | null };

// What saving the edited notes changes in the piece.
export function changeOf(piece: StoredPiece, edited: PieceNote[]): PieceChange {
  const level = levelOf(piece);
  if (level !== 'original') {
    const edits: PieceEdits = { ...piece.edits };
    const edit = editOf(plainLevel(piece), edited, edits[level], trackOn(piece));
    if (edit) edits[level] = edit;
    else delete edits[level];
    return { edits: Object.keys(edits).length ? edits : null };
  }
  // No silence is left at the start.
  const trimmed = trimSilence({ notes: edited, sections: piece.sections, edits: piece.edits, lyrics: piece.lyrics });
  if (trimmed.notes === edited) return { notes: edited };
  return {
    notes: trimmed.notes,
    ...(piece.sections ? { sections: trimmed.sections } : {}),
    ...(piece.edits ? { edits: trimmed.edits } : {}),
    ...(piece.lyrics ? { lyrics: trimmed.lyrics } : {}),
  };
}
