import { Router } from 'express';
import { z } from 'zod';
import { generatePassword, hashPassword } from '../auth/crypto.js';
import { destroyUserSessions, requireAdmin } from '../auth/session.js';
import type { DB } from '../db/index.js';
import { usernameRule, USER_FIELDS_SQL } from '../users.js';

const username = z.string().trim().regex(usernameRule, 'Identifiant : 2 à 32 caractères (lettres, chiffres, . _ -)');
const displayName = z.string().trim().min(1).max(40, 'Nom affiché : 40 caractères maximum');

export function adminRoutes(db: DB) {
  const router = Router();
  router.use(requireAdmin);

  const taken = (name: string, exceptId = 0) =>
    !!db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?) AND id != ?').get(name, exceptId);

  router.get('/users', (_req, res) => {
    const users = db.prepare(`
      SELECT ${USER_FIELDS_SQL}, u.disabled, u.created_at,
        NULLIF(MAX(
          COALESCE((SELECT MAX(at) FROM piece_takes k WHERE k.user_id = u.id), 0),
          COALESCE((SELECT MAX(created_at) FROM pieces p WHERE p.user_id = u.id), 0),
          -- Noon of the last day played.
          COALESCE((SELECT (CAST(strftime('%s', MAX(day)) AS INTEGER) + 43200) * 1000 FROM piece_time t WHERE t.user_id = u.id), 0)
        ), 0) AS last_activity
      FROM users u ORDER BY u.created_at
    `).all() as Record<string, unknown>[];
    res.json({ success: true, data: users.map((u) => ({ ...u, is_admin: !!u.is_admin, disabled: !!u.disabled })) });
  });

  router.post('/users', async (req, res) => {
    const parsed = z.object({ username, display_name: displayName.optional(), is_admin: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: parsed.error.issues[0].message });
    if (taken(parsed.data.username)) return void res.status(409).json({ success: false, error: 'Cet identifiant est déjà pris' });
    const password = generatePassword();
    db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(parsed.data.username, parsed.data.display_name || null, await hashPassword(password), parsed.data.is_admin ? 1 : 0, Date.now());
    res.status(201).json({ success: true, data: { username: parsed.data.username, password } });
  });

  router.post('/users/:id/reset', async (req, res) => {
    const id = Number(req.params.id);
    const password = generatePassword();
    const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), id);
    if (!r.changes) return void res.status(404).json({ success: false, error: 'Compte introuvable' });
    destroyUserSessions(db, id);
    res.json({ success: true, data: { password } });
  });

  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({
      username: username.optional(),
      display_name: displayName.optional(),
      disabled: z.boolean().optional(),
      is_admin: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: parsed.error.issues[0].message });
    const { username: name, display_name, disabled, is_admin } = parsed.data;
    const self = id === req.user!.id;
    if (self && (disabled !== undefined || is_admin !== undefined)) {
      return void res.status(400).json({ success: false, error: 'Impossible de désactiver ou rétrograder son propre compte' });
    }
    if (name !== undefined) {
      if (taken(name, id)) return void res.status(409).json({ success: false, error: 'Cet identifiant est déjà pris' });
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id);
    }
    if (display_name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name, id);
    if (disabled !== undefined) {
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
      if (disabled) destroyUserSessions(db, id);
    }
    if (is_admin !== undefined) db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, id);
    res.json({ success: true });
  });

  router.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) return void res.status(400).json({ success: false, error: 'Impossible de supprimer son propre compte' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  });

  return router;
}
