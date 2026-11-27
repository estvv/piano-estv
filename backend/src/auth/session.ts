import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { toPublicUser, USER_FIELDS_SQL, type PublicUser } from '../users.js';
import { randomToken, sha256 } from './crypto.js';

export const SESSION_COOKIE = 'piano_session';
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;

export type SessionUser = PublicUser;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

function cookieOptions(maxAge?: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, path: '/', maxAge };
}

export function createSession(db: DB, res: Response, userId: number) {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + SESSION_MS);
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MS));
}

export function destroySession(db: DB, req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function destroyUserSessions(db: DB, userId: number, exceptReq?: Request) {
  const keep = exceptReq?.cookies?.[SESSION_COOKIE];
  if (typeof keep === 'string') {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(keep));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// Populates req.user when a valid session cookie is present. Never rejects:
// the routes that need an account say so (requireUser).
export function loadSession(db: DB) {
  const find = db.prepare(`
    SELECT ${USER_FIELDS_SQL}
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
  `);
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) {
      const row = find.get(sha256(token), Date.now()) as Record<string, unknown> | undefined;
      if (row) req.user = toPublicUser(row);
    }
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return void res.status(401).json({ success: false, error: 'Non connecté' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, () => {
    if (!req.user!.is_admin) return void res.status(403).json({ success: false, error: 'Réservé à l’admin' });
    next();
  });
}

export function purgeExpiredSessions(db: DB) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}
