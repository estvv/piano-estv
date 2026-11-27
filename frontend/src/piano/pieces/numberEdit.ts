import type { Hand, PieceNote } from '@piano/shared';
import type { BeatGrid } from './grid';
import type { Part } from './numbers';

// Changing an imported piece through its numbers: what one hand plays in one
// column. The notes kept do not move by a hair; new ones land with the other
// hand's, or on the grid.

const VELOCITY = 0.7;
const MIN_DURATION = 0.05;

export function setStep(notes: PieceNote[], part: Part, grid: BeatGrid, hand: Hand, step: number, midis: number[], track?: number): PieceNote[] {
  const steps = part.rows.find((r) => r.hand === hand)?.steps ?? [];
  const here = steps.find((s) => s.step === step);
  const wanted = new Set(midis);
  const gone = new Set(here?.notes.filter((n) => !wanted.has(n.midi)));
  const had = new Set(here?.notes.map((n) => n.midi));
  const added = [...wanted].filter((m) => !had.has(m));
  if (!gone.size && !added.length) return notes;

  const at = part.beat + step / part.division;
  // Played with what the other hand plays in that column, not on the grid: the
  // notes of a recording are a hair early or late.
  const along = part.rows.filter((r) => r.hand !== hand).flatMap((r) => r.steps).find((s) => s.step === step);
  const time = Math.max(0, here?.time ?? along?.time ?? grid.toTime(at));
  const beat = grid.toTime(at + 1) - grid.toTime(at);
  const next = steps.find((s) => s.step > step)?.time ?? Infinity;
  const duration = Math.max(MIN_DURATION, here ? here.end - here.time : Math.min(along ? along.end - along.time : beat, (next - time) * 0.95));
  const like = here?.notes[0];
  return [
    ...notes.filter((n) => !gone.has(n)),
    ...added.map((midi): PieceNote => {
      const t = like ? like.track : track;
      return { midi, time, duration, velocity: like?.velocity ?? VELOCITY, hand, pinned: true, ...(t === undefined ? {} : { track: t }) };
    }),
  ].sort((a, b) => a.time - b.time || a.midi - b.midi);
}
