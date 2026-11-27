import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/crypto.js';
import { createSession, destroySession, destroyUserSessions, requireUser } from '../auth/session.js';
import type { DB } from '../db/index.js';
import { MAX_AVATAR_BYTES, sniffImageType } from '../users.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Trop de tentatives, réessaie plus tard' },
});

const loginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const passwordBody = z.object({ current: z.string().min(1).max(256), next: z.string().min(8).max(256) });
const profileBody = z.object({ display_name: z.string().trim().min(1, 'Le nom affiché est vide').max(40, 'Nom affiché : 40 caractères maximum') });

export function authRoutes(db: DB) {
  const router = Router();
  // Computed once so an unknown username costs as much as a wrong password.
  const dummyHash = hashPassword('dummy-password-for-timing');

  router.post('/login', loginLimiter, async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Identifiant ou mot de passe incorrect' });
    const user = db.prepare('SELECT id, password_hash, disabled FROM users WHERE lower(username) = lower(?)').get(parsed.data.username) as
      | { id: number; password_hash: string; disabled: number }
      | undefined;
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? await dummyHash);
    if (!user || !ok || user.disabled) return void res.status(401).json({ success: false, error: 'Identifiant ou mot de passe incorrect' });
    createSession(db, res, user.id);
    res.json({ success: true });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ success: true });
  });

  router.get('/me', (req, res) => {
    res.json({ success: true, data: req.user ?? null });
  });

  router.patch('/profile', requireUser, (req, res) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: parsed.error.issues[0].message });
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(parsed.data.display_name, req.user!.id);
    res.json({ success: true });
  });

  router.put('/avatar', requireUser, express.raw({ type: 'image/*', limit: MAX_AVATAR_BYTES }), (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    const type = bytes ? sniffImageType(bytes) : null;
    if (!bytes || !type) return void res.status(400).json({ success: false, error: 'Image invalide (WebP, JPEG ou PNG)' });
    db.prepare('UPDATE users SET avatar = ?, avatar_type = ?, avatar_updated_at = ? WHERE id = ?').run(bytes, type, Date.now(), req.user!.id);
    res.json({ success: true });
  });

  router.delete('/avatar', requireUser, (req, res) => {
    db.prepare('UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL WHERE id = ?').run(req.user!.id);
    res.json({ success: true });
  });

  router.post('/password', requireUser, async (req, res) => {
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!(await verifyPassword(parsed.data.current, row.password_hash))) {
      return void res.status(400).json({ success: false, error: 'Mot de passe actuel incorrect' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(parsed.data.next), req.user!.id);
    destroyUserSessions(db, req.user!.id, req);
    res.json({ success: true });
  });

  return router;
}
