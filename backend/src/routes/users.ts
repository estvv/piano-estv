import { Router } from 'express';
import { requireUser } from '../auth/session.js';
import type { DB } from '../db/index.js';

// Profile pictures: accounts only.
export function userRoutes(db: DB) {
  const router = Router();
  router.use(requireUser);

  router.get('/:id/avatar', (req, res) => {
    const row = db.prepare('SELECT avatar, avatar_type FROM users WHERE id = ? AND avatar IS NOT NULL AND disabled = 0').get(Number(req.params.id)) as
      | { avatar: Buffer; avatar_type: string }
      | undefined;
    if (!row) return void res.status(404).end();
    res.set({ 'Content-Type': row.avatar_type, 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.send(row.avatar);
  });

  return router;
}
