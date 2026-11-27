import type { PieceLevelEdit, PieceNote } from '@piano/shared';

// Changes made by hand to an easier level (simplified, melody): what is taken
// away from the level worked out from the piece, and what is added to it. Kept
// apart, so the piece itself and the other levels do not change.

type On = (track: number | undefined) => boolean;

const at = (n: { midi: number; time: number }) => `${n.midi}@${n.time.toFixed(3)}`;
const same = (n: PieceNote) => `${at(n)}${n.hand}`;

export function applyEdit(level: PieceNote[], edit: PieceLevelEdit | undefined, on: On): PieceNote[] {
  if (!edit) return level;
  const removed = new Set(edit.removed.map(at));
  return [...level.filter((n) => !removed.has(at(n))), ...edit.added.filter((n) => on(n.track))]
    .sort((a, b) => a.time - b.time || a.midi - b.midi);
}

// From the level as worked out to the notes wanted. What was decided about the
// tracks that are off now stays.
export function editOf(level: PieceNote[], wanted: PieceNote[], old: PieceLevelEdit | undefined, on: On): PieceLevelEdit | undefined {
  const before = new Set(level.map(same));
  const after = new Set(wanted.map(same));
  const here = new Set(level.map(at));
  const removed = [
    ...level.filter((n) => !after.has(same(n))).map(({ midi, time }) => ({ midi, time })),
    ...(old?.removed.filter((r) => !here.has(at(r))) ?? []),
  ];
  const added = [...wanted.filter((n) => !before.has(same(n))), ...(old?.added.filter((n) => !on(n.track)) ?? [])];
  return removed.length || added.length ? { removed, added } : undefined;
}
