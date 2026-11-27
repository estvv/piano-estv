import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogLyrics, LyricsError } from './lyrics.js';

const record = (id: number, more: object = {}) => ({
  id, trackName: 'Chanson', artistName: 'Quelqu’un', albumName: 'Album', duration: 180, instrumental: false, plainLyrics: 'la la', syncedLyrics: `[00:0${id}.00] la la`, ...more,
});
let asked: { url: string; headers: Record<string, string> }[] = [];
const answers = (status: number, body: unknown) => {
  asked = [];
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
    asked.push({ url, headers: init.headers });
    return { status, ok: status === 200, json: async () => body };
  });
};
afterEach(() => vi.unstubAllGlobals());

describe('lyrics from LRCLIB', () => {
  it('come with their times first, once each', async () => {
    answers(200, [record(1, { syncedLyrics: null }), record(2), record(3, { syncedLyrics: '[00:02.00] la la' }), record(4, { instrumental: true }), record(5, { plainLyrics: null, syncedLyrics: null })]);
    const found = await catalogLyrics('Chanson & co', 'Quelqu’un');
    expect(found.map((f) => [f.id, f.synced])).toEqual([[2, '[00:02.00] la la'], [1, null]]);
    const url = new URL(asked[0].url);
    expect([...url.searchParams]).toEqual([['track_name', 'Chanson & co'], ['artist_name', 'Quelqu’un']]);
  });

  it('only ask for the title when the artist is not known', async () => {
    answers(200, []);
    expect(await catalogLyrics('Chanson', null)).toEqual([]);
    expect(asked[0].url).not.toContain('artist_name');
  });

  it('say what went wrong', async () => {
    answers(429, null);
    await expect(catalogLyrics('x', null)).rejects.toThrow('surchargé');
    answers(400, null);
    await expect(catalogLyrics('x', null)).rejects.toThrow(LyricsError);
    answers(200, { not: 'a list' });
    await expect(catalogLyrics('x', null)).rejects.toThrow('illisible');
    vi.stubGlobal('fetch', async () => { throw new Error('network'); });
    await expect(catalogLyrics('x', null)).rejects.toThrow('pas répondu');
  });
});
