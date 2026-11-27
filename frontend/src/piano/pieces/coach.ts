import { frenchName, octaveOf, type PieceNote } from '@piano/shared';
import { api } from '../../lib/api';
import type { BeatGrid } from './grid';
import { chordPoints, type Take } from './takes';

// What the coach is told: the piece, the part asked about, and a take. Written
// here, sent only when the player asks.

export interface Turn { role: 'user' | 'coach'; text: string }
export const askCoach = (context: string, messages: Turn[]) =>
  api<{ text: string }>('/ai/coach', { method: 'POST', json: { context, messages } }).then((r) => r.text);

const MAX_CHORDS = 160;
const MAX_TROUBLES = 25;
const HAND = { left: 'main gauche', right: 'main droite' } as const;
export const name = (midi: number) => `${frenchName(midi)}${octaveOf(midi)}`;
const list = (midis: number[]) => [...midis].sort((a, b) => a - b).map(name).join('+');

export interface About {
  title: string;
  artist: string | null;
  level: string;
  bpm: number | null;
  rate: number;
  grid: BeatGrid;
  // What is being worked on: its name, from, to (seconds).
  part: { name: string; start: number; end: number };
  notes: PieceNote[];
}

// "mesure 3, temps 2" (four beats a bar).
function where(grid: BeatGrid, time: number): string {
  const beats = grid.toBeats(time);
  return `mesure ${Math.floor(beats / 4) + 1}, temps ${Math.floor(((beats % 4) + 4) % 4) + 1}`;
}

export function contextOf(about: About, take: Take | null): string {
  const { grid, part } = about;
  const lines = [
    `Morceau : ${about.title}${about.artist ? ` — ${about.artist}` : ''}`,
    `Niveau joué : ${about.level}. Tempo${about.bpm ? ` d’origine ${Math.round(about.bpm)} à la noire` : ' inconnu'}, joué à ${Math.round(about.rate * 100)} %.`,
    `Passage travaillé : ${part.name}.`,
    '',
    'Notes du passage, accord par accord (main, notes) :',
  ];
  const own = about.notes.filter((n) => n.time >= part.start - 0.03 && n.time < part.end - 0.03).sort((a, b) => a.time - b.time);
  const chords: { time: number; hand: string; midis: number[] }[] = [];
  for (const n of own) {
    const hand = HAND[n.hand ?? (n.midi >= 60 ? 'right' : 'left')];
    const same = chords.find((c) => c.hand === hand && Math.abs(c.time - n.time) < 0.04);
    if (same) same.midis.push(n.midi);
    else chords.push({ time: n.time, hand, midis: [n.midi] });
  }
  for (const c of chords.slice(0, MAX_CHORDS)) lines.push(`- ${where(grid, c.time)}, ${c.hand} : ${list(c.midis)}`);
  if (chords.length > MAX_CHORDS) lines.push(`(et ${chords.length - MAX_CHORDS} autres accords)`);

  if (take) {
    lines.push('', `Dernière prise (mode attente : le morceau s’arrête jusqu’à la bonne note) : ${take.score}/100, ${take.clean}/${take.chords} accords justes du premier coup, ${take.wrong} fausses notes.`);
    const troubles = take.results
      .filter((r) => r.at !== undefined && (r.wrong > 0 || r.waited > 1))
      .sort((a, b) => chordPoints(a) - chordPoints(b))
      .slice(0, MAX_TROUBLES)
      .sort((a, b) => a.at! - b.at!);
    if (troubles.length) {
      lines.push('Accords difficiles :');
      for (const r of troubles) {
        const hands = [...new Set((r.notes ?? []).map((n) => HAND[n.hand ?? (n.midi >= 60 ? 'right' : 'left')]))].join(' et ');
        const wrong = r.keys?.length ? `, joué à tort ${r.keys.map(name).join(', ')}` : '';
        lines.push(`- ${where(grid, r.at!)}, ${hands}, attendu ${list((r.notes ?? []).map((n) => n.midi))}${wrong}, trouvé en ${r.waited.toFixed(1).replace('.', ',')} s`);
      }
    } else lines.push('Aucun accord vraiment difficile.');
  }
  return lines.join('\n');
}
