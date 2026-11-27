import type { DB } from './db/index.js';

// Time spent playing pieces, day by day.

// Days are counted in the owner's time zone, not the server's (UTC in Docker).
const TIME_ZONE = process.env.TZ_STATS ?? 'Europe/Paris';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (ms: number) => dayFormat.format(new Date(ms)); // YYYY-MM-DD

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const DAYS = 13 * 7;
const TOP = 8;

export interface Practice {
  today: number; // seconds
  // Oldest first, today last.
  days: { day: string; seconds: number }[];
  pieces: { id: number; title: string; artist: string | null; cover: string | null; seconds: number; last: string; best: number | null }[];
}

export function practiceOf(db: DB, userId: number, now = Date.now()): Practice {
  const today = dayKey(now);
  const perDay = new Map((db.prepare(`
    SELECT day, SUM(seconds) AS seconds FROM piece_time WHERE user_id = ? GROUP BY day
  `).all(userId) as { day: string; seconds: number }[]).map((r) => [r.day, r.seconds]));
  const pieces = db.prepare(`
    SELECT p.id, p.title, p.artist, NULLIF(p.cover, '') AS cover, SUM(t.seconds) AS seconds, MAX(t.day) AS last,
      (SELECT MAX(score) FROM piece_takes k WHERE k.piece_id = p.id) AS best
    FROM piece_time t JOIN pieces p ON p.id = t.piece_id
    WHERE t.user_id = ? GROUP BY p.id ORDER BY seconds DESC LIMIT ?
  `).all(userId, TOP) as Practice['pieces'];
  return {
    today: perDay.get(today) ?? 0,
    days: Array.from({ length: DAYS }, (_, i) => {
      const day = shiftDay(today, i - DAYS + 1);
      return { day, seconds: perDay.get(day) ?? 0 };
    }),
    pieces,
  };
}

export function addTime(db: DB, userId: number, pieceId: number, seconds: number, now = Date.now()) {
  db.prepare(`
    INSERT INTO piece_time (user_id, piece_id, day, seconds) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, piece_id, day) DO UPDATE SET seconds = seconds + excluded.seconds
  `).run(userId, pieceId, dayKey(now), Math.round(seconds));
}
