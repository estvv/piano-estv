// Title and artist guessed from a file or video name, such as
// "menace Santana - Vengeance ! • Tuto Piano.mp3".

// Words that describe the file rather than the song.
const NOISE = /\b(piano|tuto(rial)?|cover|synthesia|midi|transcription|sheet( music)?|partition|easy|facile|beginner|d[ée]butant|instrumental|karaoke|lyrics?|paroles|official|audio|video|clip|hq|hd|4k|remix version)\b/i;

export function guessNames(raw: string): { title: string; artist: string | null } {
  let name = raw
    .replace(/\.[a-z0-9]{2,8}$/i, '') // extension
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Bracketed or trailing parts that only describe the file: "(Piano Cover)",
  // "[MIDI]", "• Tuto Piano", "| Synthesia".
  name = name.replace(/\s*[([{【]([^)\]}】]*)[)\]}】]/g, (all, inner: string) => (NOISE.test(inner) ? '' : all));
  name = name.replace(/\s*[•|·~]\s*([^•|·~]*)$/, (all, tail: string) => (NOISE.test(tail) || !tail.trim() ? '' : all)).trim();

  // "Artist - Title": the first dash between spaces.
  const parts = name.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts.slice(1).join(' - ')) {
    return { artist: capitalize(parts[0]), title: capitalize(parts.slice(1).join(' - ')) };
  }
  return { title: capitalize(name || raw), artist: null };
}

const capitalize = (s: string) => s.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
