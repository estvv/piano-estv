import { pieceDuration, renderScore, type PieceNote } from '@piano/shared';
import { changeFrom, openPiece, renderImported, renderPlain, type Rendering } from './importedScore';
import { movedLyrics } from './lyrics';
import { copyOf, type PieceCopy } from './pieceCopy';
import type { StoredPiece } from './types';

// A new piece made of some of the parts of another, in any order.

export interface Cuttable {
  // As they are played: a letter that comes back in an imported piece has a name
  // of its own (A2), that of a piece written by hand is the same part again.
  parts: { label: string; start: number; end: number }[];
  notes: PieceNote[];
  duration: number;
  // Takes places in `parts`.
  take(places: number[]): PieceCopy;
}

export function cuttable(piece: StoredPiece): Cuttable {
  const { score } = piece;
  // Cut at its original level: the changes made to the others follow.
  const source = score ? null : openPiece({ ...piece, level: 'original' });
  const whole = score ?? source!.score;
  const rendered: Rendering = source ? renderImported(source, whole) : renderPlain(whole);
  const parts = rendered.spans.map(({ label, start, end }) => ({ label, start: Math.max(0, start), end }));
  const take = (places: number[]): PieceCopy => {
    const order = places.map((i) => whole.order[i]);
    const used = { ...whole, order, parts: whole.parts.filter((p) => order.includes(p.label)) };
    const copy = copyOf(piece);
    if (!source) {
      const lyrics = piece.lyrics && movedLyrics(piece.lyrics, rendered.spans, renderPlain(used).spans, 1, (i) => places[i]);
      return { ...copy, score: used, piece: { ...copy.piece, notes: renderScore(used).notes }, sections: null, edits: null, lyrics: lyrics?.length ? lyrics : null };
    }
    const { notes: change, numbers } = changeFrom(source, used);
    return {
      ...copy,
      // Too few notes may be left to find the tempo in.
      piece: { ...copy.piece, bpm: piece.bpm ?? 60 / source.beat, notes: change?.notes ?? copy.piece.notes },
      sections: change ? change.sections ?? null : copy.sections,
      edits: change ? change.edits ?? null : copy.edits,
      numbers: numbers ?? copy.numbers,
      lyrics: change ? change.lyrics ?? null : copy.lyrics,
    };
  };
  return { parts, notes: rendered.notes, duration: Math.max(rendered.duration, pieceDuration(rendered.notes)), take };
}

// Picked or not. In the order of the piece as long as nothing else was asked.
export function toggled(places: number[], place: number): number[] {
  if (places.includes(place)) return places.filter((p) => p !== place);
  const inOrder = places.every((p, i) => i === 0 || p > places[i - 1]);
  return inOrder ? [...places, place].sort((a, b) => a - b) : [...places, place];
}
