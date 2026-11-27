import type { PieceNote } from '@piano/shared';
import type { ImportResult } from './types';
import { guessNames } from './names';

// Audio (mp3, wav, ogg…) or video (mp4, webm: its sound track) transcribed
// to notes in the browser by Spotify's basic-pitch model. Nothing is sent to
// the server. Works best on solo piano; a full song gives approximate notes.

const SAMPLE_RATE = 22050; // what the model expects
const MAX_SECONDS = 10 * 60;

export interface TranscribeOptions {
  // 0 (few notes, only the clear ones) .. 1 (many notes, more noise).
  sensitivity: number;
  onProgress(stage: 'decode' | 'model' | 'transcribe', percent?: number): void;
}

async function decodeMono(file: File): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > MAX_SECONDS) throw new Error('Fichier trop long (10 minutes maximum)');
    // Resample to 22.05 kHz mono with an offline render.
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } catch (e) {
    if (e instanceof Error && e.message.includes('10 minutes')) throw e;
    throw new Error('Impossible de lire le son de ce fichier (formats courants : mp3, wav, m4a, mp4, webm)');
  } finally {
    void ctx.close();
  }
}

export async function importAudio(file: File, { sensitivity, onProgress }: TranscribeOptions): Promise<ImportResult> {
  onProgress('decode');
  const samples = await decodeMono(file);

  onProgress('model');
  // TensorFlow.js and the model (~1 MB) are only loaded for a transcription.
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');
  const basicPitch = new BasicPitch('/models/basic-pitch/model.json');

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await basicPitch.evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress('transcribe', p),
  );

  // Higher sensitivity = lower thresholds = more (and noisier) notes.
  const onsetThresh = 0.7 - sensitivity * 0.45;
  const frameThresh = 0.5 - sensitivity * 0.3;
  const events = noteFramesToTime(outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, 11, true, null, null, true));

  const notes: PieceNote[] = events
    .filter((e) => e.pitchMidi >= 21 && e.pitchMidi <= 108 && e.durationSeconds > 0.03)
    .map((e) => ({
      midi: e.pitchMidi,
      time: Math.max(0, e.startTimeSeconds),
      duration: e.durationSeconds,
      velocity: Math.min(1, Math.max(0.2, e.amplitude)),
      hand: e.pitchMidi >= 60 ? 'right' : 'left',
    }));
  if (notes.length === 0) throw new Error('Aucune note reconnue : essaie une sensibilité plus haute ou un enregistrement plus net');

  return {
    ...guessNames(file.name),
    source: 'audio',
    bpm: null,
    notes,
    warnings: ['Transcription automatique : des notes peuvent manquer ou être en trop. Les mains sont réparties automatiquement.'],
  };
}
