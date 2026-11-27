// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { importMidi } from './importMidi';
import { fileName, midiOf } from './midiExport';
import type { StoredPiece } from './types';
import { videoLink } from './youtube';

const piece = (more: Partial<StoredPiece> = {}): StoredPiece => ({
  id: 1, title: 'Amnésie', artist: 'Damso', source: 'midi', bpm: 120,
  notes: [
    { midi: 48, time: 0, duration: 1, velocity: 0.6, hand: 'left' },
    { midi: 72, time: 0.5, duration: 0.25, velocity: 0.8, hand: 'right' },
    { midi: 76, time: 1, duration: 0.5, velocity: 0.7, hand: 'right' },
  ],
  ...more,
});

describe('a piece as a MIDI file', () => {
  it('comes back as it was, a track for each hand', async () => {
    const file = new File([midiOf(piece()) as BlobPart], 'x.mid');
    const back = await importMidi(file);
    expect(back.bpm).toBe(120);
    expect(back.tracks?.map((t) => t.name)).toEqual(['Main droite', 'Main gauche']);
    const notes = [...back.notes].sort((a, b) => a.time - b.time).map((n) => [n.midi, +n.time.toFixed(3), +n.duration.toFixed(3), n.hand]);
    expect(notes).toEqual([[48, 0, 1, 'left'], [72, 0.5, 0.25, 'right'], [76, 1, 0.5, 'right']]);
  });

  it('is named so that any system takes it', () => {
    expect(fileName(piece())).toBe('Amnésie - Damso.mid');
    expect(fileName(piece({ title: 'A/B: "c"?', artist: null, level: 'melody' }))).toBe('A B c - Mélodie.mid');
  });
});

describe('a link to a video', () => {
  it('is opened from its start', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0s';
    for (const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x&t=42', 'youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', ' https://music.youtube.com/watch?v=dQw4w9WgXcQ ']) {
      expect(videoLink(link)).toBe(watch);
    }
    expect(videoLink('https://www.tiktok.com/@a/video/1')).toBe('https://www.tiktok.com/@a/video/1');
    expect([videoLink('bonjour'), videoLink('https://youtube.com/watch?v=court'), videoLink('javascript:alert(1)'), videoLink('http://localhost/x')]).toEqual([null, null, null, null]);
  });
});
