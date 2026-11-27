import { z } from 'zod';

// A playable piece, whatever it was imported from (MIDI, MusicXML, audio
// transcription) or written by hand (see score.ts). Times are in seconds at the original tempo, so tempo
// changes are already applied.

export const hands = ['right', 'left'] as const;
export type Hand = (typeof hands)[number];

export const pieceNoteSchema = z.object({
  midi: z.number().int().min(0).max(127),
  time: z.number().min(0),
  duration: z.number().positive(),
  velocity: z.number().min(0).max(1),
  // Unknown for most audio transcriptions and single-track MIDI files.
  hand: z.enum(hands).nullable(),
  // Hand chosen by the owner: never guessed again.
  pinned: z.boolean().optional(),
  // Index in the piece's `tracks`, for files with several instruments.
  track: z.number().int().min(0).max(63).optional(),
});

// One instrument of a multi-track file (MIDI): every track is kept, the
// owner turns them on and off.
export const pieceTrackSchema = z.object({
  name: z.string().max(120),
  instrument: z.string().max(120).nullable(),
  enabled: z.boolean(),
});
export type PieceTrack = z.infer<typeof pieceTrackSchema>;

export const pieceSources = ['midi', 'musicxml', 'audio', 'video', 'manual'] as const;

// How hard a piece feels to its owner, easiest first.
export const pieceDifficulties = ['easy', 'medium', 'hard', 'impossible'] as const;
export type PieceDifficulty = (typeof pieceDifficulties)[number];

// How much of a piece is shown and played: everything, the melody over the
// bass, or the melody alone (worked out in the player, the notes unchanged).
export const pieceLevels = ['original', 'simplified', 'melody'] as const;
export type PieceLevel = (typeof pieceLevels)[number];

// Practice parts set by hand: where each starts (seconds) and its letter; the
// same letter means the same passage. The first one starts at 0.
export const pieceSectionSchema = z.object({
  start: z.number().min(0),
  label: z.string().trim().min(1).max(12),
});
export const pieceSectionsSchema = z.array(pieceSectionSchema).min(1).max(200)
  .refine((s) => s[0].start === 0 && s.every((x, i) => i === 0 || x.start > s[i - 1].start), { message: 'Parties invalides' });
export type PieceSection = z.infer<typeof pieceSectionSchema>;

// Numbers the owner gives keys, per part (by letter) and hand.
export const pieceNumbersSchema = z.array(z.object({
  label: z.string().trim().min(1).max(12),
  hand: z.enum(hands),
  midi: z.number().int().min(0).max(127),
  number: z.number().int().min(0).max(99),
  // Of an easier level; left out: the original.
  level: z.enum(['simplified', 'melody']).optional(),
})).max(5000);
export type PieceNumber = z.infer<typeof pieceNumbersSchema>[number];

// Lyrics, line by line: when each is sung, in seconds (null: not known yet). A
// line with no text: nobody sings.
export const pieceLyricsSchema = z.array(z.object({
  time: z.number().min(0).nullable(),
  text: z.string().trim().max(300),
})).max(500);
export type LyricLine = z.infer<typeof pieceLyricsSchema>[number];

// How keys get their numbers in the player: in the order they are first played,
// from the lowest key played by each hand, or the same for each key of the piano.
export const pieceNumberings = ['order', 'hand', 'fixed'] as const;
export type PieceNumbering = (typeof pieceNumberings)[number];

// Changes made by hand to an easier level, kept apart from the piece's notes.
export const pieceLevelEditSchema = z.object({
  removed: z.array(z.object({ midi: z.number().int().min(0).max(127), time: z.number().min(0) })).max(10_000),
  added: z.array(pieceNoteSchema).max(10_000),
});
export const pieceEditsSchema = z.object({ simplified: pieceLevelEditSchema.optional(), melody: pieceLevelEditSchema.optional() });
export type PieceLevelEdit = z.infer<typeof pieceLevelEditSchema>;
export type PieceEdits = z.infer<typeof pieceEditsSchema>;

export const pieceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  // Performer or composer, when known.
  artist: z.string().trim().max(120).nullish(),
  source: z.enum(pieceSources),
  // Beats per minute of the original, when known (MIDI, MusicXML).
  bpm: z.number().positive().nullable(),
  notes: z.array(pieceNoteSchema).min(1).max(50_000),
  // Only for files with several instruments.
  tracks: z.array(pieceTrackSchema).max(64).optional(),
}).refine((p) => p.notes.every((n) => n.track === undefined || (p.tracks && n.track < p.tracks.length)), { message: 'Piste inconnue' });

export type PieceNote = z.infer<typeof pieceNoteSchema>;
export type Piece = z.infer<typeof pieceSchema>;

export function pieceDuration(notes: PieceNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0);
}

// --- Silence around a piece ---------------------------------------------------------

export interface PieceContent {
  notes: PieceNote[];
  sections?: PieceSection[] | null;
  edits?: PieceEdits | null;
  lyrics?: LyricLine[] | null;
}

// Less than this is no silence.
const SILENCE = 0.01;
const EDITED_LEVELS = ['simplified', 'melody'] as const;

// `by` seconds less at the start: what begins before is dropped, parts and
// changes to the easier levels follow.
export function cutStart<T extends PieceContent>(content: T, by: number): T {
  const move = <N extends { time: number }>(list: N[]): N[] =>
    list.filter((n) => n.time >= by - 1e-6).map((n) => ({ ...n, time: Math.max(0, n.time - by) }));
  const out = { ...content, notes: move(content.notes) };
  if (content.sections) out.sections = shiftSections(content.sections, by);
  if (content.edits) {
    const edits: PieceEdits = {};
    for (const level of EDITED_LEVELS) {
      const e = content.edits[level];
      if (e) edits[level] = { removed: move(e.removed), added: move(e.added) };
    }
    out.edits = edits;
  }
  if (content.lyrics) out.lyrics = shiftLyrics(content.lyrics, by);
  return out;
}

// Of the lines now before the start, only the last one may still be sung.
export function shiftLyrics(lyrics: LyricLine[], by: number): LyricLine[] {
  const gone = lyrics.filter((l) => l.time !== null && l.time < by - 1e-6);
  return lyrics
    .filter((l) => !gone.includes(l) || l === gone[gone.length - 1])
    .map((l) => ({ ...l, time: l.time === null ? null : Math.max(0, l.time - by) }));
}

export function shiftSections(sections: PieceSection[], by: number): PieceSection[] {
  const moved = sections.map((p) => ({ ...p, start: Math.max(0, p.start - by) }));
  // Of the parts now before the start, the last one opens the piece.
  return moved.filter((p, i) => p.start > 0 || i + 1 === moved.length || moved[i + 1].start > 0);
}

// The piece starts on its first note. (It ends with its last one: nothing is
// stored after it.)
export function trimSilence<T extends PieceContent>(content: T): T {
  const times = [content.notes, ...EDITED_LEVELS.map((l) => content.edits?.[l]?.added ?? [])].flat().map((n) => n.time);
  const start = times.reduce((min, t) => Math.min(min, t), Infinity);
  return Number.isFinite(start) && start > SILENCE ? cutStart(content, start) : content;
}

// From the first note heard to the end of the last one: other tracks, or the
// notes an easier level leaves out, may play before and after.
export function soundingSpan(notes: PieceNote[]): [start: number, end: number] {
  if (!notes.length) return [0, 0];
  const start = notes.reduce((min, n) => Math.min(min, n.time), Infinity);
  return [start > SILENCE ? start : 0, pieceDuration(notes)];
}
