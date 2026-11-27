import { renderScore, scoreDivisions, stepsHeld, trimSilence, type Hand, type LyricLine, type PieceEdits, type PieceNote, type PieceNumber, type PieceSection, type RenderedScore, type Score, type ScoreNote, type ScorePart } from '@piano/shared';
import { changeOf, editable, layoutOf, levelNotes, levelOf, numbersAt, numbersOf, visible, withNumbers, type PieceChange } from './derive';
import type { BeatGrid } from './grid';
import { keysOf } from './ownNumbers';
import { HANDS, partOf, withKeys } from './score';
import type { StoredPiece } from './types';

// An imported piece in the editor of those written by hand (ScoreEditor): laid
// on a grid where its notes keep their exact place, between columns if need be.
// Those left alone come back untouched; only what is changed is worked out.

// Where a part comes from. `label`: its name when opened, as the same letter
// may come back; once redrawn or copied, its own name is its letter.
// `beat` and `beats`: what it covers of the piece.
interface Origin { index: number; label: string; letter: string; beat: number; beats: number }
export interface FromPiece extends ScorePart { origin?: Origin }
interface KeptNote extends ScoreNote { from?: number }

// A note of the piece as it was opened, in beats since its start.
interface Place { at: number; length: number; midi: number; hand: Hand }

export interface Imported {
  piece: StoredPiece;
  grid: BeatGrid;
  // As opened. `even`: its notes were put on the grid, at a steady tempo.
  score: Score & { even?: boolean };
  // Seconds in a beat, on average.
  beat: number;
  heard: PieceNote[];
  // Of the tracks that are off.
  hidden: PieceNote[];
  places: Place[];
}

const VELOCITY = 0.7;
// Just short of the next note, as in renderScore.
const LENGTH = 0.95;
const MIN_DURATION = 0.05;
// Of a column: this close, a note is on it.
const ON_COLUMN = 0.02;
// A note a hair early belongs to the part it opens (see numberPiece).
const EARLY = 1 / 8;
// The last part covers all that comes after.
const ENDLESS = 1e9;
const isEven = (score: Imported['score']) => !!score.even;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export function openPiece(piece: StoredPiece): Imported {
  const notes = editable(piece);
  const heard = visible(piece, notes);
  const shown = new Set(heard);
  const layout = layoutOf(piece);
  const { grid } = layout;
  const found = numbersOf(levelNotes(piece), layout).parts;
  const onGrid = (d: number) => heard.every((n) => Math.abs(grid.toBeats(n.time) * d - Math.round(grid.toBeats(n.time) * d)) < ON_COLUMN);
  const division = scoreDivisions.find(onGrid)
    ?? (found.some((p) => p.division >= 4 && p.division % 3) ? 4 : found.some((p) => p.division % 3 === 0) ? 3 : 2);
  // Numbered as the player does it (order, by position, across parts).
  const parts = numbersOf(heard, { ...layout, given: { ...layout.given, numbering: piece.numbering, whole: piece.whole } }, division).parts;
  const place = new Map(heard.map((n, i) => [n, i]));
  const places: Place[] = [];
  const last = Math.ceil(grid.toBeats(layout.duration) - 1e-6);

  const labels = new Set<string>();
  const unused = (letter: string) => {
    let label = letter;
    for (let i = 2; labels.has(label); i++) label = `${letter}${i}`;
    labels.add(label);
    return label;
  };
  const scoreParts = parts.map((p, index): FromPiece => {
    const label = unused(p.label);
    const kept = p.rows.flatMap((row) => row.steps.flatMap((s) => s.notes).map((n): KeptNote => {
      const start = grid.toBeats(n.time);
      const at = start - p.beat;
      const played = grid.toBeats(n.time + n.duration) - start;
      // Written on the grid, it stops just short of its last column's end.
      const full = Math.round((played / LENGTH) * division);
      const length = full && Math.abs((played / LENGTH) * division - full) < ON_COLUMN ? full / division : played;
      const from = place.get(n)!;
      places[from] = { at: start, length, midi: n.midi, hand: row.hand };
      return { hand: row.hand, midi: n.midi, step: at * division, length: length * division, from };
    }));
    const beats = p.columns / division;
    return {
      label,
      beats: index + 1 === parts.length ? Math.max(beats, last - p.beat) : beats,
      keys: HANDS.flatMap((hand) => keysOf(parts, p.label, hand)),
      notes: kept,
      origin: { index, label, letter: p.label, beat: p.beat, beats: index + 1 === parts.length ? ENDLESS : parts[index + 1].beat - p.beat },
    };
  });
  if (!scoreParts.length) scoreParts.push({ label: 'A', beats: Math.max(8, last), keys: [], notes: [], origin: { index: 0, label: 'A', letter: 'A', beat: 0, beats: ENDLESS } });

  const b = grid.beats;
  const beat = (b[b.length - 1] - b[0]) / (b.length - 1);
  const bpm = Math.round(60 / beat);
  return {
    piece, grid, heard, places, beat,
    hidden: notes.filter((n) => !shown.has(n)),
    score: { bpm: Math.min(300, Math.max(20, bpm)), division, parts: scoreParts, order: scoreParts.map((p) => p.label) },
  };
}

// --- Where parts are played ----------------------------------------------------------

interface Span {
  part: FromPiece;
  start: number; // seconds
  end: number;
  scale: number;
  // From the start of the part: beats to seconds, and back.
  time(beats: number): number;
  beats(time: number): number;
}

// Parts, order and tempo as they were, wherever the parts start: every note has
// its own place.
function inPlace(src: Imported, score: Score): boolean {
  if (isEven(score) || score.bpm !== src.score.bpm || score.order.length !== src.score.order.length) return false;
  const parts = score.order.map((label): FromPiece => partOf(score, label));
  return parts.every(({ origin, beats }, i) => origin?.index === i && (i + 1 === parts.length
    || (beats === src.score.parts[i].beats && origin.beat === (src.score.parts[i] as FromPiece).origin!.beat)
    || parts[i + 1].origin?.beat === origin.beat + beats));
}

function spansOf(src: Imported, score: Score): Span[] {
  const { grid } = src;
  const kept = inPlace(src, score);
  const scale = src.score.bpm / score.bpm;
  const even = isEven(score);
  const beat = even ? src.beat * scale : 60 / score.bpm;
  let next = even ? 0 : grid.toTime(0) * scale;
  return score.order.map((label) => {
    const part: FromPiece = partOf(score, label);
    const { origin } = part;
    const from = origin ? grid.toTime(origin.beat) : 0;
    const time = origin && !even ? (b: number) => (grid.toTime(origin.beat + b) - from) * scale : (b: number) => b * beat;
    const beats = origin && !even ? (t: number) => grid.toBeats(from + t / scale) - origin.beat : (t: number) => t / beat;
    const start = kept ? from : next;
    next = start + time(part.beats);
    return { part, start, end: next, scale, time, beats };
  });
}

// --- Listening -------------------------------------------------------------------------

export interface Rendering extends RenderedScore {
  // Parts in the order they are played.
  spans: { label: string; start: number; end: number; beats(time: number): number }[];
}

export function renderPlain(score: Score): Rendering {
  const rendered = renderScore(score);
  const { sections, duration } = rendered;
  return { ...rendered, spans: sections.map((s, i) => ({ ...s, end: sections[i + 1]?.start ?? duration, beats: (t) => (t * score.bpm) / 60 })) };
}

export function renderImported(src: Imported, score: Score): Rendering {
  const kept = inPlace(src, score);
  const even = isEven(score);
  const spans = spansOf(src, score);
  const track = src.piece.tracks ? Math.max(0, src.piece.tracks.findIndex((t) => t.enabled)) : undefined;
  const made = new Set<PieceNote>();
  const notes: PieceNote[] = [];
  for (const [i, { part, start, end, scale, time }] of spans.entries()) {
    const next = spans[i + 1]?.part.origin;
    // What runs over the next part only does when it did in the piece.
    const runs = kept || !part.origin || !spans[i + 1] || next?.index === part.origin.index + 1;
    for (const n of part.notes as KeptNote[]) {
      const at = n.step / score.division;
      // Since the start of the piece.
      const place = (part.origin?.beat ?? NaN) + at;
      const length = stepsHeld(part, score.division, n) / score.division;
      const was = n.from === undefined ? undefined : src.places[n.from];
      const original = n.from === undefined ? undefined : src.heard[n.from];
      const held = !!was && near(was.length, length);
      // Put on the grid, it is still where it was.
      const beside = !!was && (even ? Math.abs(was.at - place) < 0.75 / score.division : near(was.at, place));
      const sameKey = !!was && was.midi === n.midi && was.hand === n.hand;
      const unmoved = beside && sameKey;
      if (original && kept && unmoved && held) {
        notes.push(original);
        continue;
      }
      const note: PieceNote = {
        ...(original ?? { velocity: VELOCITY, ...(track === undefined ? {} : { track }) }),
        midi: n.midi,
        hand: n.hand,
        time: Math.max(0, start + time(at)),
        duration: Math.max(MIN_DURATION, original && held && !even ? original.duration * scale : (time(at + length) - time(at)) * LENGTH),
        // Its hand was chosen.
        ...(sameKey ? {} : { pinned: true }),
      };
      if (!runs) note.duration = Math.max(MIN_DURATION, Math.min(note.duration, end - note.time));
      if (!unmoved || !held || even) made.add(note);
      notes.push(note);
    }
  }
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  // A note laid before another on its key stops there.
  const after = new Map<string, number>();
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const key = `${n.hand}${n.midi}`;
    const next = after.get(key) ?? Infinity;
    if (made.has(n) && n.time + n.duration > next) notes[i] = { ...n, duration: Math.max(MIN_DURATION, (next - n.time) * LENGTH) };
    after.set(key, n.time);
  }
  return {
    notes,
    sections: spans.map(({ part, start }) => ({ label: part.label, start })),
    duration: Math.max(0, ...spans.map((s) => s.end)),
    spans: spans.map(({ part, start, end, beats }) => ({ label: part.label, start, end, beats })),
  };
}

// --- Numbers -----------------------------------------------------------------------------

const letterOf = (p: FromPiece) => (p.origin?.label === p.label ? p.origin.letter : p.label);

const keysText = (keys: ScorePart['keys'], hand?: Hand) =>
  keys.filter((k) => !hand || k.hand === hand).map((k) => `${k.hand}${k.number}:${k.midi}`).sort().join(' ');

// Parts with the same letter have the same numbers: they follow the one changed.
export function shareKeys(before: Score, after: Score): Score {
  let out = after;
  for (const p of after.parts) {
    const old = before.parts.find((q) => q.label === p.label);
    if (!old || keysText(old.keys) === keysText(p.keys)) continue;
    out = {
      ...out,
      parts: out.parts.map((q) => {
        if (q.label === p.label || letterOf(q) !== letterOf(p)) return q;
        let next: ScorePart = { ...q, keys: p.keys };
        for (const hand of HANDS) next = withKeys(next, hand, q.notes.filter((n) => n.hand === hand).map((n) => n.midi));
        return next;
      }),
    };
  }
  return out;
}

// At an easier level, parts stay as long as they are in the piece.
export const sameLengths = (before: Score, after: Score): Score => ({
  ...after,
  parts: after.parts.map((p) => {
    const beats = before.parts.find((q) => q.label === p.label)?.beats ?? p.beats;
    return beats === p.beats ? p : { ...p, beats, notes: p.notes.filter((n) => n.step < beats * after.division) };
  }),
});

// The owner's numbers, with those given or changed here.
function numbersIn(src: Imported, score: Score): PieceNumber[] {
  const own = numbersAt(src.piece);
  const out: PieceNumber[] = [];
  const done = new Set<string>();
  for (const p of score.parts) {
    const letter = letterOf(p);
    if (done.has(letter)) continue;
    done.add(letter);
    const was = src.score.parts.find((q) => letterOf(q) === letter);
    for (const hand of HANDS) {
      if (was && keysText(was.keys, hand) === keysText(p.keys, hand)) out.push(...own.filter((n) => n.label === letter && n.hand === hand));
      else out.push(...p.keys.filter((k) => k.hand === hand).map(({ midi, number }) => ({ label: letter, hand, midi, number })));
    }
  }
  return out;
}

// --- Saving --------------------------------------------------------------------------------

export interface ImportedChange {
  // Null: nothing to save.
  notes: PieceChange | null;
  numbers: PieceNumber[] | null;
}

export function changeFrom(src: Imported, score: Score): ImportedChange {
  const { piece } = src;
  const numbers = numbersIn(src, score);
  const own = numbersAt(piece);
  const id = (list: PieceNumber[]) => list.map((n) => `${n.label}|${n.hand}|${n.midi}|${n.number}`).sort().join('\n');
  return { notes: notesChange(src, score), numbers: id(numbers) === id(own) ? null : withNumbers(piece, numbers) };
}

function notesChange(src: Imported, score: Score): PieceChange | null {
  const { piece } = src;
  const { notes } = renderImported(src, score);
  const heard = new Set(src.heard);
  const kept = inPlace(src, score);
  const even = isEven(score);
  const spans = spansOf(src, score);
  const letters = spans.map((s) => letterOf(s.part));
  const was = src.score.parts as FromPiece[];
  const redrawn = kept && spans.some(({ part }, i) => letters[i] !== letterOf(was[i]) || part.origin!.beat !== was[i].origin!.beat);
  if (kept && !redrawn && notes.length === heard.size && notes.every((n) => heard.has(n))) return null;
  // The parts and the tempo of an easier level are those of the piece.
  if (levelOf(piece) !== 'original') return changeOf(piece, notes);

  // What is not shown follows the parts it is in.
  const carry = <N extends { time: number; duration?: number }>(items: N[], snapped = even): N[] => (kept ? items : spans.flatMap(({ part, start, scale, time }) => {
    const { origin } = part;
    if (!origin) return [];
    return items.flatMap((n) => {
      const at = src.grid.toBeats(n.time) - origin.beat;
      const early = origin.index > 0 && at < -EARLY;
      if (early || at >= origin.beats - EARLY || at >= part.beats) return [];
      const column = snapped ? Math.round(at * score.division) / score.division : at;
      return [{ ...n, time: Math.max(0, start + time(column)), ...(n.duration === undefined ? {} : { duration: n.duration * scale }) }];
    });
  }).sort((a, b) => a.time - b.time));

  let edits: PieceEdits | null = piece.edits ?? null;
  if (edits && !kept) {
    edits = Object.fromEntries(Object.entries(edits).map(([level, e]) => [level, e && { removed: carry(e.removed), added: carry(e.added) }]));
  }
  const sections: PieceSection[] | null = kept && !redrawn
    ? piece.sections ?? null
    : spans.map(({ start }, i) => ({ start: i ? start : 0, label: letters[i] }));
  const all = [...notes, ...carry(src.hidden)].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const sung = (piece.lyrics ?? []).flatMap((l) => (l.time === null ? [] : [{ ...l, time: l.time }]));
  const lyrics: LyricLine[] | null = !piece.lyrics ? null : (kept ? piece.lyrics : carry(sung, false));
  const trimmed = trimSilence({ notes: all, sections, edits, lyrics });
  return {
    notes: trimmed.notes,
    sections: trimmed.sections ?? null,
    edits: trimmed.edits ?? null,
    ...(piece.lyrics ? { lyrics: trimmed.lyrics } : {}),
    ...(even ? { bpm: (60 * score.bpm) / (src.beat * src.score.bpm) } : piece.bpm && score.bpm !== src.score.bpm ? { bpm: (piece.bpm * score.bpm) / src.score.bpm } : {}),
  };
}
