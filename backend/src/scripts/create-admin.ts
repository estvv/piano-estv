// Bootstrap: create (or reset) an admin account from the command line.
//   npm run create-admin -w backend -- <username>
// In Docker: docker compose exec backend npm run create-admin -- <username>
import { generatePassword, hashPassword } from '../auth/crypto.js';
import { destroyUserSessions } from '../auth/session.js';
import { openDatabase } from '../db/index.js';

const [username] = process.argv.slice(2);
if (!username || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
  console.error('Usage: create-admin <username>');
  process.exit(1);
}

const db = openDatabase();
const password = generatePassword();
const hash = await hashPassword(password);
const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username) as { id: number } | undefined;
if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, is_admin = 1, disabled = 0 WHERE id = ?').run(hash, existing.id);
  destroyUserSessions(db, existing.id);
  console.log(`Admin « ${username} » réinitialisé.`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)').run(username, hash, Date.now());
  console.log(`Admin « ${username} » créé.`);
}
console.log(`Mot de passe : ${password}`);
console.log('Modifiable ensuite dans « Mon compte ».');
db.close();
