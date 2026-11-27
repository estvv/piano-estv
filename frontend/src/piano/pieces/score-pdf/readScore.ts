import type { Hand, PieceNote } from '@piano/shared';
import type { Glyph, PageContent, Shape } from './primitives';

// Reads a score from the symbols drawn on its pages: no picture recognition,
// the music font says what each symbol is (SMuFL codes, MuseScore and others).

// --- Music font ---------------------------------------------------------------------

const HEADS: Record<number, number> = { 0xe0a0: 8, 0xe0a1: 8, 0xe0a2: 4, 0xe0a3: 2, 0xe0a4: 1 }; // beats
const RESTS: Record<number, number> = { 0xe4e3: 4, 0xe4e4: 2, 0xe4e5: 1, 0xe4e6: 1 / 2, 0xe4e7: 1 / 4, 0xe4e8: 1 / 8, 0xe4e9: 1 / 16 };
const WHOLE_REST = 0xe4e3;
// Flags, up then down: an eighth, a sixteenth…
const FLAG_FIRST = 0xe240;
const FLAG_LAST = 0xe247;
const ACCIDENTALS: Record<number, number> = { 0xe260: -1, 0xe261: 0, 0xe262: 1, 0xe263: 2, 0xe264: -2 };
const DOT = 0xe1e7;
// Clefs: the note on the line the clef sits on (diatonic steps, C0 = 0).
const STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const G4 = 4 * 7 + STEP.G;
const F3 = 3 * 7 + STEP.F;
const C4 = 4 * 7;
const CLEFS: Record<number, number> = {
  0xe050: G4, 0xe07a: G4, 0xe051: G4 - 14, 0xe052: G4 - 7, 0xe053: G4 + 7, 0xe054: G4 + 14,
  0xe062: F3, 0xe07c: F3, 0xe063: F3 - 14, 0xe064: F3 - 7, 0xe065: F3 + 7, 0xe066: F3 + 14,
  0xe05c: C4, 0xe07b: C4,
};
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Sharps and flats of key signatures, in order.
const SHARPS = [STEP.F, STEP.C, STEP.G, STEP.D, STEP.A, STEP.E, STEP.B];
const FLATS = [...SHARPS].reverse();
const TUPLETS: Record<number, number> = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8 };
// Metronome note: beats.
const METRONOME: Record<number, number> = { 0xeca3: 2, 0xeca4: 2, 0xeca5: 1, 0xeca6: 1, 0xeca7: 0.5, 0xeca8: 0.5, 0xe1d3: 2, 0xe1d5: 1, 0xe1d7: 0.5 };
const METRONOME_DOT = [0xecb7, DOT];

// --- Layout ---------------------------------------------------------------------------

interface Staff {
  lines: number[]; // y, top to bottom
  x0: number;
  x1: number;
  space: number; // between two lines
}

interface System {
  // Read: the right hand's then the left hand's, or a single one.
  staves: Staff[];
  x0: number;
  x1: number;
  bars: number[];
  extra: number; // staves left out
}

interface Head {
  x: number;
  right: number;
  y: number;
  beats: number;
  staff: number;
  step: number; // diatonic
  small: boolean;
  dots: number;
  stem: Shape | null;
  midi: number;
}

interface Event {
  x: number;
  beats: number;
  heads: Head[]; // none: a rest
}

export interface ScoreReading {
  notes: PieceNote[];
  bpm: number | null;
  measures: number;
  warnings: string[];
}

type Box = Shape['box'];
const top = (s: Staff) => s.lines[0];
const bottom = (s: Staff) => s.lines[4];
const width = (s: Shape) => s.box.x1 - s.box.x0;
const height = (s: Shape) => s.box.y1 - s.box.y0;

export class NotAScore extends Error {}

export function readScore(pages: PageContent[]): ScoreReading {
  const warnings = new Set<string>();
  const notes: PieceNote[] = [];
  const open: OpenTie[] = [];
  let bpm: number | null = null;
  let measures = 0;
  let uneven = 0;
  let nominal = 4; // beats in a bar
  let time = 0; // beats
  const raw: RawNote[] = [];
  let staffCount = 0;

  for (const page of pages) {
    const systems = findSystems(page);
    for (const system of systems) {
      staffCount = Math.max(staffCount, system.staves.length);
      if (system.extra) warnings.add('Plus de deux portées : seules les deux du bas (le piano) sont lues.');
      bpm ??= readTempo(page, system);
      const read = readSystem(page, system, warnings);
      system.bars.slice(0, -1).forEach((from, b) => {
        const to = system.bars[b + 1];
        const signature = read.signatures.filter((s) => s.x < to).pop();
        if (signature) nominal = signature.beats;
        const events = read.events.filter((e) => e.x > from - 1 && e.x < to);
        if (!events.length && !read.rests.some((x) => x > from && x < to)) return;
        const { onsets, length } = place(events, nominal);
        for (const [event, onset] of onsets) {
          for (const h of event.heads) if (!h.small) raw.push({ head: h, at: time + onset, beats: event.beats, system, staff: h.staff });
        }
        const first = measures === 0;
        const lasts = first && length > 0 && length < nominal ? length : Math.max(length, nominal);
        if (!first && Math.abs(length - nominal) > 0.01 && events.length) uneven++;
        time += lasts;
        measures++;
      });
      tie(read.ties, raw, system, open);
    }
  }
  if (!staffCount) throw new NotAScore('Aucune portée lisible dans ce PDF');
  if (!raw.length) throw new NotAScore('Aucune note lisible dans ce PDF');
  if (uneven) warnings.add(`${uneven} mesure${uneven > 1 ? 's' : ''} sur ${measures} ne tombe${uneven > 1 ? 'nt' : ''} pas juste : le rythme y est à vérifier.`);

  const beat = 60 / (bpm ?? 100);
  for (const r of raw) {
    if (r.tied) continue;
    const hand: Hand | null = staffCount > 1 ? (r.staff === 0 ? 'right' : 'left') : null;
    notes.push({ midi: r.head.midi, time: r.at * beat, duration: Math.max(0.05, r.beats * beat * 0.97), velocity: 0.75, hand });
  }
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  if (!bpm) warnings.add('Tempo non indiqué : 100 par défaut.');
  return { notes: unique(notes), bpm: bpm ?? 100, measures, warnings: [...warnings] };
}

interface RawNote {
  head: Head;
  at: number;
  beats: number;
  system: System;
  staff: number;
  tied?: boolean; // goes on from another note
}

// Two voices on one key at once: one note.
function unique(notes: PieceNote[]): PieceNote[] {
  const out: PieceNote[] = [];
  for (const n of notes) {
    const same = out.find((o) => o.midi === n.midi && Math.abs(o.time - n.time) < 0.005);
    if (same) same.duration = Math.max(same.duration, n.duration);
    else out.push({ ...n });
  }
  return out;
}

// --- Staves and systems -------------------------------------------------------------

function findSystems(page: PageContent): System[] {
  // Staff lines: long and thin, in one piece or bar by bar.
  const rows: { y: number; x0: number; x1: number }[] = [];
  const thin = page.shapes
    .filter((s) => !s.curved && height(s) < 1.2 && width(s) > 8)
    .map((s) => ({ y: (s.box.y0 + s.box.y1) / 2, x0: s.box.x0, x1: s.box.x1 }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  for (const t of thin) {
    const row = rows.find((r) => Math.abs(r.y - t.y) < 0.35 && t.x0 < r.x1 + 3 && t.x1 > r.x0 - 3);
    if (row) {
      row.x0 = Math.min(row.x0, t.x0);
      row.x1 = Math.max(row.x1, t.x1);
    } else rows.push({ ...t });
  }
  rows.sort((a, b) => a.y - b.y);
  const long = rows.filter((r) => r.x1 - r.x0 > 40);

  const staves: Staff[] = [];
  for (let i = 0; i + 4 < long.length;) {
    const five = long.slice(i, i + 5);
    const gaps = five.slice(1).map((r, k) => r.y - five[k].y);
    const space = gaps.reduce((a, g) => a + g, 0) / 4;
    const even = space > 2 && space < 20 && gaps.every((g) => Math.abs(g - space) < space * 0.15);
    const aligned = five.every((r) => Math.abs(r.x0 - five[0].x0) < space && Math.abs(r.x1 - five[0].x1) < space * 2);
    if (even && aligned) {
      staves.push({ lines: five.map((r) => r.y), x0: five[0].x0, x1: five[0].x1, space });
      i += 5;
    } else i++;
  }

  // Bar lines may come in pieces, staff then gap: put end to end.
  const verticals: Box[] = [];
  const pieces = page.shapes.filter((s) => width(s) < 4 && height(s) > 8).map((s) => ({ ...s.box })).sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0);
  for (const v of pieces) {
    const same = verticals.find((o) => Math.abs(o.x0 - v.x0) < 0.4 && v.y0 < o.y1 + 1 && v.y1 > o.y0 - 1);
    if (same) {
      same.y0 = Math.min(same.y0, v.y0);
      same.y1 = Math.max(same.y1, v.y1);
    } else verticals.push(v);
  }
  const joined = (a: Staff, b: Staff) =>
    verticals.some((v) => v.y0 < bottom(a) + 1 && v.y1 > top(b) - 1 && v.x0 > a.x0 - a.space * 3 && v.x1 < a.x1 + a.space);

  const groups: Staff[][] = [];
  for (const s of staves) {
    const last = groups[groups.length - 1];
    if (last && joined(last[last.length - 1], s)) last.push(s);
    else groups.push([s]);
  }
  return groups.map((all) => {
    const used = all.slice(-2);
    const x0 = used[0].x0;
    const x1 = used[0].x1;
    const space = used[0].space;
    // Bar lines: from the top line to the bottom line of every staff read.
    const found = verticals
      .filter((v) => used.every((s) => v.y0 <= top(s) + s.space * 0.4 && v.y1 >= bottom(s) - s.space * 0.4) || used.some((s) => covers(v, s, verticals, used)))
      .map((v) => (v.x0 + v.x1) / 2)
      .filter((x) => x > x0 - space && x < x1 + space)
      .sort((a, b) => a - b);
    const bars: number[] = [x0];
    for (const x of found) if (x - bars[bars.length - 1] > space * 2.5) bars.push(x);
    if (x1 - bars[bars.length - 1] > space * 2.5) bars.push(x1);
    return { staves: used, x0, x1, bars, extra: all.length - used.length };
  });
}

// A bar line drawn staff by staff: the same one on every staff.
function covers(v: Box, s: Staff, verticals: Box[], staves: Staff[]): boolean {
  const fits = (box: Box, staff: Staff) => Math.abs(box.y0 - top(staff)) < staff.space * 0.4 && Math.abs(box.y1 - bottom(staff)) < staff.space * 0.4;
  if (!fits(v, s)) return false;
  return staves.every((o) => o === s || verticals.some((w) => fits(w, o) && Math.abs(w.x0 - v.x0) < s.space * 0.5));
}

// --- One system -----------------------------------------------------------------------

interface Tie {
  x0: number;
  x1: number;
  y: number;
}

function readSystem(page: PageContent, system: System, warnings: Set<string>) {
  const { staves } = system;
  const space = staves[0].space;
  const near = (y: number) => y > top(staves[0]) - space * 9 && y < bottom(staves[staves.length - 1]) + space * 9;
  const glyphs = page.glyphs.filter((g) => near(g.y) && g.x > system.x0 - space * 4 && g.x < system.x1 + space * 2);
  const normal = space * 4; // SMuFL: the font size is the staff's height

  const staffOf = (y: number) => {
    const far = staves.map((s) => (y < top(s) ? top(s) - y : y > bottom(s) ? y - bottom(s) : 0));
    return far.indexOf(Math.min(...far));
  };

  // Clefs, key signatures, then notes, in reading order.
  const clefs = staves.map((s, i) => glyphs
    .filter((g) => g.code in CLEFS && g.y > top(s) - space && g.y < bottom(s) + space && staffOf(g.y) === i)
    .map((g) => ({ x: g.x, right: g.x + g.width, y: g.y, step: CLEFS[g.code] }))
    .sort((a, b) => a.x - b.x));
  const stepAt = (staff: number, x: number, y: number) => {
    const list = clefs[staff];
    const clef = list.filter((c) => c.x <= x).pop() ?? list[0] ?? { y: staves[staff].lines[3], step: staff === 1 ? F3 : G4 };
    return clef.step + Math.round((clef.y - y) / (space / 2));
  };

  const accidentals = glyphs.filter((g) => g.code in ACCIDENTALS);
  const keys = staves.map((_, i) => keySignatures(accidentals.filter((a) => staffOf(a.y) === i), clefs[i], system, space, (x, y) => stepAt(i, x, y)));
  const inKey = new Set(keys.flatMap((k) => k.flatMap((s) => s.glyphs)));

  // Stems: vertical lines that are no bar lines.
  const barXs = system.bars;
  const stems = page.shapes.filter((s) => width(s) < space * 0.4 && height(s) > space * 1.5 && near(s.box.y0)
    && !(barXs.some((x) => Math.abs((s.box.x0 + s.box.x1) / 2 - x) < space * 0.6) && staves.some((st) => s.box.y0 < top(st) + 1 && s.box.y1 > bottom(st) - 1)));

  const heads: Head[] = glyphs.filter((g) => g.code in HEADS).map((g) => {
    const small = g.size < normal * 0.8;
    const w = g.width || space * 1.2;
    const stem = stems.filter((s) => {
      const x = (s.box.x0 + s.box.x1) / 2;
      return (Math.abs(x - g.x) < space * 0.35 || Math.abs(x - (g.x + w)) < space * 0.35)
        && g.y > s.box.y0 - space * 0.6 && g.y < s.box.y1 + space * 0.6;
    }).sort((a, b) => height(b) - height(a))[0] ?? null;
    return { x: g.x, right: g.x + w, y: g.y, beats: HEADS[g.code], staff: 0, step: 0, small, dots: 0, stem, midi: 0 };
  });
  if (heads.some((h) => h.small)) warnings.add('Les petites notes (ornements) ne sont pas lues.');

  // A head between two staves goes with the ones on its stem; a chord is read
  // on the staff most of it is on.
  const byStem = new Map<Shape, Head[]>();
  for (const h of heads) {
    h.staff = staffOf(h.y);
    if (h.stem) byStem.set(h.stem, [...(byStem.get(h.stem) ?? []), h]);
  }
  for (const chord of byStem.values()) {
    if (new Set(chord.map((h) => h.staff)).size < 2) continue;
    // Across staves each head keeps its own, unless it has ledger lines of the other.
    for (const h of chord) {
      const inside = staves.findIndex((s) => h.y > top(s) - space && h.y < bottom(s) + space);
      if (inside >= 0) h.staff = inside;
    }
  }
  for (const h of heads) h.step = stepAt(h.staff, h.x, h.y);

  // Dots of duration: right of a head, beside it or in the space above.
  for (const d of glyphs.filter((g) => g.code === DOT)) {
    const of = heads.filter((h) => d.x > h.right - space * 0.2 && d.x - h.right < space * 2.4 && Math.abs(d.y - h.y) < space * 0.8)
      .sort((a, b) => Math.abs(d.y - a.y) - Math.abs(d.y - b.y) || b.x - a.x)[0];
    if (of) of.dots++;
  }

  pitch(heads, accidentals.filter((a) => !inKey.has(a)), keys, system, space);
  octaves(page, glyphs, heads, staves, space);

  // Chords: one stem, or stemless heads one above the other.
  const beams = page.shapes.filter((s) => s.filled && !s.curved && near(s.box.y0) && width(s) > space * 0.6 && isBeam(s, space));
  const flags = glyphs.filter((g) => g.code >= FLAG_FIRST && g.code <= FLAG_LAST);
  const events: Event[] = [];
  const stemmed = new Map<Event, Shape>();
  for (const [stem, chord] of byStem) {
    const full = chord.filter((h) => !h.small);
    if (!full.length) continue;
    let beats = Math.min(...full.map((h) => h.beats));
    if (beats === 1) {
      const x = (stem.box.x0 + stem.box.x1) / 2;
      const tails = beams.filter((b) => b.box.x0 < x + space * 0.4 && b.box.x1 > x - space * 0.4 && touches(b, x, stem, space)).length;
      const flag = flags.filter((f) => Math.abs(f.x - x) < space * 0.6 && f.y > stem.box.y0 - space && f.y < stem.box.y1 + space)[0];
      const count = Math.max(tails, flag ? Math.floor((flag.code - FLAG_FIRST) / 2) + 1 : 0);
      beats = 1 / 2 ** count;
    }
    const event: Event = { x: Math.min(...full.map((h) => h.x)), beats: dotted(beats, Math.max(...full.map((h) => h.dots))), heads: full };
    events.push(event);
    stemmed.set(event, stem);
  }
  const alone = heads.filter((h) => !h.stem && !h.small).sort((a, b) => a.x - b.x);
  for (const h of alone) {
    const chord = events.find((e) => !stemmed.has(e) && Math.abs(e.x - h.x) < space * 1.4 && e.heads[0].staff === h.staff && e.heads[0].beats === h.beats);
    if (chord) chord.heads.push(h);
    else events.push({ x: h.x, beats: dotted(h.beats, h.dots), heads: [h] });
  }
  tuplets(glyphs, events, stemmed, beams, space);

  // Rests. A whole rest fills its bar, whatever the bar's length.
  const rests: number[] = [];
  for (const g of glyphs.filter((x) => x.code in RESTS)) {
    const dots = glyphs.filter((d) => d.code === DOT && d.x > g.x && d.x - (g.x + g.width) < space * 1.5 && Math.abs(d.y - g.y) < space * 1.5).length;
    if (g.code === WHOLE_REST) rests.push(g.x);
    else events.push({ x: g.x, beats: dotted(RESTS[g.code], dots), heads: [] });
  }
  events.sort((a, b) => a.x - b.x);

  return { events, rests, signatures: timeSignatures(glyphs, staves, space), ties: findTies(page, system, space) };
}

const dotted = (beats: number, dots: number) => beats * (2 - 1 / 2 ** dots);

// A thick slanted or flat bar.
function isBeam(s: Shape, space: number): boolean {
  const thickness = s.points.length >= 4 ? thicknessAt(s, (s.box.x0 + s.box.x1) / 2) : 0;
  return thickness > space * 0.25 && thickness < space * 0.9;
}

function edgesAt(s: Shape, x: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < s.points.length; i++) {
    const a = s.points[i];
    const b = s.points[(i + 1) % s.points.length];
    if (Math.abs(a.x - b.x) < 1e-6 || x < Math.min(a.x, b.x) - 1e-6 || x > Math.max(a.x, b.x) + 1e-6) continue;
    ys.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  }
  return ys;
}
function thicknessAt(s: Shape, x: number): number {
  const ys = edgesAt(s, x);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
}
function touches(beam: Shape, x: number, stem: Shape, space: number): boolean {
  const ys = edgesAt(beam, Math.min(beam.box.x1 - 0.01, Math.max(beam.box.x0 + 0.01, x)));
  if (!ys.length) return false;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return y > stem.box.y0 - space * 0.8 && y < stem.box.y1 + space * 0.8;
}

// --- Pitch ------------------------------------------------------------------------------

interface KeySignature {
  x: number;
  alter: Map<number, number>; // letter -> semitones
  glyphs: Glyph[];
}

// After a clef or a bar line: accidentals in the order of the key signatures.
function keySignatures(
  accidentals: Glyph[], clefs: { x: number; right: number }[], system: System, space: number, stepAt: (x: number, y: number) => number,
): KeySignature[] {
  const out: KeySignature[] = [];
  const sorted = [...accidentals].sort((a, b) => a.x - b.x);
  const starts = [...clefs.map((c) => c.right), ...system.bars].sort((a, b) => a - b);
  for (const start of starts) {
    const run: Glyph[] = [];
    let edge = start;
    for (const a of sorted) {
      if (a.x < start - space * 0.3) continue;
      if (a.x - edge > space * (run.length ? 0.9 : 2.2)) break;
      run.push(a);
      edge = a.x + a.width;
    }
    const alter = new Map<number, number>();
    const taken: Glyph[] = [];
    for (const order of [SHARPS, FLATS]) {
      const value = order === SHARPS ? 1 : -1;
      const own = run.filter((g) => ACCIDENTALS[g.code] === value);
      let k = 0;
      while (k < own.length && k < 7 && ((stepAt(own[k].x, own[k].y) % 7) + 7) % 7 === order[k]) k++;
      if (k && k === own.length) {
        order.slice(0, k).forEach((letter) => alter.set(letter, value));
        taken.push(...own);
      }
    }
    const naturals = run.filter((g) => ACCIDENTALS[g.code] === 0);
    // One accidental after a bar line is most often a note's.
    const afterBar = !clefs.some((c) => c.right === start);
    if (!taken.length && !(naturals.length > 1)) continue;
    if (afterBar && taken.length + naturals.length < 2) continue;
    out.push({ x: start, alter, glyphs: [...taken, ...(taken.length ? naturals.filter((g) => g.x < taken[0].x) : naturals)] });
  }
  return out.sort((a, b) => a.x - b.x);
}

// Accidentals hold to the end of the bar, on their own line.
function pitch(heads: Head[], accidentals: Glyph[], keys: KeySignature[][], system: System, space: number) {
  const of = new Map<Head, Glyph>();
  for (const a of accidentals) {
    const edge = a.x + a.width;
    const target = heads
      .filter((h) => Math.abs(h.y - a.y) < space * 0.4 && h.x > edge - space * 0.5 && h.x - edge < space * 3.5)
      .sort((p, q) => p.x - q.x)[0];
    if (target) of.set(target, a);
  }
  const held = new Map<string, number>();
  let bar = -1;
  for (const h of [...heads].sort((a, b) => a.x - b.x)) {
    const now = system.bars.filter((x) => x <= h.x + space).length;
    if (now !== bar) {
      held.clear();
      bar = now;
    }
    const letter = ((h.step % 7) + 7) % 7;
    const line = `${h.staff}:${h.step}`;
    const own = of.get(h);
    if (own) held.set(line, ACCIDENTALS[own.code]);
    const key = keys[h.staff].filter((k) => k.x <= h.x).pop();
    const alter = held.get(line) ?? key?.alter.get(letter) ?? 0;
    h.midi = (Math.floor(h.step / 7) + 1) * 12 + SEMITONES[letter] + alter;
  }
}

// 8va and 8vb lines.
function octaves(page: PageContent, glyphs: Glyph[], heads: Head[], staves: Staff[], space: number) {
  const marks: Record<number, number> = { 0xe510: 12, 0xe511: 12, 0xe512: 12, 0xe51c: -12, 0xe514: 24, 0xe515: 24, 0xe516: 24, 0xe51d: -24 };
  for (const g of glyphs.filter((x) => x.code in marks)) {
    let edge = g.x + g.width;
    const dashes = page.shapes.filter((s) => height(s) < space * 0.3 && s.box.x0 > g.x && Math.abs(s.box.y0 - g.y) < space * 2).sort((a, b) => a.box.x0 - b.box.x0);
    for (const d of dashes) if (d.box.x0 - edge < space * 3) edge = Math.max(edge, d.box.x1);
    const staff = staves.findIndex((s) => Math.abs((g.y < top(s) ? top(s) : bottom(s)) - g.y) < space * 8);
    const above = staff >= 0 && g.y < top(staves[staff]);
    const shift = Math.abs(marks[g.code]) * (above ? 1 : -1);
    for (const h of heads) if (h.staff === staff && h.x > g.x - space && h.x < edge + space) h.midi += shift;
  }
}

// --- Time ---------------------------------------------------------------------------------

function timeSignatures(glyphs: Glyph[], staves: Staff[], space: number): { x: number; beats: number }[] {
  const s = staves[0];
  const inside = glyphs.filter((g) => g.y > top(s) - space && g.y < bottom(s) + space);
  const out: { x: number; beats: number }[] = [];
  for (const g of inside) {
    if (g.code === 0xe08a) out.push({ x: g.x, beats: 4 });
    if (g.code === 0xe08b) out.push({ x: g.x, beats: 4 });
  }
  const digits = inside.filter((g) => g.code >= 0xe080 && g.code <= 0xe089).sort((a, b) => a.x - b.x);
  const middle = s.lines[2];
  const columns: Glyph[][] = [];
  for (const d of digits) {
    const column = columns.find((c) => Math.abs(c[0].x - d.x) < space * 3.2);
    if (column) column.push(d);
    else columns.push([d]);
  }
  const value = (list: Glyph[]) => list.reduce((n, g) => n * 10 + (g.code - 0xe080), 0);
  for (const c of columns) {
    const over = value(c.filter((g) => g.y < middle + 0.1));
    const under = value(c.filter((g) => g.y >= middle + 0.1));
    if (over && under) out.push({ x: c[0].x, beats: (over * 4) / under });
  }
  return out.sort((a, b) => a.x - b.x);
}

// Onsets in a bar. Symbols at one place sound together; the next place is when
// the first of the notes or rests still going on ends.
function place(events: Event[], nominal: number): { onsets: [Event, number][]; length: number } {
  const onsets: [Event, number][] = [];
  const columns: Event[][] = [];
  const sorted = [...events].sort((a, b) => a.x - b.x);
  for (const e of sorted) {
    const last = columns[columns.length - 1];
    const reach = e.heads.length ? (e.heads[0].right - e.heads[0].x) * 1.15 : 5;
    if (last && e.x - last[0].x < reach) last.push(e);
    else columns.push([e]);
  }
  let now = 0;
  let ends: number[] = [];
  columns.forEach((column, i) => {
    if (i > 0) {
      ends = ends.filter((t) => t > now + 1e-6);
      now = ends.length ? Math.min(...ends) : now;
    }
    for (const e of column) {
      onsets.push([e, now]);
      ends.push(now + e.beats);
    }
  });
  const length = ends.length ? Math.max(...ends) : nominal;
  return { onsets, length: Math.round(length * 96) / 96 };
}

function tuplets(glyphs: Glyph[], events: Event[], stemmed: Map<Event, Shape>, beams: Shape[], space: number) {
  for (const g of glyphs.filter((x) => x.code >= 0xe880 && x.code <= 0xe889)) {
    const count = g.code - 0xe880;
    const normal = TUPLETS[count];
    if (!normal) continue;
    const x = g.x + g.width / 2;
    const chords = [...stemmed.keys()].filter((e) => {
      const stem = stemmed.get(e)!;
      return g.y > stem.box.y0 - space * 5 && g.y < stem.box.y1 + space * 5;
    });
    // The beam it is over, else the notes closest to it.
    const beam = beams.filter((b) => b.box.x0 < x && b.box.x1 > x && Math.abs((b.box.y0 + b.box.y1) / 2 - g.y) < space * 5)
      .sort((a, b) => width(b) - width(a))[0];
    const group = beam
      ? chords.filter((e) => {
        const sx = stemmed.get(e)!.box.x0;
        return sx > beam.box.x0 - space * 0.5 && sx < beam.box.x1 + space * 0.5;
      })
      : [...events].filter((e) => Math.abs(e.x - x) < space * 14).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x)).slice(0, count);
    for (const e of group) e.beats *= normal / count;
  }
}

function readTempo(page: PageContent, system: System): number | null {
  const space = system.staves[0].space;
  const above = page.glyphs.filter((g) => g.y < top(system.staves[0]) && g.y > top(system.staves[0]) - space * 14);
  for (const note of above.filter((g) => g.code in METRONOME)) {
    const line = above.filter((g) => Math.abs(g.y - note.y) < space * 1.2 && g.x > note.x && g.x - note.x < space * 16).sort((a, b) => a.x - b.x);
    const dot = line.some((g) => METRONOME_DOT.includes(g.code));
    const text = line.filter((g) => g.code < 0x80).map((g) => String.fromCharCode(g.code)).join('');
    const value = Number(/=\D{0,3}(\d{2,3})/.exec(text)?.[1]);
    if (value >= 20 && value <= 400) return Math.round(value * METRONOME[note.code] * (dot ? 1.5 : 1));
  }
  return null;
}

// --- Ties ---------------------------------------------------------------------------------

interface OpenTie {
  step: number;
  staff: number;
  note: RawNote;
}

// Flat curves.
function findTies(page: PageContent, system: System, space: number): Tie[] {
  const { staves } = system;
  return page.shapes
    .filter((s) => s.curved && width(s) > space * 0.8 && s.box.y0 > top(staves[0]) - space * 9 && s.box.y1 < bottom(staves[staves.length - 1]) + space * 9)
    .flatMap((s) => {
      const left = s.points.filter((p) => p.x < s.box.x0 + 0.3);
      const right = s.points.filter((p) => p.x > s.box.x1 - 0.3);
      if (!left.length || !right.length || Math.abs(left[0].y - right[0].y) > space * 0.35) return [];
      return [{ x0: s.box.x0, x1: s.box.x1, y: left[0].y }];
    });
}

// Joins the notes a tie holds together. They are on the same line: a tie over a
// bar line keeps the accidental, which is not written again.
function tie(ties: Tie[], raw: RawNote[], system: System, open: OpenTie[]) {
  const space = system.staves[0].space;
  const own = raw.filter((r) => r.system === system);
  const close = (y: number, h: Head) => Math.abs(y - h.y) < space * 1.6;
  const join = (from: RawNote, to: RawNote) => {
    // The first note of the chain carries the whole length.
    let root = from;
    while (chain.has(root)) root = chain.get(root)!;
    root.beats = Math.max(root.beats, to.at + to.beats - root.at);
    to.tied = true;
    chain.set(to, root);
  };
  const chain = new Map<RawNote, RawNote>();

  for (const o of open.splice(0)) {
    const to = own.filter((r) => r.staff === o.staff && r.head.step === o.step).sort((a, b) => a.at - b.at)[0];
    if (to && Math.abs(to.at - (o.note.at + o.note.beats)) < 0.05) join(o.note, to);
  }
  for (const t of ties.sort((a, b) => a.x0 - b.x0)) {
    const from = own.filter((r) => close(t.y, r.head) && t.x0 > r.head.x - space * 0.4 && t.x0 - r.head.right < space * 1.2)
      .sort((a, b) => Math.abs(t.y - a.head.y) - Math.abs(t.y - b.head.y));
    const to = own.filter((r) => close(t.y, r.head) && r.head.right > t.x1 - space * 0.4 && r.head.x - t.x1 < space * 1.2 && r.head.x > t.x0);
    let done = false;
    for (const f of from) {
      const match = to.find((r) => r.staff === f.staff && r.head.step === f.head.step && r.at > f.at && Math.abs(r.at - (f.at + f.beats)) < 0.05);
      if (!match || match.tied) continue;
      join(f, match);
      done = true;
      break;
    }
    // Over the end of the line.
    if (!done && t.x1 > system.x1 - space * 2.5) {
      const f = from.find((r) => !open.some((o) => o.note === r));
      if (f) open.push({ step: f.head.step, staff: f.staff, note: f });
    }
  }
}
