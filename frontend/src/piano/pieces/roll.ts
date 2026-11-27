import type { Score, ScoreNote, ScorePart } from '@piano/shared';
import type { FromPiece } from './importedScore';
import { addNotes, HANDS, partOf, removeNote, withKeys } from './score';

// The parts one after the other, as a single sheet. Places are in columns, from
// the start of a part or of the piece.

// A note, in the part played `index`-th.
export interface Placed {
  index: number;
  note: ScoreNote;
}

// Parts as they are played, then those that are not.
export const sheetOf = (score: Score): ScorePart[] => [
  ...score.order.map((l) => partOf(score, l)),
  ...score.parts.filter((p) => !score.order.includes(p.label)),
];

// Where each part starts, then the end.
export function offsetsOf(parts: ScorePart[], division: number): number[] {
  const out = [0];
  for (const p of parts) out.push(out[out.length - 1] + p.beats * division);
  return out;
}

// After the end: in the last part.
export function locate(offsets: number[], at: number): { index: number; step: number } {
  let index = 0;
  while (index + 2 < offsets.length && at >= offsets[index + 1]) index++;
  return { index, step: at - offsets[index] };
}

// From one place to another, in another part or not.
export function moveNote(score: Score, from: Placed, to: Placed): Score {
  const parts = sheetOf(score);
  return addNotes(removeNote(score, parts[from.index].label, from.note), parts[to.index].label, [to.note]);
}

// What was written past the end of a part goes on in the next ones, instead of
// making it longer.
export function spill(before: Score, after: Score, index: number): Score {
  const parts = sheetOf(before);
  const part = parts[index];
  const now = partOf(after, part.label);
  if (index + 1 >= parts.length || now.beats <= part.beats || before.division !== after.division) return after;
  const offsets = offsetsOf(parts, before.division);
  const end = part.beats * before.division;
  let out: Score = {
    ...after,
    parts: after.parts.map((p) => (p.label === part.label ? { ...p, beats: part.beats, notes: p.notes.filter((n) => n.step < end) } : p)),
  };
  for (const n of now.notes) {
    if (n.step < end) continue;
    const there = locate(offsets, offsets[index] + n.step);
    out = addNotes(out, parts[there.index].label, [{ ...n, step: there.step }]);
  }
  return out;
}

// --- Where a part starts ------------------------------------------------------------

// A note a hair early belongs to the part it opens (beats).
const EARLY = 1 / 8;

// How many beats earlier and later the `index`-th part can start, taking them
// from the part before it or giving them to it. Null: one of them is played
// elsewhere too.
export function edgeRange(score: Score, index: number): [number, number] | null {
  if (index < 1 || index >= score.order.length) return null;
  const [before, after] = [score.order[index - 1], score.order[index]];
  if (before === after || score.order.some((l, i) => (l === before && i !== index - 1) || (l === after && i !== index))) return null;
  return [1 - partOf(score, before).beats, partOf(score, after).beats - 1];
}

// Nothing is heard differently: notes only change part.
export function moveEdge(score: Score, index: number, by: number): Score {
  const range = edgeRange(score, index);
  const beats = range && Math.max(range[0], Math.min(range[1], Math.round(by)));
  if (!beats) return score;
  const before = partOf(score, score.order[index - 1]);
  const after = partOf(score, score.order[index]);
  const start = before.beats * score.division;
  const edge = (before.beats + beats) * score.division;
  // From the start of the first of them.
  const all = [...before.notes, ...after.notes.map((n) => ({ ...n, step: n.step + start }))];
  const early = (n: ScoreNote) => n.step < edge - EARLY * score.division;
  const numbered = (p: ScorePart) => HANDS.reduce((q, hand) => withKeys(q, hand, p.notes.filter((n) => n.hand === hand).map((n) => n.midi)), p);
  const parts = score.parts.map((p) => {
    if (p === before) return numbered({ ...withOrigin(p, 0, beats), beats: p.beats + beats, notes: all.filter(early) });
    if (p === after) return numbered({ ...withOrigin(p, beats, -beats), beats: p.beats - beats, notes: all.filter((n) => !early(n)).map((n) => ({ ...n, step: n.step - edge })) });
    return p;
  });
  return { ...score, parts };
}

// Parts of an imported piece know where they come from (importedScore.ts).
function withOrigin(p: FromPiece, start: number, longer: number): FromPiece {
  return p.origin ? { ...p, origin: { ...p.origin, beat: p.origin.beat + start, beats: p.origin.beats + longer } } : p;
}
