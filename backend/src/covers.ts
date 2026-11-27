// Cover art for imported pieces, from public catalogues that need no key:
// Deezer first, then Apple Music (iTunes Search). When the song is out on
// several releases, the album's cover wins over an EP's, then a single's, and
// the original version over live recordings and remixes. Song not found: a photo of the artist.
// Only the title and the artist are sent, never the notes.

export type CoverFinder = (title: string, artist: string | null) => Promise<string | null>;

const TIMEOUT = 5000;
// Releases looked up per song on Deezer (its search does not say whether a
// release is an album or a single).
const MAX_RELEASES = 6;

type Release = 'album' | 'ep' | 'single' | 'compile';
const RANK: Record<Release, number> = { album: 0, ep: 1, single: 2, compile: 3 };

// variant: live recording, remix, cover…
interface Candidate { cover: string; release: Release; variant: boolean }

// Accents, case and punctuation do not matter when comparing names.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const VARIANT = /\b(live|public|concert|en direct|unplugged|acoustic version|remix|rmx|cover|karaoke|instrumental|lullaby)\b/i;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// "Je l'aime à mourir (Remastered)" matches "Je l'aime à mourir".
const sameTitle = (found: string, wanted: string) => {
  const f = norm(found);
  const w = norm(wanted);
  return f.length > 0 && w.length > 0 && (f.includes(w) || w.includes(f));
};
const sameArtist = (found: string, wanted: string | null) => !wanted || norm(found) === norm(wanted) || norm(found).includes(norm(wanted));

function best(candidates: (Candidate | null)[]): Candidate | null {
  const sorted = candidates.filter((c): c is Candidate => c !== null).sort((a, b) => Number(a.variant) - Number(b.variant) || RANK[a.release] - RANK[b.release]);
  return sorted[0] ?? null;
}

// --- Deezer --------------------------------------------------------------------

interface DzTrack { title: string; artist: { name: string }; album: { id: number; title: string; cover_medium?: string } }

async function deezerSong(title: string, artist: string | null): Promise<Candidate | null> {
  const q = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const found = await getJson<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${q}&limit=25`);
  const albums = new Map<number, DzTrack>();
  for (const t of found?.data ?? []) {
    if (sameArtist(t.artist.name, artist) && sameTitle(t.title, title) && t.album.cover_medium && !albums.has(t.album.id)) albums.set(t.album.id, t);
  }
  const picked = [...albums.values()].slice(0, MAX_RELEASES);
  const candidates = await Promise.all(picked.map(async (t) => {
    const album = await getJson<{ record_type?: string }>(`https://api.deezer.com/album/${t.album.id}`);
    const release = (album?.record_type ?? 'single') as Release;
    return { cover: t.album.cover_medium!, release: release in RANK ? release : 'single', variant: VARIANT.test(t.title) || VARIANT.test(t.album.title) };
  }));
  return best(candidates);
}

async function deezerArtist(artist: string): Promise<string | null> {
  const found = await getJson<{ data?: { name: string; picture_medium?: string }[] }>(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=10`);
  return found?.data?.find((a) => norm(a.name) === norm(artist))?.picture_medium ?? null;
}

// --- Apple Music (iTunes Search) -------------------------------------------------

interface ItSong { trackName: string; artistName: string; collectionName: string; artworkUrl100?: string }

async function appleSong(title: string, artist: string | null): Promise<Candidate | null> {
  const term = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const found = await getJson<{ results?: ItSong[] }>(`https://itunes.apple.com/search?term=${term}&entity=song&country=fr&limit=25`);
  const candidates = (found?.results ?? [])
    .filter((s) => s.artworkUrl100 && sameArtist(s.artistName, artist) && sameTitle(s.trackName, title))
    .map((s): Candidate => ({
      // Same image, bigger: 250 px like Deezer's.
      cover: s.artworkUrl100!.replace(/\/\d+x\d+bb\./, '/250x250bb.'),
      release: / - single$/i.test(s.collectionName) ? 'single' : / - ep$/i.test(s.collectionName) ? 'ep' : 'album',
      variant: VARIANT.test(s.trackName) || VARIANT.test(s.collectionName),
    }));
  return best(candidates);
}

export const catalogCover: CoverFinder = async (title, artist) => {
  // Both catalogues at once; on a tie (same kind of release) Deezer wins.
  const song = best(await Promise.all([deezerSong(title, artist), appleSong(title, artist)]));
  return song?.cover ?? (artist ? await deezerArtist(artist) : null);
};

// --- Cover chosen from a link -------------------------------------------------------

// Covers are only taken from the catalogues' image servers.
// A cover sent from the owner's own files, as a data URL (resized beforehand).
export const MAX_UPLOADED_COVER = 600_000;
export const isUploadedCover = (s: string) => s.length <= MAX_UPLOADED_COVER && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s);
// Where an uploaded cover is served; the list gives this, not the image. `v`
// changes with the image, so that browsers do not show the one before.
export const coverPath = (id: number, data: string) => `/api/pieces/${id}/image?v=${data.length}`;
export const coverPathId = (s: string) => Number(/^\/api\/pieces\/(\d+)\/image(\?v=\d+)?$/.exec(s)?.[1] ?? NaN);

export const isCatalogImage = (url: string) => /^https:\/\/([a-z0-9-]+\.)?(dzcdn\.net|mzstatic\.com)\//i.test(url);

// A Deezer or Apple Music link (song, album or artist page) -> its cover.
// Lookups by id work even where the catalogue's search hides the song.
export async function coverFromLink(link: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  // Short share links (link.deezer.com, dzr.page.link) redirect to the page.
  if (/^(link\.deezer\.com|dzr\.page\.link|deezer\.page\.link)$/i.test(url.hostname)) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
      url = new URL(res.url);
    } catch {
      return null;
    }
  }

  if (/(^|\.)deezer\.com$/i.test(url.hostname)) {
    const m = url.pathname.match(/\/(track|album|artist)\/(\d+)/);
    if (!m) return null;
    const [, kind, id] = m;
    if (kind === 'track') return (await getJson<{ album?: { cover_medium?: string } }>(`https://api.deezer.com/track/${id}`))?.album?.cover_medium ?? null;
    if (kind === 'album') return (await getJson<{ cover_medium?: string }>(`https://api.deezer.com/album/${id}`))?.cover_medium ?? null;
    return (await getJson<{ picture_medium?: string }>(`https://api.deezer.com/artist/${id}`))?.picture_medium ?? null;
  }

  if (/(^|\.)apple\.com$/i.test(url.hostname)) {
    // music.apple.com/fr/album/<name>/<album id>?i=<song id>, or /song/<name>/<id>.
    const id = url.searchParams.get('i') ?? url.pathname.match(/\/(?:album|song)\/[^/]*\/?(\d+)/)?.[1] ?? url.pathname.match(/\/(\d+)(?:$|\/)/)?.[1];
    if (!id) return null;
    const found = await getJson<{ results?: { artworkUrl100?: string }[] }>(`https://itunes.apple.com/lookup?id=${id}&country=fr`);
    return found?.results?.find((r) => r.artworkUrl100)?.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/250x250bb.') ?? null;
  }
  return null;
}
