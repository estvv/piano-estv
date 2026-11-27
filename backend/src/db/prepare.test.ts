import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './index.js';
import { prepareDatabase } from './prepare.js';

let dir: string;
let file: string;
const silent = () => {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-'));
  file = path.join(dir, 'piano.db');
});
afterEach(() => fs.rmSync(dir, { recursive: true }));

const backups = () => fs.readdirSync(path.join(dir, 'backups'));

describe('prepareDatabase', () => {
  it('has nothing to do without a database', async () => {
    expect(await prepareDatabase(file, 'x', silent)).toBeNull();
  });

  it('saves the database, even while it is open', async () => {
    const live = openDatabase(file);
    live.prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('a', 'h', 0, 1)").run();

    const backup = await prepareDatabase(file, 'abc', silent);
    const saved = new Database(backup!, { readonly: true });
    expect(saved.prepare('SELECT username FROM users').all()).toEqual([{ username: 'a' }]);
    saved.close();
    expect(backups()).toEqual([path.basename(backup!)]);
    live.close();
  });

  it('accepts a database from an older version', async () => {
    const old = openDatabase(file);
    old.exec('DROP TABLE piece_time; DROP INDEX idx_piece_takes');
    old.close();
    await expect(prepareDatabase(file, 'x', silent)).resolves.toContain('.db');
  });

  it('keeps the ten latest backups', async () => {
    openDatabase(file).close();
    fs.mkdirSync(path.join(dir, 'backups'));
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, 'backups', `piano-2020-01-${10 + i}T00-00-00-x.db`), '');
    await prepareDatabase(file, 'x', silent);
    expect(backups()).toHaveLength(10);
    expect(backups()[0]).toContain('2020-01-13');
  });
});
