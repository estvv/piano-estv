import type { Hand, Piece, PieceNote, Score } from '@piano/shared';
import { beatGrid } from './grid';
import type { Imported } from './importedScore';
import { setDivision } from './score';

// Notes put on the grid: those of a video or a recording start and stop a hair
// early or late, so does a piece that follows no steady tempo.

// Just short of the next note, as in renderScore.
const LENGTH = 0.95;
// Notes this close are played together (beats).
const TOGETHER = 0.1;
// Halves of a beat will do when nearly all notes are on them.
const HALVES = 0.98;
const ON_HALF = 0.12;

type Division = Score['division'];

// The columns notes are closest to; places in beats.
export function divisionFor(places: number[]): Division {
  const error = (d: number) => places.reduce((sum, b) => sum + Math.abs(b * d - Math.round(b * d)), 0);
  const halves = places.filter((b) => Math.abs(b * 2 - Math.round(b * 2)) / 2 <= ON_HALF).length;
  if (halves >= places.length * HALVES) return 2;
  return error(3) < error(4) ? 3 : 4;
}

interface Item { at: number; length: number; midi: number; hand: Hand | null }

// Columns, for places and lengths in columns. Null: two notes became one.
export function snapItems(items: Item[], division: number): ({ at: number; length: number } | null)[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].at - items[b].at);
  const out = items.map((): { at: number; length: number } | null => null);
  // Notes played together stay together.
  for (let i = 0; i < order.length;) {
    let end = i + 1;
    while (end < order.length && items[order[end]].at - items[order[i]].at <= TOGETHER * division) end++;
    const group = order.slice(i, end);
    const at = Math.round(group.reduce((sum, k) => sum + items[k].at, 0) / group.length);
    for (const k of group) out[k] = { at, length: Math.max(1, Math.round(items[k].at + items[k].length) - at) };
    i = end;
  }
  // A key stops when it is played again.
  const next = new Map<string, number>();
  for (const k of [...order].reverse()) {
    const own = out[k]!;
    const key = `${items[k].hand}${items[k].midi}`;
    const again = next.get(key);
    if (again === own.at) {
      out[k] = null;
      continue;
    }
    if (again !== undefined) own.length = Math.min(own.length, again - own.at);
    next.set(key, own.at);
  }
  return out;
}

// Every note of the piece in the editor. Its tempo becomes steady.
export function snapScore(score: Score): Score {
  const division = divisionFor(score.parts.flatMap((p) => p.notes.map((n) => n.step / score.division)));
  const exact = setDivision(score, division, true);
  const even: Imported['score'] = {
    ...exact,
    even: true,
    parts: exact.parts.map((p) => {
      const last = p.beats * division - 1;
      const places = snapItems(p.notes.map((n) => ({ at: Math.min(last, Math.max(0, n.step)), length: n.length ?? 1, midi: n.midi, hand: n.hand })), division);
      return {
        ...p,
        notes: p.notes.flatMap((n, i) => {
          const at = places[i];
          return at ? [{ ...n, step: at.at, ...(n.length === undefined ? {} : { length: at.length }) }] : [];
        }),
      };
    }),
  };
  return even;
}

const whole = (n: number) => Math.abs(n - Math.round(n)) < 0.01;
export const offGrid = (score: Score): boolean =>
  score.parts.some((p) => p.notes.some((n) => !whole(n.step) || (n.length !== undefined && !whole(n.length))));

// A piece being imported. One with too little to find a beat in stays as it is.
export function snapPiece<T extends Pick<Piece, 'notes' | 'bpm'>>(piece: T): T {
  const grid = beatGrid(piece.notes, piece.bpm);
  if (!grid) return piece;
  const onsets = piece.notes.map((n) => grid.toBeats(n.time));
  const division = divisionFor(onsets);
  const { beats } = grid;
  const followed = Math.round((600 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0])) / 10;
  const bpm = beats.length === 2 && piece.bpm ? piece.bpm : followed;
  const column = 60 / bpm / division;
  const places = snapItems(piece.notes.map((n, i) => ({
    at: onsets[i] * division, length: (grid.toBeats(n.time + n.duration) - onsets[i]) * division, midi: n.midi, hand: n.hand,
  })), division);
  const first = places.reduce((min, p) => (p ? Math.min(min, p.at) : min), Infinity);
  const notes = piece.notes.flatMap((n, i): PieceNote[] => {
    const p = places[i];
    return p ? [{ ...n, time: (p.at - first) * column, duration: p.length * column * LENGTH }] : [];
  });
  return { ...piece, bpm, notes };
}
