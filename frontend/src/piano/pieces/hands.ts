import type { Hand, PieceNote } from '@piano/shared';
import { CHORD_WINDOW } from './grid';

// Who plays what. Many files do not say (one track, transcriptions) or say it
// wrong. The notes are given to the hands the way they can be played: what a
// hand can reach, how far it has to move, the left one below the right one.
// Follows several possibilities at once (beam search) and keeps the easiest.

const BEAM = 48;
// What makes a hand's life hard. Set on pieces whose hands are known.
const COST = { register: 0.08, move: 0.02, jump: 0.006, held: 1, first: 0.8, swap: 0.5, cross: 0.7 };
// Windows the register of both hands is measured on, seconds.
const WINDOW = 3;
// A hand plays alone what it can cover.
const ONE_HAND = 14;

interface HandState {
  center: number | null;
  time: number;
  held: { midi: number; end: number }[];
}

interface State {
  cost: number;
  left: HandState;
  right: HandState;
  // Hands given to the group, and the state before.
  given: Hand[];
  from: State | null;
}

const IDLE: HandState = { center: null, time: 0, held: [] };

// What stretching over so many semitones costs.
function spanCost(width: number): number {
  if (width <= 10) return 0;
  if (width <= 12) return (width - 10) * 0.2;
  if (width <= 16) return 0.4 + (width - 12) * 1.1;
  return 4.8 + (width - 16) * 1.5;
}

const lowest = (list: { midi: number }[]) => list.reduce((m, n) => Math.min(m, n.midi), Infinity);
const highest = (list: { midi: number }[]) => list.reduce((m, n) => Math.max(m, n.midi), -Infinity);

// Notes with their hand. Those `fixed` keep theirs.
export function assignHands(notes: PieceNote[], fixed: (n: PieceNote) => boolean = () => false): PieceNote[] {
  if (!notes.length) return notes;
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const groups: PieceNote[][] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && n.time - last[0].time <= CHORD_WINDOW) last.push(n);
    else groups.push([n]);
  }
  for (const g of groups) g.sort((a, b) => a.midi - b.midi);
  const middles = registerMiddles(sorted, groups);

  let beam: State[] = [{ cost: 0, left: IDLE, right: IDLE, given: [], from: null }];
  groups.forEach((group, i) => {
    const time = group[0].time;
    const choices = splits(group, fixed);
    const next: State[] = [];
    for (const state of beam) {
      const left = released(state.left, time);
      const right = released(state.right, time);
      for (const given of choices) {
        const l = play(left, group.filter((_, k) => given[k] === 'left'), time);
        const r = play(right, group.filter((_, k) => given[k] === 'right'), time);
        const cost = state.cost + l.cost + r.cost
          + COST.register * registerCost(l.state, r.state, middles[i], time)
          + crossing(l.state, r.state)
          + (swapped(state.given, given) ? COST.swap : 0);
        next.push({ cost, left: l.state, right: r.state, given, from: state });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    // Possibilities that lead to the same place: the easiest one is enough.
    const seen = new Set<string>();
    beam = [];
    for (const s of next) {
      const key = `${place(s.left)}/${place(s.right)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(s);
      if (beam.length === BEAM) break;
    }
  });

  const hands = new Map<PieceNote, Hand>();
  let state: State | null = beam[0];
  for (let i = groups.length - 1; i >= 0 && state; i--) {
    const { given }: State = state;
    groups[i].forEach((n, k) => hands.set(n, given[k]));
    state = state.from;
  }
  return notes.map((n) => {
    const hand = hands.get(n) ?? n.hand;
    return hand === n.hand ? n : { ...n, hand };
  });
}

const alone = (given: Hand[]) => (given.length && given.every((h) => h === given[0]) ? given[0] : null);
// One hand, then the other: a line is rarely shared.
function swapped(before: Hand[], now: Hand[]): boolean {
  const [a, b] = [alone(before), alone(now)];
  return a !== null && b !== null && a !== b;
}

const place = (h: HandState) => `${h.center === null ? '-' : Math.round(h.center)}:${h.held.map((n) => n.midi).join(',')}`;

// Every way to give the lower notes to the left hand, the others to the right.
function splits(group: PieceNote[], fixed: (n: PieceNote) => boolean): Hand[][] {
  const out = new Map<string, Hand[]>();
  for (let k = 0; k <= group.length; k++) {
    const given = group.map((n, i): Hand => (n.hand && fixed(n) ? n.hand : i < k ? 'left' : 'right'));
    out.set(given.join(), given);
  }
  return [...out.values()];
}

const released = (h: HandState, time: number): HandState =>
  (h.held.some((n) => n.end <= time + 0.03) ? { ...h, held: h.held.filter((n) => n.end > time + 0.03) } : h);

function play(hand: HandState, notes: PieceNote[], time: number): { state: HandState; cost: number } {
  if (!notes.length) return { state: hand, cost: 0 };
  const [lo, hi] = [notes[0].midi, notes[notes.length - 1].midi];
  let cost = spanCost(hi - lo) + Math.max(0, notes.length - 5) * 4;
  // Keys still down: pedals make them look longer than they are.
  if (hand.held.length) {
    cost += COST.held * spanCost(Math.max(hi, highest(hand.held)) - Math.min(lo, lowest(hand.held)));
  }
  const center = (lo + hi) / 2;
  // A second hand comes in for a reason.
  if (hand.center === null) cost += COST.first;
  else {
    const gap = Math.max(0.08, time - hand.time);
    const far = Math.abs(center - hand.center);
    cost += (COST.move * far) / (1 + 1.5 * gap) + (COST.jump * Math.max(0, far - 6)) / gap;
  }
  const held = [...hand.held.filter((h) => notes.every((n) => n.midi !== h.midi)), ...notes.map((n) => ({ midi: n.midi, end: n.time + n.duration }))]
    .sort((a, b) => a.midi - b.midi);
  return { state: { center, time, held }, cost };
}

// Each hand on its side of the music.
function registerCost(left: HandState, right: HandState, middle: number, time: number): number {
  let cost = 0;
  if (left.center !== null && left.time === time) cost += Math.max(0, left.center - middle);
  if (right.center !== null && right.time === time) cost += Math.max(0, middle - right.center);
  return cost;
}

function crossing(left: HandState, right: HandState): number {
  if (!left.held.length || !right.held.length) return 0;
  const over = highest(left.held) - lowest(right.held);
  return over < 0 ? 0 : COST.cross + 0.1 * over;
}

// Where the middle between the hands is, for each group: halfway between the
// lowest and the highest notes around it. Where one hand could play everything
// alone (a melody, a bass line), that of the rest of the piece.
function registerMiddles(sorted: PieceNote[], groups: PieceNote[][]): number[] {
  let from = 0;
  let to = 0;
  const local = groups.map((g) => {
    const t = g[0].time;
    while (sorted[from].time < t - WINDOW) from++;
    while (to < sorted.length && sorted[to].time <= t + WINDOW) to++;
    const around = sorted.slice(from, to);
    const [lo, hi] = [lowest(around), highest(around)];
    return hi - lo > ONE_HAND ? (lo + hi) / 2 : null;
  });
  const known = local.filter((m) => m !== null).sort((a, b) => a - b);
  const usual = known.length ? known[known.length >> 1] : 60;
  return local.map((m) => m ?? usual);
}

// --- What the file says -----------------------------------------------------------

// A hand cannot reach further.
const REACH = 16;
// Share of impossible chords that makes a file wrong.
const WRONG = 0.04;

// Whether the hands written in the notes can be believed: both are used, they
// are not a mere cut at middle C, and they can be played. `byTrack`: each hand
// has its own track, so a cut at middle C is no accident.
export function credible(notes: PieceNote[], byTrack = false): boolean {
  const left = notes.filter((n) => n.hand === 'left');
  const right = notes.filter((n) => n.hand === 'right');
  if (!left.length || !right.length) return false;
  if (!byTrack && notes.every((n) => n.hand === null || n.pinned || (n.hand === 'right') === n.midi >= 60)) return false;
  let chords = 0;
  let impossible = 0;
  for (const hand of [left, right]) {
    const sorted = [...hand].sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (j < sorted.length && sorted[j].time - sorted[i].time <= CHORD_WINDOW) j++;
      const chord = sorted.slice(i, j);
      chords++;
      if (highest(chord) - lowest(chord) > REACH || chord.length > 5) impossible++;
      i = j;
    }
  }
  return impossible <= chords * WRONG;
}
