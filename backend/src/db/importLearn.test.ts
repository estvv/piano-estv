import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/crypto.js';
import { hasData, importLearn, openLearn } from './importLearn.js';
import { openDatabase, type DB } from './index.js';

// The tables of learn-estv that matter here, as they were when the piano left.
const LEARN_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
  display_name TEXT, avatar BLOB, avatar_type TEXT, avatar_updated_at INTEGER);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE piece_folders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, subject_id TEXT NOT NULL, name TEXT NOT NULL,
  position INTEGER NOT NULL, created_at INTEGER NOT NULL, parent_id INTEGER);
CREATE TABLE pieces (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, subject_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
  bpm REAL, data TEXT NOT NULL, note_count INTEGER NOT NULL, duration REAL NOT NULL, created_at INTEGER NOT NULL,
  artist TEXT, folder_id INTEGER, difficulty TEXT, cover TEXT, tracks TEXT, description TEXT, level TEXT, sections TEXT, score TEXT,
  edits TEXT, numbers TEXT, lyrics TEXT, numbering TEXT, whole INTEGER, sequence TEXT);
CREATE TABLE piece_takes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, piece_id INTEGER NOT NULL, level TEXT NOT NULL, part TEXT NOT NULL,
  score INTEGER NOT NULL, chords INTEGER NOT NULL, wrong INTEGER NOT NULL, rate REAL NOT NULL, at INTEGER NOT NULL);
CREATE TABLE piece_time (user_id INTEGER NOT NULL, piece_id INTEGER NOT NULL, day TEXT NOT NULL, seconds INTEGER NOT NULL, PRIMARY KEY (user_id, piece_id, day));
CREATE TABLE srs_state (user_id INTEGER NOT NULL, element_id TEXT NOT NULL, facet TEXT NOT NULL, card TEXT NOT NULL, due_at INTEGER NOT NULL);
`;

const notes = JSON.stringify([{ midi: 60, time: 0, duration: 1, velocity: 0.8, hand: 'right' }]);

let dir: string;
let learnFile: string;
let db: DB;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-import-'));
  learnFile = path.join(dir, 'learn.db');
  const learn = new Database(learnFile);
  learn.exec(LEARN_SCHEMA);
  const hash = await hashPassword('password123');
  learn.prepare("INSERT INTO users (id, username, password_hash, is_admin, created_at, display_name, avatar, avatar_type, avatar_updated_at) VALUES (3, 'estv', ?, 1, 1, 'Estève', x'52494646', 'image/webp', 5)").run(hash);
  learn.prepare("INSERT INTO users (id, username, password_hash, disabled, created_at) VALUES (7, 'ami', ?, 0, 2)").run(hash);
  learn.exec(`
    INSERT INTO sessions VALUES ('t', 3, 9999999999999);
    -- A subfolder written before its parent, and a folder of another subject.
    INSERT INTO piece_folders (id, user_id, subject_id, name, position, created_at, parent_id) VALUES (5, 3, 'piano', 'Chopin', 0, 1, 4);
    INSERT INTO piece_folders (id, user_id, subject_id, name, position, created_at, parent_id) VALUES (4, 3, 'piano', 'Priorité', 0, 1, NULL);
    INSERT INTO piece_folders (id, user_id, subject_id, name, position, created_at, parent_id) VALUES (9, 3, 'guitare', 'Autre', 0, 1, NULL);
    INSERT INTO pieces (id, user_id, subject_id, title, source, bpm, data, note_count, duration, created_at, folder_id, lyrics, numbering, whole)
      VALUES (12, 3, 'piano', 'Nocturne', 'midi', 90, '${notes}', 1, 1, 3, 5, '[{"time":0,"text":"la"}]', 'hand', 1);
    INSERT INTO pieces (id, user_id, subject_id, title, source, bpm, data, note_count, duration, created_at, folder_id)
      VALUES (13, 7, 'piano', 'Gamme', 'manual', 60, '${notes}', 1, 1, 4, 9);
    INSERT INTO pieces (id, user_id, subject_id, title, source, bpm, data, note_count, duration, created_at)
      VALUES (14, 3, 'guitare', 'Riff', 'midi', 60, '${notes}', 1, 1, 4);
    INSERT INTO piece_takes VALUES (1, 3, 12, 'original', '', 80, 10, 2, 1, 6);
    INSERT INTO piece_takes VALUES (2, 3, 14, 'original', '', 50, 10, 2, 1, 6);
    INSERT INTO piece_time VALUES (3, 12, '2026-11-20', 300);
    INSERT INTO piece_time VALUES (3, 14, '2026-11-20', 100);
  `);
  learn.close();
  db = openDatabase(path.join(dir, 'piano.db'));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true });
});

describe('importLearn', () => {
  it('copies the accounts and the piano, ids included', async () => {
    const learn = openLearn(learnFile);
    expect(importLearn(db, learn)).toEqual({ users: 2, folders: 2, pieces: 2, takes: 1, days: 1 });
    learn.close();

    expect(db.prepare('SELECT id, username, display_name, is_admin FROM users ORDER BY id').all()).toEqual([
      { id: 3, username: 'estv', display_name: 'Estève', is_admin: 1 },
      { id: 7, username: 'ami', display_name: null, is_admin: 0 },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT id, parent_id FROM piece_folders ORDER BY id').all()).toEqual([{ id: 4, parent_id: null }, { id: 5, parent_id: 4 }]);
    expect(db.prepare('SELECT id, folder_id, numbering, whole FROM pieces ORDER BY id').all()).toEqual([
      { id: 12, folder_id: 5, numbering: 'hand', whole: 1 },
      { id: 13, folder_id: null, numbering: null, whole: null },
    ]);

    // Same password, same piece behind the same link.
    const app = createApp(db, { findCover: async () => null });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'estv', password: 'password123' }).expect(200);
    const piece = (await agent.get('/api/pieces/12').expect(200)).body.data;
    expect(piece).toMatchObject({ title: 'Nocturne', folder_id: 5, numbering: 'hand', whole: true, lyrics: [{ time: 0, text: 'la' }] });
    expect((await agent.get('/api/pieces/practice').expect(200)).body.data.pieces[0]).toMatchObject({ id: 12, seconds: 300, best: 80 });
    const me = (await agent.get('/api/auth/me').expect(200)).body.data;
    expect((await agent.get(me.avatar_url).expect(200)).headers['content-type']).toBe('image/webp');
    await agent.get('/api/pieces/14').expect(404);
  });

  it('replaces what was there, and can be run again', async () => {
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'avant', ?, 0)").run(await hashPassword('x'));
    expect(hasData(db)).toBe(true);
    const learn = openLearn(learnFile);
    importLearn(db, learn);
    importLearn(db, learn);
    learn.close();
    expect((db.prepare('SELECT username FROM users ORDER BY id').all() as { username: string }[]).map((u) => u.username)).toEqual(['estv', 'ami']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pieces').get()).toEqual({ n: 2 });
  });

  it('changes nothing when the copy fails', async () => {
    const broken = new Database(learnFile);
    broken.exec("INSERT INTO pieces (id, user_id, subject_id, title, source, data, note_count, duration, created_at) VALUES (20, 99, 'piano', 'Orphelin', 'midi', '[]', 0, 0, 1)");
    broken.close();
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'avant', 'h', 0)").run();
    const learn = openLearn(learnFile);
    expect(() => importLearn(db, learn)).toThrow('références cassées');
    learn.close();
    expect(db.prepare('SELECT username FROM users').all()).toEqual([{ username: 'avant' }]);
  });

  it('refuses a file that is not a learn-estv database', () => {
    const other = path.join(dir, 'other.db');
    new Database(other).close();
    expect(() => openLearn(other)).toThrow('n’est pas une base de learn-estv');
  });
});
