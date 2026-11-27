import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { schema } from './schema.js';

export type DB = Database.Database;

// Columns added after the first schema: created on fresh databases and on
// existing ones alike. New column: in schema.ts and here (see docs/DEPLOY.md).
const addedColumns: [table: string, column: string, definition: string][] = [];

function migrate(db: DB) {
  for (const [table, column, definition] of addedColumns) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(file = config.dbPath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  migrate(db);
  return db;
}
