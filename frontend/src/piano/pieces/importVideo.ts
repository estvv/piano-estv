import { guessNames } from './names';
import type { ImportResult } from './types';
import { findKeyboard, NoLitKeys, notesOf, sample, usualPicture, type FoundKeyboard, type Picture } from './videoKeys';

// A video where the keys of a keyboard light up (falling notes), read picture
// by picture in the browser. Nothing is sent to the server.

const RATE = 24; // pictures read per second
const WIDTH = 960;
const MAX_SECONDS = 8 * 60;
const LOOKED_AT = 21; // pictures the keyboard is searched on

// Nothing to read on the pictures: the sound may do.
export class NoKeyboard extends Error {}

export async function importVideo(file: File, onProgress: (percent: number) => void): Promise<ImportResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new NoKeyboard('Vidéo illisible par ce navigateur'));
      video.src = url;
    });
    // Recordings made in the browser do not say how long they are: looking for
    // their end tells.
    if (video.duration === Infinity) {
      await seek(video, Number.MAX_SAFE_INTEGER);
      await seek(video, 0);
    }
    if (!video.videoWidth || !Number.isFinite(video.duration)) throw new NoKeyboard('Ce fichier n’a pas d’image');
    if (video.duration > MAX_SECONDS) throw new Error('Vidéo trop longue (8 minutes maximum)');

    const scale = Math.min(1, WIDTH / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const at = async (time: number): Promise<Picture> => {
      await seek(video, time);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    };

    const some: Picture[] = [];
    for (let i = 0; i < LOOKED_AT; i++) some.push(await at(((i + 0.5) / LOOKED_AT) * video.duration));
    const keyboard: FoundKeyboard | null = findKeyboard(usualPicture(some));
    if (!keyboard) throw new NoKeyboard('Aucun clavier de piano bien visible dans cette vidéo');

    const count = Math.floor(video.duration * RATE);
    const samples: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(sample(await at((i + 0.5) / RATE), keyboard));
      if (i % 12 === 0) onProgress(i / count);
    }
    const notes = read(samples, keyboard);
    return {
      ...guessNames(file.name),
      source: 'video',
      bpm: null,
      notes,
      warnings: [
        ...(keyboard.whole ? [] : ['Le clavier n’est pas entier dans la vidéo : l’octave est supposée. Si tout est trop grave ou trop aigu, change l’octave ci-dessous.']),
        ...(notes.every((n) => !n.hand) ? ['Une seule couleur de notes : les mains sont réparties automatiquement.'] : []),
      ],
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function read(samples: Float32Array[], keyboard: FoundKeyboard) {
  try {
    return notesOf(samples, keyboard, RATE);
  } catch (e) {
    if (e instanceof NoLitKeys) throw new NoKeyboard(e.message);
    throw e;
  }
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(() => reject(new NoKeyboard('Cette vidéo ne peut pas être lue image par image'))), 8000);
    const onSeeked = () => done(resolve);
    const done = (then: () => void) => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      then();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = Number.isFinite(video.duration) ? Math.min(time, Math.max(0, video.duration - 0.01)) : time;
  });
}
