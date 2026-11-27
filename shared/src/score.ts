import { z } from 'zod';
import { hands, pieceNoteSchema, type Hand, type PieceNote, type PieceSection } from './piece.ts';

// A piece written by hand as numbers: parts laid on a grid, each written once,
// then the order they are played in. Its notes are worked out from it.

export const scoreDivisions = [2, 3, 4] as const; // columns per beat

const label = z.string().trim().min(1).max(12);

export const scorePartSchema = z.object({
  label,
  beats: z.number().int().min(1).max(256),
  // Which key each number is, per hand: the owner's own numbers.
  keys: z.array(z.object({ hand: z.enum(hands), number: z.number().int().min(0).max(99), midi: z.number().int().min(21).max(108) })).max(176),
  notes: z.array(z.object({
    step: z.number().int().min(0),
    midi: z.number().int().min(21).max(108),
    hand: z.enum(hands),
    // Columns it is held; left out: until the hand plays again.
    length: z.number().int().min(1).max(1024).optional(),
  })).max(4000),
});
export type ScorePart = z.infer<typeof scorePartSchema>;
export type ScoreNote = ScorePart['notes'][number];

const MAX_NOTES = 50_000;

export const scoreSchema = z.object({
  bpm: z.number().min(20).max(300),
  division: z.union(scoreDivisions.map((d) => z.literal(d)) as [z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>]),
  parts: z.array(scorePartSchema).min(1).max(50),
  order: z.array(label).min(1).max(200),
}).superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const byLabel = new Map(s.parts.map((p) => [p.label, p]));
  if (byLabel.size !== s.parts.length) return fail('Deux parties ont le même nom');
  if (s.order.some((l) => !byLabel.has(l))) return fail('Partie inconnue');
  for (const p of s.parts) {
    if (p.notes.some((n) => n.step >= p.beats * s.division)) return fail('Note hors de sa partie');
    if (new Set(p.keys.map((k) => `${k.hand}${k.number}`)).size !== p.keys.length) return fail('Un numéro a deux touches');
    if (new Set(p.keys.map((k) => `${k.hand}m${k.midi}`)).size !== p.keys.length) return fail('Une touche a deux numéros');
  }
  const total = s.order.reduce((sum, l) => sum + byLabel.get(l)!.notes.length, 0);
  if (total === 0) return fail('Aucune note');
  if (total > MAX_NOTES) return fail('Trop de notes');
});
export type Score = z.infer<typeof scoreSchema>;

// A key sounds until its hand plays again, this many beats at most.
const LONGEST = 4;
// Just short of the next note, so that a repeated key is heard twice.
const LENGTH = 0.95;
const VELOCITY = 0.75;

// Columns a note lasts, written or not.
export function stepsHeld(part: Pick<ScorePart, 'beats' | 'notes'>, division: number, note: ScoreNote): number {
  if (note.length) return note.length;
  const next = part.notes.reduce((min, n) => (n.hand === note.hand && n.step > note.step ? Math.min(min, n.step) : min), part.beats * division);
  return Math.max(1, Math.min(LONGEST * division, next - note.step));
}

export interface RenderedScore {
  notes: PieceNote[];
  sections: PieceSection[];
  duration: number; // seconds, silences included
}

export function renderScore(score: Score): RenderedScore {
  const beat = 60 / score.bpm;
  const notes: PieceNote[] = [];
  const sections: PieceSection[] = [];
  const played = new Map<Hand, { at: number; midi: number; length?: number }[]>(hands.map((h) => [h, []]));
  let start = 0; // beats
  for (const name of score.order) {
    const part = score.parts.find((p) => p.label === name);
    if (!part) continue;
    sections.push({ start: start * beat, label: part.label });
    for (const n of part.notes) played.get(n.hand)!.push({ at: start + n.step / score.division, midi: n.midi, length: n.length && n.length / score.division });
    start += part.beats;
  }
  for (const hand of hands) {
    const list = played.get(hand)!.sort((a, b) => a.at - b.at || a.midi - b.midi);
    const onsets = [...new Set(list.map((n) => n.at))];
    const next = new Map(onsets.map((at, i) => [at, onsets[i + 1] ?? start]));
    for (const n of list) {
      // Held, it still stops when its own key is played again.
      const again = list.find((o) => o.midi === n.midi && o.at > n.at)?.at ?? start;
      const length = n.length ? Math.max(1 / 16, Math.min(n.length, Math.max(again, n.at + 1 / 16) - n.at)) : Math.min(LONGEST, next.get(n.at)! - n.at);
      notes.push(pieceNoteSchema.parse({ midi: n.midi, time: n.at * beat, duration: length * beat * LENGTH, velocity: VELOCITY, hand }));
    }
  }
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return { notes, sections, duration: start * beat };
}
