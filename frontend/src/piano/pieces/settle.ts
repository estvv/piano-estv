import type { Hand, PieceNote } from '@piano/shared';
import { CHORD_WINDOW } from './grid';
import { handOf } from './simplify';

// Who really plays what. Each note has a hand already, given by the file or worked
// out (hands.ts): it is where one starts from, not the law. What counts is what
// two hands can do, whatever the piece:
// - a hand reaches so far, and needs time to go further;
// - a finger on a key strikes it again for nothing;
// - hands do not cross, nor step on each other;
// - a line is not cut for nothing, least of all between neighbouring keys;
// - a hand helps the other one if it has the time.
// Several possibilities are followed at once (beam search), the easiest is kept.

const BEAM = 40;

const COST = {
  // Semitones away from where the hand is, beyond its reach, over the time there is.
  reach: 7,
  jump: 0.05,
  // A line given to the other hand, or back; up to that much more between
  // neighbouring keys.
  change: 0.4,
  beside: 1,
  // Each note away from its hand; more when the other one has its own to play
  // within a second.
  away: 0.05,
  busy: 0.8,
  // The left hand above the right one, or a key inside the other hand's.
  over: 3,
  inside: 0.7,
  // More notes than fingers.
  crowd: 4,
  // Of what is wider than a hand, when the file has it played so.
  known: 0.2,
  // Of what is struck one after the other rather than at once: the hand rolls, the
  // pedal holds.
  rolled: 0.3,
};
// Just released, a key is still under the finger (seconds).
const UNDER = 0.25;
// A hand that played this long ago is not in the way.
const THERE = 1;
const SOON = 1;
// A hand cannot reach further, rolled chords and all.
const WIDEST = 16;

// What stretching over so many semitones costs.
function stretch(width: number): number {
  if (width <= 10) return 0;
  if (width <= 12) return (width - 10) * 0.2;
  if (width <= 16) return 0.4 + (width - 12) * 1.1;
  return 4.8 + (width - 16) * 1.5;
}

interface Pressed { midi: number; end: number }
interface HandState { center: number | null; time: number; keys: Pressed[] }
interface State {
  cost: number;
  left: HandState;
  right: HandState;
  // Who played the last note of each hand's line.
  lines: Record<Hand, Hand>;
  given: Hand[];
  from: State | null;
}

const IDLE: HandState = { center: null, time: 0, keys: [] };
const HANDS: Hand[] = ['left', 'right'];
const other = (h: Hand): Hand => (h === 'left' ? 'right' : 'left');
const low = (list: { midi: number }[]) => list.reduce((m, n) => Math.min(m, n.midi), Infinity);
const high = (list: { midi: number }[]) => list.reduce((m, n) => Math.max(m, n.midi), -Infinity);
const width = (list: { midi: number }[]) => (list.length ? high(list) - low(list) : 0);

// Notes with the hand that plays them. Those `fixed` keep theirs.
export function settleHands(notes: PieceNote[], fixed: (n: PieceNote) => boolean = () => false): PieceNote[] {
  if (!notes.length) return notes;
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const groups: PieceNote[][] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && n.time - last[0].time <= CHORD_WINDOW) last.push(n);
    else groups.push([n]);
  }
  for (const g of groups) g.sort((a, b) => a.midi - b.midi);
  const busy = { left: business(sorted, 'left'), right: business(sorted, 'right') };
  // The last key of each hand's line.
  const last: Partial<Record<Hand, number>> = {};

  let beam: State[] = [{ cost: 0, left: IDLE, right: IDLE, lines: { left: 'left', right: 'right' }, given: [], from: null }];
  for (const group of groups) {
    const time = group[0].time;
    const homes = group.map(handOf);
    const choices = ways(group, homes, fixed);
    const next: State[] = [];
    for (const state of beam) {
      const before = { left: under(state.left, time), right: under(state.right, time) };
      for (const given of choices) {
        let cost = state.cost;
        const after = {} as Record<Hand, HandState>;
        for (const hand of HANDS) {
          const own = group.filter((_, k) => given[k] === hand);
          const known = own.length > 0 && group.every((_, k) => given[k] !== hand || homes[k] === hand);
          const played = strike(before[hand], own, time, known);
          after[hand] = played.state;
          cost += played.cost;
        }
        const lines = { ...state.lines };
        group.forEach((n, k) => {
          const hand = given[k];
          const home = homes[k];
          const there = before[hand].keys.some((p) => p.midi === n.midi);
          if (hand !== home) cost += COST.away + (there ? 0 : COST.busy * busy[hand](time));
          // A finger already on it: the line has not gone anywhere.
          if (!(there && hand !== home)) {
            if (lines[home] !== hand) cost += COST.change + COST.beside * Math.max(0, 1 - Math.abs(n.midi - (last[home] ?? n.midi)) / COST.reach);
            lines[home] = hand;
          }
          const theirs = before[other(hand)].keys;
          if (theirs.length) {
            const into = hand === 'right' ? high(theirs) - n.midi : n.midi - low(theirs);
            if (into >= 0) cost += COST.inside + 0.1 * Math.min(12, into);
          }
        });
        if (crossed(after.left, after.right, time)) cost += COST.over;
        next.push({ cost, left: after.left, right: after.right, lines, given, from: state });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    // Possibilities that lead to the same place: the easiest one is enough.
    const seen = new Set<string>();
    beam = [];
    for (const s of next) {
      const key = `${place(s.left)}/${place(s.right)}/${s.lines.left}${s.lines.right}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(s);
      if (beam.length === BEAM) break;
    }
    for (const [k, n] of group.entries()) last[homes[k]] = n.midi;
  }

  const hands = new Map<PieceNote, Hand>();
  let state: State | null = beam[0];
  for (let i = groups.length - 1; i >= 0 && state; i--) {
    const { given }: State = state;
    groups[i].forEach((n, k) => hands.set(n, given[k]));
    state = state.from;
  }
  if (notes.every((n) => hands.get(n) === n.hand)) return notes;
  return notes.map((n) => (hands.get(n) === n.hand ? n : { ...n, hand: hands.get(n)! }));
}

const place = (h: HandState) => `${h.center === null ? '-' : Math.round(h.center)}:${h.keys.map((n) => n.midi).join(',')}`;

// As given, or the lower notes to the left hand and the others to the right.
function ways(group: PieceNote[], homes: Hand[], fixed: (n: PieceNote) => boolean): Hand[][] {
  const out = new Map<string, Hand[]>([[homes.join(), homes]]);
  for (let k = 0; k <= group.length; k++) {
    const given = group.map((n, i): Hand => (fixed(n) ? homes[i] : i < k ? 'left' : 'right'));
    out.set(given.join(), given);
  }
  return [...out.values()];
}

const under = (h: HandState, time: number): HandState =>
  (h.keys.some((k) => k.end <= time - UNDER) ? { ...h, keys: h.keys.filter((k) => k.end > time - UNDER) } : h);

// `known`: all of it is this hand's in the file, which somebody plays.
function strike(hand: HandState, notes: PieceNote[], time: number, known: boolean): { state: HandState; cost: number } {
  if (!notes.length) return { state: hand, cost: 0 };
  let cost = Math.max(0, notes.length - 5) * COST.crowd;
  const span = width(notes);
  const usual = (w: number) => (known && w <= WIDEST ? COST.known : 1);
  cost += stretch(span) * usual(span);
  // Keys still down, not those just let go.
  const down = hand.keys.filter((k) => k.end > time + 0.03);
  const whole = width([...down, ...notes]);
  cost += Math.max(0, stretch(whole) - Math.max(stretch(span), stretch(width(hand.keys)))) * usual(whole) * COST.rolled;
  // Where the hand is: over all it holds, as far as it can.
  const held = whole <= WIDEST ? [...down, ...notes] : notes;
  const center = (low(held) + high(held)) / 2;
  // Held in place by other keys, it stretches (above) rather than moves.
  if (hand.center !== null && !down.some((k) => notes.every((n) => n.midi !== k.midi))) {
    const far = Math.max(0, Math.abs(center - hand.center) - COST.reach);
    // On the keys it has already: not a move.
    const there = notes.every((n) => hand.keys.some((k) => k.midi === n.midi));
    if (!there) cost += (COST.jump * far) / Math.max(0.08, time - hand.time);
  }
  const keys = [...hand.keys.filter((k) => k.end > time && notes.every((n) => n.midi !== k.midi)), ...notes.map((n) => ({ midi: n.midi, end: n.time + n.duration }))]
    .sort((a, b) => a.midi - b.midi);
  return { state: { center, time, keys }, cost };
}

const crossed = (left: HandState, right: HandState, time: number) =>
  left.center !== null && right.center !== null && left.center > right.center && time - left.time < THERE && time - right.time < THERE;

// How little time a hand has for anything else, 0 to 1, from its own notes around.
function business(sorted: PieceNote[], hand: Hand): (time: number) => number {
  const times = sorted.filter((n) => handOf(n) === hand).map((n) => n.time);
  let i = 0;
  return (time) => {
    // Asked for in order, several times for each time.
    while (i < times.length && times[i] < time) i++;
    while (i > 0 && times[i - 1] >= time) i--;
    const gap = Math.min(times[i] - time || (times[i] === time ? 0 : Infinity), i > 0 ? time - times[i - 1] : Infinity);
    return Math.max(0, Math.min(1, (SOON - gap) / (SOON / 2)));
  };
}
