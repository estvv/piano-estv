import { describe, expect, it } from 'vitest';
import { placeAt } from './encode';
import { cleanedVideo, sizeOf } from './settings';
import { scoreOf } from './sound';

describe('a video', () => {
  it('has the size of its format', () => {
    expect(sizeOf(cleanedVideo({}))).toEqual([1080, 1920]);
    expect(sizeOf(cleanedVideo({ format: 'landscape' }))).toEqual([1920, 1080]);
    expect(sizeOf(cleanedVideo({ format: 'portrait', quality: 720 }))).toEqual([720, 1280]);
  });

  it('keeps only what makes sense', () => {
    const v = cleanedVideo({ format: 'square' as never, quality: 480 as never, logo: 'x'.repeat(99), logoImage: 'https://evil.test/a.png', sound: false });
    expect(v).toMatchObject({ format: 'portrait', quality: 1080, cover: true, keyNames: 'letters', sound: false, lyrics: true, logoImage: '' });
    expect(v.logo).toHaveLength(40);
  });

  it('draws the piece where its sound is', () => {
    expect([placeAt(10, 0.5, -1), placeAt(10, 0.5, 0), placeAt(10, 0.5, 4)]).toEqual([10, 10, 12]);
  });

  it('sounds the notes of what is filmed, at its speed', async () => {
    const n = (time: number) => ({ midi: 60, time, duration: 1, velocity: 0.7, hand: 'right' as const });
    const score = await scoreOf([n(5), n(10), n(12), n(20)], 10, 20, 0.5, null);
    expect(score.notes.map((x) => [x.time, x.duration])).toEqual([[0, 2], [4, 2]]);
    expect(score.length).toBeCloseTo(21.5);
    expect(score.clips).toEqual([]);
  });
});
