import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './index.js';

const KEEP = 10;

// Of a copy: it also becomes a single file, without WAL companions.
function problems(copy: string): { integrity: string; foreignKeys: number } {
  const db = new Database(copy, { fileMustExist: true });
  try {
    db.pragma('journal_mode = DELETE');
    return {
      integrity: db.pragma('integrity_check', { simple: true }) as string,
      foreignKeys: (db.pragma('foreign_key_check') as unknown[]).length,
    };
  } finally {
    db.close();
  }
}

function remove(file: string) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}

// Before a deploy, while the previous version still runs: saves the database,
// then rehearses this version's update (tables, columns) on a copy.
// Throws when the update would fail; the real database is only read.
export async function prepareDatabase(file: string, label: string, log = console.log): Promise<string | null> {
  if (!fs.existsSync(file)) {
    log('Pas encore de base : rien à sauvegarder.');
    return null;
  }
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = path.join(dir, `piano-${stamp}-${label}.db`);

  const source = new Database(file, { fileMustExist: true });
  try {
    await source.backup(backup);
  } finally {
    source.close();
  }
  const before = problems(backup);
  if (before.integrity !== 'ok') throw new Error(`Base abîmée avant la mise à jour : ${before.integrity}`);
  log(`Base sauvegardée : ${path.basename(backup)}`);

  const rehearsal = `${backup}.essai`;
  try {
    fs.copyFileSync(backup, rehearsal);
    openDatabase(rehearsal).close();
    const after = problems(rehearsal);
    if (after.integrity !== 'ok') throw new Error(`La mise à jour abîmerait la base : ${after.integrity}`);
    if (after.foreignKeys > before.foreignKeys) throw new Error('La mise à jour laisserait des références cassées');
  } finally {
    remove(rehearsal);
  }
  log('Mise à jour de la base répétée sur une copie : tout va bien.');

  const old = fs.readdirSync(dir).filter((f) => /^piano-.*\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return backup;
}
