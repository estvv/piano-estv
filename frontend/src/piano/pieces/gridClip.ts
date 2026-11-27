import type { Hand, PieceNote } from '@piano/shared';
import type { BeatGrid } from './grid';
import type { Part, Step } from './numbers';

// Cutting, copying and pasting cells of a part's grid. The clip is in beats:
// it can be pasted in another part, another hand or a finer grid.

export interface Range {
  from: number; // columns, both included
  to: number;
  hands: Hand[];
}

export interface Clip {
  beats: number;
  hands: Hand[];
  notes: { hand: Hand; at: number; held: number; midi: number; velocity: number }[];
}

export interface Corner {
  hand: Hand;
  step: number;
}

export function rangeOf(a: Corner, b: Corner): Range {
  return { from: Math.min(a.step, b.step), to: Math.max(a.step, b.step), hands: a.hand === b.hand ? [a.hand] : ['left', 'right'] };
}

export const inRange = (range: Range | null, hand: Hand, step: number) =>
  !!range && step >= range.from && step <= range.to && range.hands.includes(hand);

function stepsIn(part: Part, range: Range): { hand: Hand; step: Step }[] {
  return part.rows.flatMap((row) => row.steps.filter((s) => inRange(range, row.hand, s.step)).map((step) => ({ hand: row.hand, step })));
}

export function copyRange(part: Part, grid: BeatGrid, range: Range): Clip {
  const start = part.beat + range.from / part.division;
  return {
    beats: (range.to - range.from + 1) / part.division,
    hands: range.hands,
    notes: stepsIn(part, range).flatMap(({ hand, step }) => step.notes.map((n) => ({
      hand,
      // As loosely as it was played.
      at: grid.toBeats(n.time) - start,
      held: grid.toBeats(n.time + n.duration) - grid.toBeats(n.time),
      midi: n.midi,
      velocity: n.velocity,
    }))),
  };
}

export function clearRange(notes: PieceNote[], part: Part, range: Range): PieceNote[] {
  const gone = new Set(stepsIn(part, range).flatMap(({ step }) => step.notes));
  return gone.size ? notes.filter((n) => !gone.has(n)) : notes;
}

// Where a clip goes: one hand follows the cell picked, two stay in place.
export function targetOf(clip: Clip, part: Part, at: Corner): Range {
  return {
    from: at.step,
    to: Math.min(part.columns - 1, at.step + Math.max(1, Math.round(clip.beats * part.division)) - 1),
    hands: clip.hands.length === 1 ? [at.hand] : clip.hands,
  };
}

// Takes the place of what was there. What would go past the part is left out.
export function pasteClip(notes: PieceNote[], part: Part, grid: BeatGrid, clip: Clip, at: Corner, track?: number): PieceNote[] {
  const target = targetOf(clip, part, at);
  const start = part.beat + at.step / part.division;
  const end = part.beat + part.columns / part.division - 1 / (2 * part.division);
  const added = clip.notes.flatMap((c): PieceNote[] => {
    const beat = start + c.at;
    if (beat >= end) return [];
    const time = Math.max(0, grid.toTime(beat));
    return [{
      midi: c.midi, time, duration: Math.max(0.05, grid.toTime(beat + c.held) - time), velocity: c.velocity,
      hand: clip.hands.length === 1 ? at.hand : c.hand, pinned: true, ...(track === undefined ? {} : { track }),
    }];
  });
  return [...clearRange(notes, part, target), ...added].sort((a, b) => a.time - b.time || a.midi - b.midi);
}
