import type { PieceNote } from '@piano/shared';
import { Midi } from '@tonejs/midi';
import { levelNotes, levelOf, levelNames } from './derive';
import type { StoredPiece } from './types';

// A piece as it is played here (its level, its tracks, its hands), as a standard
// MIDI file: a track for each hand.

const HANDS = [['right', 'Main droite'], ['left', 'Main gauche']] as const;

export function midiOf(piece: StoredPiece, notes: PieceNote[] = levelNotes(piece)): Uint8Array {
  const midi = new Midi();
  midi.name = piece.title;
  const bpm = piece.score?.bpm ?? piece.bpm;
  if (bpm) midi.header.setTempo(bpm);
  for (const [hand, name] of HANDS) {
    const own = notes.filter((n) => (n.hand ?? (n.midi >= 60 ? 'right' : 'left')) === hand);
    if (!own.length) continue;
    const track = midi.addTrack();
    track.name = name;
    track.instrument.number = 0;
    for (const n of own) track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
  }
  return midi.toArray();
}

// A name every system takes.
export function fileName(piece: StoredPiece): string {
  const level = levelOf(piece);
  const name = [piece.title, piece.artist, level === 'original' ? '' : levelNames[level]].filter(Boolean).join(' - ');
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'morceau'}.mid`;
}

export function downloadMidi(piece: StoredPiece) {
  const url = URL.createObjectURL(new Blob([midiOf(piece) as BlobPart], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(piece);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
