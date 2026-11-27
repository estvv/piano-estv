import { describe, expect, it } from 'vitest';
import { guessNames } from './names';

describe('title and artist from a file name', () => {
  it.each([
    ['menace Santana - Vengeance ! • Tuto Piano.mp3', 'Vengeance !', 'Menace Santana'],
    ['menace Santana - Vengeance (transcription).mid', 'Vengeance', 'Menace Santana'],
    ['Francis Cabrel - Je l’aime à mourir (Piano Cover) [MIDI].mid', 'Je l’aime à mourir', 'Francis Cabrel'],
    ['Daft_Punk_-_Veridis_Quo.mid', 'Veridis Quo', 'Daft Punk'],
    ['Lettre à Élise.musicxml', 'Lettre à Élise', null],
    ['Interstellar - Main Theme | Synthesia.mp4', 'Main Theme', 'Interstellar'],
    ['Song (Live 2019).mid', 'Song (Live 2019)', null],
  ])('%s', (file, title, artist) => {
    expect(guessNames(file)).toEqual({ title, artist });
  });
});
