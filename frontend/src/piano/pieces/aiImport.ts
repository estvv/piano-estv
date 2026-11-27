import { AI_MAX_IMAGES, parseNote, type AiReading, type Hand, type PieceNote, type Score } from '@piano/shared';
import { api } from '../../lib/api';
import { assignKey, emptyScore, HANDS, MAX_BEATS } from './score';
import type { ImportResult } from './types';

// Pictures read by the server's AI: numbers written down, or a score. What it
// reads is a draft, put right by hand.

export type AiImport =
  | { kind: 'numbers'; title: string; score: Score }
  | { kind: 'notes'; result: ImportResult };

// All of them together stay under the server's limit (2 MB).
const TOTAL = 1_700_000;
const SIDES = [2000, 1600, 1300, 1000];

export async function readPictures(files: Blob[], name: string): Promise<AiImport> {
  const images = await Promise.all(files.slice(0, AI_MAX_IMAGES).map((f, _, all) => jpeg(f, TOTAL / all.length)));
  const reading = await api<AiReading>('/ai/read', { method: 'POST', json: { images } });
  return fromReading(reading, name);
}

async function jpeg(file: Blob, limit: number): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Image illisible (formats courants : jpg, png, webp)');
  }
  try {
    let url = '';
    for (const side of SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      // Transparent pictures: on paper.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      url = canvas.toDataURL('image/jpeg', 0.85);
      if (url.length <= limit) return url;
    }
    throw new Error('Image trop lourde');
  } finally {
    bitmap.close();
  }
}

export function fromReading(reading: AiReading, name: string): AiImport {
  if (reading.kind === 'nothing') throw new Error(reading.reason || 'Rien de lisible sur cette image');
  if (reading.kind === 'numbers') return { kind: 'numbers', title: reading.title || name, score: scoreFromNumbers(reading.parts) };
  return { kind: 'notes', result: notesFromScore(reading, name) };
}

// --- Numbers ------------------------------------------------------------------------

type NumbersPart = Extract<AiReading, { kind: 'numbers' }>['parts'][number];

// White keys the numbers are put on until told where they are.
const WHITE = [0, 2, 4, 5, 7, 9, 11];
const provisional = (hand: Hand, rank: number) => (hand === 'left' ? 48 : 72) + Math.floor(rank / 7) * 12 + WHITE[rank % 7];

const chord = (text: string) => text.split(/[+&/ ]+/).filter((n) => /^\d{1,2}$/.test(n)).map(Number);

// One column per moment: the rhythm is given afterwards.
export function scoreFromNumbers(parts: NumbersPart[]): Score {
  let score: Score = { ...emptyScore(), parts: [], order: [] };
  const known: Record<Hand, number[]> = { left: [], right: [] };
  for (const p of parts) for (const hand of HANDS) known[hand].push(...p[hand].flatMap(chord));
  const numbers = (hand: Hand) => [...new Set(known[hand])].sort((a, b) => a - b);

  parts.forEach((p, i) => {
    let label = p.label.slice(0, 12) || String.fromCharCode(65 + (i % 26));
    while (score.parts.some((o) => o.label === label)) label = `${label.slice(0, 10)}${i + 1}`;
    const columns = Math.max(p.left.length, p.right.length, 1);
    const beats = Math.min(MAX_BEATS, Math.max(1, Math.ceil(columns / score.division / 4)) * 4);
    score = { ...score, parts: [...score.parts, { label, beats, keys: [], notes: [] }], order: [...score.order, label] };
    for (const hand of HANDS) numbers(hand).forEach((n, rank) => { score = assignKey(score, label, hand, n, provisional(hand, rank)); });
    const part = score.parts[score.parts.length - 1];
    const key = (hand: Hand, n: number) => part.keys.find((k) => k.hand === hand && k.number === n)!.midi;
    const notes = HANDS.flatMap((hand) => p[hand].flatMap((text, step) => [...new Set(chord(text))].map((n) => ({ step, midi: key(hand, n), hand }))))
      .filter((n) => n.step < beats * score.division);
    score = { ...score, parts: [...score.parts.slice(0, -1), { ...part, notes }] };
  });
  if (!score.parts.some((p) => p.notes.length)) throw new Error('Aucun numéro lisible sur cette image');
  return score;
}

// Numbers to place, hand by hand: they are on provisional keys.
export const numbersToPlace = (score: Score): { hand: Hand; numbers: number[] }[] => HANDS
  .map((hand) => ({ hand, numbers: [...new Set(score.parts.flatMap((p) => p.keys.filter((k) => k.hand === hand).map((k) => k.number)))].sort((a, b) => a - b) }))
  .filter((h) => h.numbers.length > 0);

// --- Score ------------------------------------------------------------------------------

const LENGTH = 0.97;

function notesFromScore(reading: Extract<AiReading, { kind: 'score' }>, name: string): ImportResult {
  const bpm = reading.bpm ?? 100;
  const beat = 60 / bpm;
  const notes: PieceNote[] = [];
  let start = 0;
  let uneven = 0;
  for (const m of reading.measures) {
    const total = (hand: Hand) => m[hand].reduce((sum, e) => sum + e.beats, 0);
    for (const hand of HANDS) {
      let at = start;
      for (const e of m[hand]) {
        for (const text of e.notes) {
          const midi = parseNote(text.replace('♯', '#').replace('♭', 'b'));
          if (midi === undefined || midi < 21 || midi > 108) continue;
          notes.push({ midi, time: at * beat, duration: Math.max(0.05, e.beats * beat * LENGTH), velocity: 0.75, hand });
        }
        at += e.beats;
      }
    }
    if (m.left.length && m.right.length && Math.abs(total('left') - total('right')) > 0.01) uneven++;
    start += Math.max(total('left'), total('right'));
  }
  if (!notes.length) throw new Error('Aucune note lisible sur cette image');
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return {
    title: reading.title.slice(0, 120) || name,
    artist: null,
    source: 'musicxml',
    bpm,
    notes,
    warnings: [
      'Partition lue par une IA sur une image : des notes peuvent être fausses. Écoute-la et corrige-la ; le même morceau en PDF serait lu exactement.',
      ...(uneven ? [`${uneven} mesure${uneven > 1 ? 's' : ''} où les deux mains ne durent pas pareil.`] : []),
    ],
  };
}
