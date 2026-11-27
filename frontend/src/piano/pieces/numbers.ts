import type { Hand, PieceNote, PieceNumber, PieceNumbering, Score } from '@piano/shared';
import { BeatGrid, BEATS_PER_BAR, CHORD_WINDOW } from './grid';
import type { Section } from './sections';
import { handOf } from './simplify';

// A piece written as numbers, to learn it by heart loop after loop. In each
// part and for each hand, the first key pressed is 1, the next new key 2…; a
// key keeps its number when it comes back. Parts with the same letter share
// their numbers.

export interface Step {
  step: number; // column in the part's grid
  time: number; // seconds
  end: number; // when its last note stops
  // Usually one chord; several when the hand is faster than the grid.
  chords: number[][]; // numbers, lowest key first
  notes: PieceNote[];
}

export interface Row {
  hand: Hand;
  steps: Step[];
}

export interface Key {
  hand: Hand;
  midi: number;
  number: number;
}

export interface Part {
  label: string;
  start: number; // seconds
  end: number;
  // Columns per beat, and in the whole part.
  division: number;
  columns: number;
  // First beat, in the piece's grid.
  beat: number;
  // Hands playing in it, left first.
  rows: Row[];
  keys: Key[];
}

export interface NumberedPiece {
  parts: Part[];
  numbers: ReadonlyMap<PieceNote, number>;
}

const HANDS: Hand[] = ['left', 'right'];
const DIVISIONS = [1, 2, 4, 3, 6, 8];
// Share of the notes that must fall on the grid.
const ON_GRID = 0.85;
// Share of the notes on a third of a beat that makes triplets.
const TRIPLETS = 0.25;
// Of a column: notes closer than this in one column are one chord.
const SPREAD = 0.4;

// What is decided beforehand rather than worked out from the notes.
export interface Given {
  division?: number;
  // Per part's letter: the number of the keys already numbered.
  keys?: ReadonlyMap<string, Key[]>;
  // The last part stops at its end instead of after its last note.
  exact?: boolean;
  // How numbers are given (the order by default); `whole`: one count for the
  // whole piece rather than one for each letter.
  numbering?: PieceNumbering;
  whole?: boolean;
}

// The lowest key = 1.
export const FIXED_FROM = 20;

// Pieces written by hand keep the numbers of their owner.
export const givenByScore = (score: Score): Given => ({
  division: score.division,
  keys: new Map(score.parts.map((p) => [p.label, p.keys])),
  exact: true,
});

// Keys the owner has numbered, the others as they come.
export function givenByOwner(own: PieceNumber[]): Given {
  const keys = new Map<string, Key[]>();
  for (const { label, hand, midi, number } of own) keys.set(label, [...(keys.get(label) ?? []), { hand, midi, number }]);
  return { keys };
}

export function numberPiece(notes: PieceNote[], sections: Section[], grid: BeatGrid | null, given: Given = {}): NumberedPiece {
  const numbers = new Map<PieceNote, number>();
  if (!notes.length) return { parts: [], numbers };
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const beats = grid ?? BeatGrid.regular(sorted[0].time, 0.5);
  const spans = sections.length ? sections : [{ start: 0, end: Math.max(...notes.map((n) => n.time + n.duration)), label: 'A' }];
  const firstBeats = spans.map((s, i) => (i === 0 ? 0 : Math.round(beats.toBeats(s.start))));

  // A note a hair early belongs to the part it opens.
  const bySpan: PieceNote[][] = spans.map(() => []);
  let current = 0;
  for (const n of sorted) {
    const at = beats.toBeats(n.time);
    while (current + 1 < spans.length && at >= firstBeats[current + 1] - 1 / 8) current++;
    bySpan[current].push(n);
  }

  const numbering = given.numbering ?? 'order';
  // The owner's numbers are for the usual way only.
  const own = numbering === 'order' && !given.whole ? given.keys : undefined;
  const scopeOf = (label: string, hand: Hand) => `${given.whole ? '*' : label} ${hand}`;
  // From the lowest key: every key of the scope is known beforehand.
  const lowest = new Map<string, number[]>();
  if (numbering === 'hand') {
    spans.forEach((span, i) => {
      for (const n of bySpan[i]) {
        const id = scopeOf(span.label, handOf(n));
        lowest.set(id, [...(lowest.get(id) ?? []), n.midi]);
      }
    });
  }
  const known = new Map<string, Map<number, number>>(); // letter and hand -> key -> number
  const start = (id: string, label: string, hand: Hand): Map<number, number> => {
    if (numbering === 'hand') return new Map([...new Set(lowest.get(id) ?? [])].sort((a, b) => a - b).map((m, k) => [m, k + 1]));
    return new Map((own?.get(label) ?? []).filter((k) => k.hand === hand).map((k) => [k.midi, k.number]));
  };
  const parts = spans.map((span, i): Part => {
    const own = bySpan[i];
    const beat = firstBeats[i];
    const division = given.division ?? divisionOf(own, beats);
    const column = (n: PieceNote) => Math.max(0, Math.round((beats.toBeats(n.time) - beat) * division));
    // Parts cut by hand may end in the middle of a bar; the last one ends with it.
    const bar = BEATS_PER_BAR * division;
    const last = i + 1 === spans.length;
    const endBeat = last ? Math.round(beats.toBeats(span.end)) : firstBeats[i + 1];
    const columns = !last || given.exact
      ? Math.max(1, endBeat - beat) * division
      : Math.ceil((Math.max(0, ...own.map(column)) + 1) / bar) * bar;

    const rows: Row[] = [];
    const keys: Key[] = [];
    for (const hand of HANDS) {
      const played = own.filter((n) => handOf(n) === hand);
      if (!played.length) continue;
      const id = scopeOf(span.label, hand);
      const numbered = known.get(id) ?? start(id, span.label, hand);
      known.set(id, numbered);

      const steps: Step[] = [];
      for (const chord of chords(played, (n) => Math.min(columns - 1, column(n)), division, beats)) {
        for (const n of chord.notes) {
          if (!numbered.has(n.midi)) numbered.set(n.midi, numbering === 'fixed' ? n.midi - FIXED_FROM : freeNumber(numbered.values()));
          numbers.set(n, numbered.get(n.midi)!);
        }
        const values = [...new Set(chord.notes.map((n) => numbered.get(n.midi)!))];
        const time = Math.min(...chord.notes.map((n) => n.time));
        const end = Math.max(...chord.notes.map((n) => n.time + n.duration));
        const before = steps[steps.length - 1];
        if (before?.step === chord.step) {
          before.chords.push(values);
          before.notes.push(...chord.notes);
          before.end = Math.max(before.end, end);
        } else {
          steps.push({ step: chord.step, time, end, chords: [values], notes: chord.notes });
        }
      }
      rows.push({ hand, steps });
      const used = new Set(played.map((n) => n.midi));
      for (const [midi, number] of numbered) if (used.has(midi)) keys.push({ hand, midi, number });
    }
    if (own || numbering !== 'order') keys.sort((a, b) => (a.hand === b.hand ? a.number - b.number : 0));
    return { label: span.label, start: span.start, end: span.end, division, columns, beat, rows, keys };
  });
  return { parts, numbers };
}

// The first number from 1 not taken yet.
export function freeNumber(taken: Iterable<number>): number {
  const used = new Set(taken);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// One hand's notes, played together or nearly, lowest key first.
function chords(played: PieceNote[], column: (n: PieceNote) => number, division: number, grid: BeatGrid) {
  const out: { step: number; notes: PieceNote[] }[] = [];
  for (const n of played) {
    const step = column(n);
    const last = out[out.length - 1];
    const gap = last ? n.time - last.notes[0].time : Infinity;
    const at = Math.floor(grid.toBeats(n.time));
    const width = (grid.toTime(at + 1) - grid.toTime(at)) / division;
    // Within a chord, the column is the first note's.
    if (last && (gap <= CHORD_WINDOW || (step === last.step && gap <= width * SPREAD))) last.notes.push(n);
    else out.push({ step, notes: [n] });
  }
  for (const c of out) c.notes.sort((a, b) => a.midi - b.midi);
  return out;
}

// The coarsest grid the notes fall on.
function divisionOf(notes: PieceNote[], grid: BeatGrid): number {
  const onsets: { at: number; beat: number }[] = [];
  let last = -Infinity;
  for (const n of notes) {
    if (n.time - last <= CHORD_WINDOW) continue;
    last = n.time;
    const at = grid.toBeats(n.time);
    const i = Math.floor(at);
    onsets.push({ at, beat: grid.toTime(i + 1) - grid.toTime(i) });
  }
  if (!onsets.length) return 1;
  for (const d of DIVISIONS) {
    const on = onsets.filter(({ at, beat }) => {
      const off = (Math.abs(at * d - Math.round(at * d)) / d) * beat;
      return off <= Math.min(0.045, (0.3 * beat) / d);
    });
    if (on.length < onsets.length * ON_GRID) continue;
    // Thirds of a beat also catch loosely played quarters: real triplets only.
    const thirds = onsets.filter(({ at }) => Math.abs(Math.abs(at - Math.round(at)) - 1 / 3) < 0.06);
    if (d % 3 || thirds.length >= onsets.length * TRIPLETS) return d;
  }
  return 4;
}

export function partAt(parts: Part[], time: number): number {
  let i = 0;
  while (i + 1 < parts.length && parts[i + 1].start <= time + 0.05) i++;
  return i;
}

export const handLetter = (hand: Hand) => (hand === 'left' ? 'G' : 'D');
export const handName = (hand: Hand) => (hand === 'left' ? 'Gauche' : 'Droite');

export const stepText = (s: Step) => s.chords.map((c) => c.join('+')).join(' ');

// Plain text, bar by bar, the hands one above the other:
//       1   .   2   .
//   G : 1       2
//   D : 1           1
export function partText(part: Part): string {
  const bar = BEATS_PER_BAR * part.division;
  const blocks: string[] = [];
  for (let from = 0; from < part.columns; from += bar) {
    const rows = part.rows.map((row) => ({
      head: `${handLetter(row.hand)} : `,
      cells: new Map(row.steps.filter((s) => s.step >= from && s.step < from + bar).map((s) => [s.step - from, stepText(s)])),
    }));
    const widths = Array.from({ length: Math.min(bar, part.columns - from) }, (_, c) => 2 + Math.max(1, ...rows.map((r) => r.cells.get(c)?.length ?? 0)));
    const line = (head: string, cell: (c: number) => string) => (head + widths.map((w, c) => cell(c).padEnd(w)).join('')).trimEnd();
    blocks.push([
      line('    ', (c) => (c % part.division === 0 ? String(c / part.division + 1) : '.')),
      ...rows.map((r) => line(r.head, (c) => r.cells.get(c) ?? '')),
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

// The whole piece, part after part.
export const pieceText = (title: string, parts: Part[], text: (p: Part) => string = partText) =>
  [title, ...parts.map((p) => `Partie ${p.label}\n${text(p)}`)].join('\n\n');

// --- Compact: only what is played, close together ------------------------------------

// One moment: what each hand of the part plays then (empty: nothing).
export interface Moment {
  step: number;
  time: number;
  texts: string[];
  // In characters, the space after it included.
  width: number;
}

const SPACE = 2;
const BAR_SPACE = 2;

// Moments one after the other, whatever the time between them; as many bars on
// a line as fit in `limit` characters. A longer bar is cut.
export function compactLines(part: Part, limit: number): Moment[][] {
  const bar = BEATS_PER_BAR * part.division;
  const steps = [...new Set(part.rows.flatMap((r) => r.steps.map((s) => s.step)))].sort((a, b) => a - b);
  const bars = new Map<number, Moment[]>();
  for (const step of steps) {
    const found = part.rows.map((r) => r.steps.find((s) => s.step === step));
    const texts = found.map((s) => (s ? s.chords.map((c) => c.join('+')).join(' ') : ''));
    const moment = { step, time: Math.min(...found.flatMap((s) => (s ? [s.time] : []))), texts, width: Math.max(...texts.map((t) => t.length)) + SPACE };
    const at = Math.floor(step / bar);
    bars.set(at, [...(bars.get(at) ?? []), moment]);
  }
  const width = (list: Moment[]) => list.reduce((sum, m) => sum + m.width, 0);
  const lines: Moment[][] = [];
  for (const moments of bars.values()) {
    const line = lines[lines.length - 1];
    if (line && width(line) + BAR_SPACE + width(moments) - SPACE <= limit) {
      const last = line[line.length - 1];
      line[line.length - 1] = { ...last, width: last.width + BAR_SPACE };
      line.push(...moments);
      continue;
    }
    let rest: Moment[] = [];
    for (const m of moments) {
      if (rest.length && width(rest) + m.width - SPACE > limit) {
        lines.push(rest);
        rest = [];
      }
      rest.push(m);
    }
    lines.push(rest);
  }
  return lines;
}

//   G :  1     3     5
//   D :  4     4  6  2
export const compactText = (part: Part, limit = 60): string =>
  compactLines(part, limit).map((line) => part.rows.map((row, r) =>
    (`${handLetter(row.hand)} :  ` + line.map((m) => m.texts[r].padEnd(m.width)).join('')).trimEnd()).join('\n')).join('\n\n');
