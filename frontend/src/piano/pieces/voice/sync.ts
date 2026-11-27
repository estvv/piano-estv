// Where a recording is for each place in a piece. Two moments known in both are
// enough: how far apart they are, and how fast one goes next to the other.

// Seconds in the piece, seconds in the recording.
export interface SyncPoint { piece: number; audio: number }

// Closer than this, two moments do not tell a speed.
const TELLING = 10;
// Further than this from the same speed, one of them is wrong.
const SANE = [0.7, 1.4];

export interface Sync { offset: number; speed: number }

// recording = piece * speed + offset
export function syncOf(points: readonly SyncPoint[]): Sync {
  const known = [...points].sort((a, b) => a.piece - b.piece);
  const [first] = known;
  if (!first) return { offset: 0, speed: 1 };
  const last = known[known.length - 1];
  const apart = last.piece - first.piece;
  const speed = apart >= TELLING ? (last.audio - first.audio) / apart : 1;
  const sane = speed >= SANE[0] && speed <= SANE[1] ? speed : 1;
  return { offset: first.audio - first.piece * sane, speed: sane };
}

// Two points that cannot both be right.
export function conflict(points: readonly SyncPoint[]): boolean {
  if (points.length < 2) return false;
  const [a, b] = [...points].sort((x, y) => x.piece - y.piece);
  const speed = (b.audio - a.audio) / (b.piece - a.piece);
  return b.piece - a.piece >= TELLING && !(speed >= SANE[0] && speed <= SANE[1]);
}
