// Endless shuffled listening: every piece once, in a random order, then again
// in another order.

export interface Queue {
  ids: number[];
  index: number;
  // Grows at each change, even when the same piece comes back.
  turn: number;
}

export function shuffled(ids: number[], random = Math.random): number[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function startQueue(ids: number[], random = Math.random): Queue | null {
  return ids.length ? { ids: shuffled(ids, random), index: 0, turn: 0 } : null;
}

// From the piece already there, which goes on.
export function queueFrom(ids: number[], current: number, turn: number, random = Math.random): Queue {
  return { ids: [current, ...shuffled(ids.filter((id) => id !== current), random)], index: 0, turn };
}

export const currentOf = (q: Queue) => q.ids[q.index];

export function next(q: Queue, random = Math.random): Queue {
  if (q.index + 1 < q.ids.length) return { ...q, index: q.index + 1, turn: q.turn + 1 };
  const ids = shuffled(q.ids, random);
  // Never the same piece twice in a row.
  if (ids.length > 1 && ids[0] === currentOf(q)) ids.push(ids.shift()!);
  return { ids, index: 0, turn: q.turn + 1 };
}

export function previous(q: Queue): Queue {
  return { ...q, index: Math.max(0, q.index - 1), turn: q.turn + 1 };
}

// Without a piece that cannot be played any more (deleted elsewhere).
export function drop(q: Queue, id: number, random = Math.random): Queue | null {
  const at = q.ids.indexOf(id);
  if (at < 0) return q;
  const ids = q.ids.filter((x) => x !== id);
  if (!ids.length) return null;
  const index = at < q.index ? q.index - 1 : q.index;
  if (index >= ids.length) return { ids: shuffled(ids, random), index: 0, turn: q.turn + 1 };
  return { ids, index, turn: at === q.index ? q.turn + 1 : q.turn };
}
