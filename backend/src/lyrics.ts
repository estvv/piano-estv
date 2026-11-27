import { z } from 'zod';

// Lyrics of songs, with the time of each line when it is known, from LRCLIB (no
// key needed). Only the title and the artist are sent, when asked for.

export interface FoundLyrics {
  id: number;
  title: string;
  artist: string;
  album: string;
  // Of the recording the times are from, seconds.
  duration: number;
  // LRC text; null: the times are not known.
  synced: string | null;
  plain: string | null;
}

export type LyricsFinder = (title: string, artist: string | null) => Promise<FoundLyrics[]>;

// Shown to the user as it is.
export class LyricsError extends Error {}

const TIMEOUT = 10_000;
const MAX = 8;

const text = z.string().nullish().transform((v) => (v?.trim() ? v : null));
const records = z.array(z.object({
  id: z.number(),
  trackName: text,
  artistName: text,
  albumName: text,
  duration: z.number().nullish().transform((v) => v ?? 0),
  instrumental: z.boolean().nullish(),
  plainLyrics: text,
  syncedLyrics: text,
}));

export const catalogLyrics: LyricsFinder = async (title, artist) => {
  const query = new URLSearchParams({ track_name: title, ...(artist ? { artist_name: artist } : {}) });
  let response: Response;
  try {
    response = await fetch(`https://lrclib.net/api/search?${query}`, { headers: { 'User-Agent': 'piano-practice/1.0' }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw new LyricsError('LRCLIB n’a pas répondu');
  }
  if (response.status === 429 || response.status === 503) throw new LyricsError('LRCLIB est surchargé, réessaie dans une minute');
  if (!response.ok) throw new LyricsError(`LRCLIB a refusé la demande (${response.status})`);
  const parsed = records.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new LyricsError('Réponse de LRCLIB illisible');
  const found = parsed.data
    .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .map((r): FoundLyrics => ({
      id: r.id, title: r.trackName ?? title, artist: r.artistName ?? '', album: r.albumName ?? '', duration: r.duration, synced: r.syncedLyrics, plain: r.plainLyrics,
    }));
  // With their times first; the same recording is often there several times.
  const seen = new Set<string>();
  return found
    .sort((a, b) => Number(!a.synced) - Number(!b.synced))
    .filter((r) => {
      const key = r.synced ?? r.plain!;
      return !seen.has(key) && !!seen.add(key);
    })
    .slice(0, MAX);
};
