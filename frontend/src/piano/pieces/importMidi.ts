import type { Hand, PieceNote, PieceTrack } from '@piano/shared';
import { Midi } from '@tonejs/midi';
import { guessNames } from './names';
import type { ImportResult } from './types';

// Standard MIDI file. @tonejs/midi already converts ticks to seconds with
// every tempo change applied.
//
// Every instrument is kept as a track the owner can turn on and off in the
// player; piano tracks start on (all tracks when there is no piano). Drums
// (channel 10) are left out: they have no pitch to play.
export async function importMidi(file: File): Promise<ImportResult> {
  const midi = new Midi(await file.arrayBuffer());
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && t.channel !== 9);
  if (tracks.length === 0) throw new Error('Aucune note jouable dans ce fichier MIDI');

  const isPiano = (t: (typeof tracks)[number]) => t.instrument.family === 'piano';
  const pianos = tracks.filter(isPiano);
  const enabled = new Set(pianos.length ? pianos : tracks);

  // Hands, among the tracks that start on: with two or more, the highest one
  // is the right hand and the others the left; otherwise notes are split at
  // middle C (also for the tracks that start off).
  const on = tracks.filter((t) => enabled.has(t));
  const avg = (t: (typeof tracks)[number]) => t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length;
  const right = on.length > 1 ? on.reduce((a, b) => (avg(b) > avg(a) ? b : a)) : null;
  const handOf = (t: (typeof tracks)[number], midiNote: number): Hand =>
    right && enabled.has(t) ? (t === right ? 'right' : 'left') : midiNote >= 60 ? 'right' : 'left';

  const multi = tracks.length > 1;
  const notes: PieceNote[] = tracks.flatMap((t, index) => t.notes.map((n) => ({
    midi: n.midi,
    time: n.time,
    duration: Math.max(0.05, n.duration),
    velocity: n.velocity,
    hand: handOf(t, n.midi),
    ...(multi ? { track: index } : {}),
  })));

  const pieceTracks: PieceTrack[] | undefined = multi
    ? tracks.map((t) => ({
      name: (t.name.trim() || instrumentName(t.instrument.name)).slice(0, 120),
      instrument: instrumentName(t.instrument.name),
      enabled: enabled.has(t),
    }))
    : undefined;

  const warnings: string[] = [];
  if (on.length === 1) warnings.push('Une seule piste de piano : les mains sont réparties automatiquement.');
  if (multi) {
    warnings.push(pianos.length && pianos.length < tracks.length
      ? `${tracks.length} pistes : ${pianos.length} de piano activée${pianos.length > 1 ? 's' : ''}, les autres désactivées. Tu peux les changer dans le lecteur (bouton « Pistes »).`
      : `${tracks.length} pistes, toutes activées. Tu peux en désactiver dans le lecteur (bouton « Pistes »).`);
  }

  return {
    // The file name, not the MIDI's internal name: that one is most often the
    // instrument of the first track ("Elec. Piano (Classic)").
    ...guessNames(file.name),
    source: 'midi',
    bpm: midi.header.tempos[0]?.bpm ? Math.round(midi.header.tempos[0].bpm) : null,
    notes,
    tracks: pieceTracks,
    warnings,
  };
}

// "acoustic grand piano" -> "Acoustic grand piano".
const instrumentName = (name: string) => (name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Instrument');
