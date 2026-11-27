import Database from 'better-sqlite3';
import type { DB } from './index.js';

// Copies the accounts and the piano of a learn-estv database into this one:
// users (password, picture), folders, pieces, takes and time played. Ids are
// kept, so links to a piece (?morceau=12) still lead to it. Sessions are not:
// cookies belong to the old address, everyone logs in again.

export interface ImportCounts {
  users: number;
  folders: number;
  pieces: number;
  takes: number;
  days: number;
}

// The subject the piano lived under in learn-estv.
const SUBJECT = 'piano';

const columnsOf = (db: DB, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

// Whether this database already holds anything worth keeping.
export const hasData = (db: DB) =>
  (db.prepare('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM pieces) AS n').get() as { n: number }).n > 0;

export function openLearn(file: string): DB {
  const learn = new Database(file, { readonly: true, fileMustExist: true });
  for (const table of ['users', 'pieces', 'piece_folders']) {
    if (!columnsOf(learn, table).length) {
      learn.close();
      throw new Error(`${file} n’est pas une base de learn-estv (table ${table} absente)`);
    }
  }
  return learn;
}

// Replaces everything in `db` with what `learn` has. One transaction: on any
// error, `db` stays as it was.
export function importLearn(db: DB, learn: DB): ImportCounts {
  // Rows of `table` in learn, with the columns both databases have.
  const copy = (table: string, where = '1', transform: (row: Record<string, unknown>) => Record<string, unknown> = (r) => r) => {
    const mine = columnsOf(db, table);
    const theirs = new Set(columnsOf(learn, table));
    const shared = mine.filter((c) => theirs.has(c));
    const rows = learn.prepare(`SELECT ${shared.join(', ')} FROM ${table} WHERE ${where}`).all() as Record<string, unknown>[];
    const insert = db.prepare(`INSERT INTO ${table} (${shared.join(', ')}) VALUES (${shared.map((c) => `@${c}`).join(', ')})`);
    for (const row of rows) insert.run(transform(row));
    return rows.length;
  };

  const folders = new Set((learn.prepare('SELECT id FROM piece_folders WHERE subject_id = ?').all(SUBJECT) as { id: number }[]).map((r) => r.id));
  const pieceWhere = `subject_id = '${SUBJECT}'`;
  const ofPieces = `piece_id IN (SELECT id FROM pieces WHERE ${pieceWhere})`;
  const has = (table: string) => columnsOf(learn, table).length > 0;

  db.pragma('foreign_keys = ON');
  return db.transaction((): ImportCounts => {
    // Folders point at their parent, inserted in any order: checked at the end.
    db.pragma('defer_foreign_keys = ON');
    db.exec('DELETE FROM piece_time; DELETE FROM piece_takes; DELETE FROM pieces; DELETE FROM piece_folders; DELETE FROM sessions; DELETE FROM users;');
    const counts = {
      users: copy('users'),
      folders: copy('piece_folders', `subject_id = '${SUBJECT}'`),
      // A piano piece in a folder of another subject: at the top level.
      pieces: copy('pieces', pieceWhere, (r) => ({ ...r, folder_id: r.folder_id != null && folders.has(r.folder_id as number) ? r.folder_id : null })),
      takes: has('piece_takes') ? copy('piece_takes', ofPieces) : 0,
      days: has('piece_time') ? copy('piece_time', ofPieces) : 0,
    };
    const broken = db.pragma('foreign_key_check') as unknown[];
    if (broken.length) throw new Error(`Copie refusée : ${broken.length} références cassées`);
    return counts;
  })();
}
