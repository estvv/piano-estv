// Note names. Octaves use scientific pitch notation (middle C = C4) to avoid
// the French convention clash (Do3 = C4): labels read "Do (C4)".

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'] as const;
const FR_FLAT = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'] as const;
const LETTER_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const MIDI_MIN = 21; // A0
export const MIDI_MAX = 108; // C8

export function isBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

// "C4", "C#4", "Db4", "Do4"-free: scientific names only.
export function parseNote(name: string): number | undefined {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return undefined;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + LETTER_OFFSET[m[1].toUpperCase()] + acc;
}

export function noteName(midi: number, flat = false): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${(flat ? FLATS : LETTERS)[pc]}${octaveOf(midi)}`;
}

export function frenchName(midi: number, flat = false): string {
  return (flat ? FR_FLAT : FR)[((midi % 12) + 12) % 12];
}

// "Do (C)" or with octave "Do (C4)"; black keys "Do♯ / Ré♭ (C♯4 / D♭4)".
export function noteLabel(midi: number, withOctave = false): string {
  const o = withOctave ? String(octaveOf(midi)) : '';
  const pc = ((midi % 12) + 12) % 12;
  const en = (n: string) => n.replace('#', '♯').replace(/^([A-G])b/, '$1♭');
  if (!isBlack(midi)) return `${FR[pc]} (${LETTERS[pc]}${o})`;
  return `${FR[pc]} / ${FR_FLAT[pc]} (${en(LETTERS[pc])}${o} / ${en(FLATS[pc])}${o})`;
}

// "C3-C5" or "C3..C5" → [48, 72]
export function parseRange(range: string): [number, number] | undefined {
  const parts = range.split(/\s*(?:-|\.\.|–)\s*(?=[A-Ga-g])/);
  if (parts.length !== 2) return undefined;
  const a = parseNote(parts[0]);
  const b = parseNote(parts[1]);
  if (a === undefined || b === undefined) return undefined;
  return a <= b ? [a, b] : [b, a];
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}
