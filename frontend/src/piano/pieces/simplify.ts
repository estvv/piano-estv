import type { Hand, PieceLevel, PieceNote } from '@piano/shared';

// Easier versions of a piece, worked out from its notes, the file untouched:
// - simplified: the right hand keeps the melody (highest note of each
//   chord), the left hand the bass (lowest note);
// - melody: the melody alone.
// Held notes stop when the same hand plays its next note, so pads and long
// chords no longer pile up.

// Notes starting this close together form one chord (as in the player).
const CHORD_WINDOW = 0.04;
const MIN_DURATION = 0.05;
// Of rolled chords, in seconds: between two notes, from the first to the last, and
// how long they are held.
const ROLL = 0.07;
const ROLLED = 0.25;
const STAYS = 0.5;

// Notes without a hand (audio transcriptions) go by pitch around middle C.
export const handOf = (n: PieceNote): Hand => n.hand ?? (n.midi >= 60 ? 'right' : 'left');
const isRight = (n: PieceNote) => handOf(n) === 'right';

export function simplify(notes: PieceNote[], level: PieceLevel): PieceNote[] {
  if (level === 'original') return notes;
  const right = notes.filter(isRight);
  const melody = line(right, (a, b) => b.midi > a.midi);
  if (level === 'melody') return melody;
  const bass = line(notes.filter((n) => !isRight(n)), (a, b) => b.midi < a.midi);
  return [...melody, ...bass].sort((a, b) => a.time - b.time || a.midi - b.midi);
}

// One note at a time: per chord, the note `better` prefers; each note lasts
// at most until the next one.
function line(notes: PieceNote[], better: (a: PieceNote, b: PieceNote) => boolean): PieceNote[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const picked: PieceNote[] = [];
  let start = -Infinity;
  let before = sorted[0];
  for (const n of sorted) {
    const last = picked[picked.length - 1];
    // A rolled chord is one too: its notes come one after the other, and stay.
    const rolled = !!last && n.time - before.time <= ROLL && n.time - start <= ROLLED && before.duration >= STAYS && n.duration >= STAYS;
    before = n;
    if (last && (n.time - start <= CHORD_WINDOW || rolled)) {
      if (better(last, n)) picked[picked.length - 1] = n;
    } else {
      picked.push(n);
      start = n.time;
    }
  }
  return oneByOne(picked);
}

// Each hand's notes last at most until its next one.
export function oneByOne(notes: PieceNote[]): PieceNote[] {
  const next = new Map<Hand, PieceNote>();
  const out = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  for (let i = out.length - 1; i >= 0; i--) {
    const n = out[i];
    const after = next.get(handOf(n));
    if (after && after.time - n.time > CHORD_WINDOW && n.time + n.duration > after.time) out[i] = { ...n, duration: Math.max(MIN_DURATION, after.time - n.time) };
    next.set(handOf(n), n);
  }
  return out;
}
