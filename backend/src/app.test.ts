import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiError } from './ai/index.js';
import { createApp } from './app.js';
import { hashPassword } from './auth/crypto.js';
import { openDatabase, type DB } from './db/index.js';

let db: DB;
let app: ReturnType<typeof createApp>;

async function addUser(username: string, password: string, isAdmin = false) {
  db.prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)')
    .run(username, await hashPassword(password), isAdmin ? 1 : 0, Date.now());
}

async function login(username: string, password: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password }).expect(200);
  return agent;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  // Covers: no network in tests; songs titled "Inconnu" have none.
  app = createApp(db, {
    coach: async ({ messages }) => `Réponse à : ${messages[messages.length - 1].text}`,
    readImages: async (images) => {
      if (images.length > 1) throw new AiError('Illisible');
      return { kind: 'nothing', reason: 'test' };
    },
    findLyrics: async (title) => [{ id: 1, title, artist: 'A', album: '', duration: 10, synced: '[00:01.00] la', plain: null }],
    findCover: async (title, artist) => (title === 'Inconnu' ? null : `https://img.test/${artist ?? '-'}/${title}`),
  });
});

describe('auth', () => {
  it('rejects guests', async () => {
    await request(app).get('/api/pieces').expect(401);
    const me = await request(app).get('/api/auth/me').expect(200);
    expect(me.body.data).toBeNull();
  });

  it('changes the password and keeps the session', async () => {
    await addUser('alice', 'generated-pw');
    const agent = await login('alice', 'generated-pw');
    await agent.get('/api/pieces').expect(200);
    await agent.post('/api/auth/password').send({ current: 'generated-pw', next: 'my-new-password' }).expect(200);
    await agent.get('/api/pieces').expect(200);
    await request(app).post('/api/auth/login').send({ username: 'alice', password: 'generated-pw' }).expect(401);
  });

  it('lets the admin create accounts', async () => {
    await addUser('admin', 'password123', true);
    const admin = await login('admin', 'password123');
    const created = await admin.post('/api/admin/users').send({ username: 'bob' }).expect(201);
    const bob = await login('bob', created.body.data.password);
    const me = await bob.get('/api/auth/me').expect(200);
    expect(me.body.data).toMatchObject({ username: 'bob', is_admin: false });
    await bob.get('/api/admin/users').expect(403);
  });

  it('edits the profile and stores a picture, for accounts only', async () => {
    await addUser('me', 'password123');
    const agent = await login('me', 'password123');
    await agent.patch('/api/auth/profile').send({ display_name: '  Estève  ' }).expect(200);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);
    await agent.put('/api/auth/avatar').set('Content-Type', 'image/webp').send(webp).expect(200);
    await agent.put('/api/auth/avatar').set('Content-Type', 'image/webp').send(Buffer.from('not an image')).expect(400);
    const me = (await agent.get('/api/auth/me').expect(200)).body.data;
    expect(me.display_name).toBe('Estève');
    expect(me.avatar_url).toMatch(/^\/api\/users\/\d+\/avatar\?v=\d+$/);
    const img = await agent.get(me.avatar_url).expect(200);
    expect(img.headers['content-type']).toBe('image/webp');

    await request(app).get(me.avatar_url).expect(401);
  });

  it('stores pieces privately per account', async () => {
    await addUser('me', 'password123');
    await addUser('other', 'password123');
    const me = await login('me', 'password123');
    const other = await login('other', 'password123');
    const piece = {
      title: 'Gamme', source: 'midi', bpm: 120,
      notes: [
        { midi: 62, time: 0.5, duration: 0.5, velocity: 0.8, hand: 'right' },
        { midi: 60, time: 0, duration: 0.5, velocity: 0.8, hand: null },
      ],
    };
    const created = await me.post('/api/pieces').send({ piece }).expect(201);
    const id = created.body.data.id;
    const list = (await me.get('/api/pieces').expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Gamme', note_count: 2, duration: 1 });
    const full = (await me.get(`/api/pieces/${id}`).expect(200)).body.data;
    expect(full.notes.map((n: { midi: number }) => n.midi)).toEqual([60, 62]);
    await other.get(`/api/pieces/${id}`).expect(404);
    expect((await other.get('/api/pieces').expect(200)).body.data).toHaveLength(0);
    await request(app).get('/api/pieces').expect(401);
    expect(list[0].artist).toBeNull();
    expect(list[0].description).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ description: '  boucle du refrain ' }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.description).toBe('boucle du refrain');
    await me.patch(`/api/pieces/${id}`).send({ description: 'x'.repeat(201) }).expect(400);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.level).toBe('original');
    await me.patch(`/api/pieces/${id}`).send({ level: 'melody' }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.level).toBe('melody');
    await me.patch(`/api/pieces/${id}`).send({ level: 'expert' }).expect(400);
    // Parts set by hand, and back to the automatic ones.
    const parts = [{ start: 0, label: 'A' }, { start: 4.5, label: 'B' }];
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sections).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ sections: parts }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sections).toEqual(parts);
    await me.patch(`/api/pieces/${id}`).send({ sections: [{ start: 1, label: 'A' }] }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ sections: [parts[0], { start: 0, label: 'B' }] }).expect(400);
    await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, sections: [parts[0]] }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sections).toEqual([parts[0]]);
    // Lyrics: found, saved, taken off.
    const lyrics = [{ time: 1.5, text: 'la la' }, { time: null, text: '' }];
    expect((await me.get('/api/pieces/lyrics?title=Chanson').expect(200)).body.data[0].title).toBe('Chanson');
    await me.get('/api/pieces/lyrics').expect(400);
    await me.patch(`/api/pieces/${id}`).send({ lyrics }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.lyrics).toEqual(lyrics);
    await me.patch(`/api/pieces/${id}`).send({ lyrics: [{ time: -1, text: 'x' }] }).expect(400);
    await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, lyrics: lyrics.slice(0, 1) }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.lyrics).toEqual(lyrics.slice(0, 1));
    await me.patch(`/api/pieces/${id}`).send({ lyrics: null }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.lyrics).toBeNull();
    // Takes: the best of each part, at each level, for the owner only.
    const take = { level: 'original', part: 'B', score: 80, chords: 12, wrong: 3, rate: 1 };
    await me.post(`/api/pieces/${id}/takes`).send(take).expect(201);
    const bests = (await me.post(`/api/pieces/${id}/takes`).send({ ...take, score: 92 }).expect(201)).body.data;
    expect(bests).toEqual([{ level: 'original', part: 'B', best: 92, count: 2 }]);
    await me.post(`/api/pieces/${id}/takes`).send({ ...take, score: 101 }).expect(400);
    await other.post(`/api/pieces/${id}/takes`).send(take).expect(404);
    await other.get(`/api/pieces/${id}/takes`).expect(404);
    expect((await me.get(`/api/pieces/${id}/takes`).expect(200)).body.data).toEqual(bests);
    // Time played: added up by day, with the days in a row.
    await me.post(`/api/pieces/${id}/time`).send({ seconds: 50 }).expect(200);
    await me.post(`/api/pieces/${id}/time`).send({ seconds: 25.4 }).expect(200);
    await me.post(`/api/pieces/${id}/time`).send({ seconds: 601 }).expect(400);
    await other.post(`/api/pieces/${id}/time`).send({ seconds: 30 }).expect(404);
    const practice = (await me.get('/api/pieces/practice').expect(200)).body.data;
    expect(practice).toMatchObject({ today: 75 });
    expect(practice).not.toHaveProperty('streak');
    expect(practice.days.at(-1).seconds).toBe(75);
    expect(practice.pieces[0]).toMatchObject({ id, seconds: 75, best: 92 });
    expect((await other.get('/api/pieces/practice').expect(200)).body.data).toMatchObject({ today: 0, pieces: [] });
    // The coach, for accounts only.
    expect((await me.post('/api/ai/coach').send({ context: 'x', messages: [{ role: 'user', text: 'Doigté ?' }] }).expect(200)).body.data.text).toBe('Réponse à : Doigté ?');
    await me.post('/api/ai/coach').send({ context: 'x', messages: [] }).expect(400);
    await request(app).post('/api/ai/coach').send({ context: 'x', messages: [{ role: 'user', text: 'a' }] }).expect(401);
    // How the player numbers keys.
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data).toMatchObject({ numbering: 'order', whole: false });
    await me.patch(`/api/pieces/${id}`).send({ numbering: 'fixed', whole: true }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data).toMatchObject({ numbering: 'fixed', whole: true });
    await me.patch(`/api/pieces/${id}`).send({ numbering: 'random' }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ numbering: 'order', whole: false }).expect(200);
    // The tempo only changes when it is sent.
    const bpm = (await me.get(`/api/pieces/${id}`).expect(200)).body.data.bpm;
    await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, bpm: 87.5 }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.bpm).toBe(87.5);
    await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, bpm: 0 }).expect(400);
    if (bpm) await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, bpm }).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ sections: null }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sections).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ description: '' }).expect(200);
    expect((await me.get('/api/pieces').expect(200)).body.data[0].description).toBeNull();
    const withDesc = (await me.post('/api/pieces').send({ piece, description: 'en entier' }).expect(201)).body.data.id;
    expect((await me.get(`/api/pieces/${withDesc}`).expect(200)).body.data.description).toBe('en entier');
    await me.delete(`/api/pieces/${withDesc}`).expect(200);
    expect(list[0].cover).toBe('https://img.test/-/Gamme');

    // Silence at the start is not imported.
    const late = { ...piece, title: 'Tard', notes: piece.notes.map((n) => ({ ...n, time: n.time + 3 })) };
    const lateId = (await me.post('/api/pieces').send({ piece: late }).expect(201)).body.data.id;
    expect((await me.get(`/api/pieces/${lateId}`).expect(200)).body.data.notes.map((n: { time: number }) => n.time)).toEqual([0, 0.5]);
    await me.delete(`/api/pieces/${lateId}`).expect(200);

    // Copied from elsewhere: as its owner had set it.
    const copied = {
      piece: { ...piece, title: 'Copie' }, level: 'simplified', lyrics: [{ time: 0.25, text: 'la' }, { time: null, text: 'pas placée' }], sections: [{ start: 0, label: 'A' }], cover: 'https://cdn-images.dzcdn.net/images/cover/x.jpg',
      edits: { simplified: { removed: [], added: [{ ...piece.notes[0], time: 0.25 }] } }, numbers: [{ label: 'A', hand: 'right', midi: 62, number: 3 }], difficulty: 'hard', description: 'boucle',
    };
    const copyId = (await me.post('/api/pieces').send(copied).expect(201)).body.data.id;
    const { level, sections, cover, lyrics: copiedLyrics, edits: copiedEdits, numbers: copiedNumbers, difficulty, description } = (await me.get(`/api/pieces/${copyId}`).expect(200)).body.data;
    expect({ level, sections, cover, lyrics: copiedLyrics, edits: copiedEdits, numbers: copiedNumbers, difficulty, description }).toEqual({
      level: copied.level, sections: copied.sections, cover: copied.cover, lyrics: copied.lyrics, edits: copied.edits, numbers: copied.numbers, difficulty: 'hard', description: 'boucle',
    });
    await me.post('/api/pieces').send({ ...copied, cover: 'https://evil.test/x.jpg' }).expect(400);
    await me.delete(`/api/pieces/${copyId}`).expect(200);

    // Numbers of one's own.
    const numbers = [{ label: 'A', hand: 'right', midi: 62, number: 0 }];
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.numbers).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ numbers }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.numbers).toEqual(numbers);
    await me.patch(`/api/pieces/${id}`).send({ numbers: [{ ...numbers[0], number: 100 }] }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ numbers: null }).expect(200);

    // Changes to an easier level: the piece's notes stay.
    const edits = { simplified: { removed: [{ midi: 60, time: 0 }], added: [{ midi: 64, time: 1, duration: 0.5, velocity: 0.7, hand: 'left' }] } };
    await me.patch(`/api/pieces/${id}`).send({ edits }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data).toMatchObject({ edits, notes: [{ midi: 60 }, { midi: 62 }] });
    await me.patch(`/api/pieces/${id}`).send({ edits: { original: edits.simplified, simplified: { removed: 3 } } }).expect(400);
    await me.put(`/api/pieces/${id}/notes`).send({ notes: piece.notes, edits: null }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.edits).toBeNull();

    // Written by hand: the notes come from the score.
    const score = {
      bpm: 120, division: 2,
      parts: [{ label: 'A', beats: 4, keys: [{ hand: 'right', number: 4, midi: 70 }], notes: [{ step: 0, midi: 70, hand: 'right' }, { step: 3, midi: 70, hand: 'right' }] }],
      order: ['A', 'A'],
    };
    const own = { piece: { ...piece, title: 'À moi', source: 'manual' }, score };
    const ownId = (await me.post('/api/pieces').send(own).expect(201)).body.data.id;
    const ownFull = (await me.get(`/api/pieces/${ownId}`).expect(200)).body.data;
    expect(ownFull).toMatchObject({ source: 'manual', bpm: 120, score });
    expect(ownFull.notes.map((n: { time: number }) => n.time)).toEqual([0, 0.75, 2, 2.75]);
    await me.put(`/api/pieces/${ownId}/score`).send({ score: { ...score, bpm: 60, order: ['A'] } }).expect(200);
    expect((await me.get(`/api/pieces/${ownId}`).expect(200)).body.data.notes.map((n: { time: number }) => n.time)).toEqual([0, 1.5]);
    expect((await me.put(`/api/pieces/${ownId}/score`).send({ score: { ...score, order: ['B'] } }).expect(400)).body.error).toBe('Partie inconnue');
    await me.put(`/api/pieces/${ownId}/notes`).send({ notes: piece.notes }).expect(400);
    await me.put(`/api/pieces/${id}/score`).send({ score }).expect(400);
    await other.put(`/api/pieces/${ownId}/score`).send({ score }).expect(404);
    expect(ownFull.sections).toBeNull();
    await me.delete(`/api/pieces/${ownId}`).expect(200);

    // Several instruments: every track kept, switched on and off.
    const band = {
      ...piece, title: 'Groupe',
      tracks: [{ name: 'Piano', instrument: 'acoustic grand piano', enabled: true }, { name: 'Basse', instrument: 'electric bass (finger)', enabled: false }],
      notes: [{ ...piece.notes[0], track: 0 }, { ...piece.notes[1], track: 1 }],
    };
    await me.post('/api/pieces').send({ piece: { ...band, notes: [{ ...piece.notes[0], track: 5 }] } }).expect(400);
    const bandId = (await me.post('/api/pieces').send({ piece: band }).expect(201)).body.data.id;
    await me.patch(`/api/pieces/${bandId}`).send({ tracks_enabled: [true] }).expect(400);
    await me.patch(`/api/pieces/${bandId}`).send({ tracks_enabled: [false, true] }).expect(200);
    const bandFull = (await me.get(`/api/pieces/${bandId}`).expect(200)).body.data;
    expect(bandFull.tracks.map((t: { enabled: boolean }) => t.enabled)).toEqual([false, true]);
    expect(bandFull.notes.map((n: { track: number }) => n.track)).toEqual([1, 0]);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.tracks).toBeUndefined();

    // Corrected notes replace the piece's.
    const fixed = [{ midi: 61, time: 0, duration: 0.5, velocity: 0.8, hand: 'right', track: 1 }];
    await me.put(`/api/pieces/${bandId}/notes`).send({ notes: [{ ...fixed[0], track: 7 }] }).expect(400);
    await me.put(`/api/pieces/${bandId}/notes`).send({ notes: [] }).expect(400);
    await other.put(`/api/pieces/${bandId}/notes`).send({ notes: fixed }).expect(404);
    await me.put(`/api/pieces/${bandId}/notes`).send({ notes: fixed }).expect(200);
    const corrected = (await me.get(`/api/pieces/${bandId}`).expect(200)).body.data;
    expect(corrected.notes).toEqual(fixed);
    expect((await me.get('/api/pieces').expect(200)).body.data.find((p: { id: number }) => p.id === bandId)).toMatchObject({ note_count: 1, duration: 0.5 });
    await me.delete(`/api/pieces/${bandId}`).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ title: 'Do majeur' }).expect(200);
    const renamed = await me.patch(`/api/pieces/${id}`).send({ artist: '  Bach ' }).expect(200);
    expect(renamed.body.data.cover).toBe('https://img.test/Bach/Do majeur');
    expect((await me.patch(`/api/pieces/${id}`).send({ title: 'Inconnu' }).expect(200)).body.data.cover).toBeNull();
    expect((await me.get('/api/pieces').expect(200)).body.data[0].cover).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ title: 'Do majeur' }).expect(200);
    let meta = (await me.get('/api/pieces').expect(200)).body.data[0];
    expect(meta).toMatchObject({ title: 'Do majeur', artist: 'Bach' });
    await me.patch(`/api/pieces/${id}`).send({ artist: '' }).expect(200);
    meta = (await me.get('/api/pieces').expect(200)).body.data[0];
    expect(meta).toMatchObject({ title: 'Do majeur', artist: null });
    await me.patch(`/api/pieces/${id}`).send({}).expect(400);
    expect((await me.get('/api/pieces/cover?title=Hymne&artist=Moi').expect(200)).body.data.cover).toBe('https://img.test/Moi/Hymne');
    expect((await me.get('/api/pieces/cover?title=Inconnu').expect(200)).body.data.cover).toBeNull();
    await me.get('/api/pieces/cover').expect(400);
    expect((await me.get('/api/pieces/cover?link=https://example.com/x').expect(200)).body.data.cover).toBeNull();
    // A cover picked by hand: only catalogue images, kept over a new search.
    await me.patch(`/api/pieces/${id}`).send({ cover: 'https://evil.test/x.jpg' }).expect(400);
    const picked = 'https://cdn-images.dzcdn.net/images/cover/abc/250x250.jpg';
    expect((await me.patch(`/api/pieces/${id}`).send({ title: 'Autre', cover: picked }).expect(200)).body.data.cover).toBe(picked);
    expect((await me.get('/api/pieces').expect(200)).body.data[0].cover).toBe(picked);
    await me.patch(`/api/pieces/${id}`).send({ cover: null }).expect(200);
    expect((await me.get('/api/pieces').expect(200)).body.data[0].cover).toBeNull();
    // The order of the keys, rewritten by hand; empty: worked out again.
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sequence).toBeNull();
    await me.patch(`/api/pieces/${id}`).send({ sequence: { right: '5-7-5-4\n\n3-5' } }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sequence).toEqual({ right: '5-7-5-4\n\n3-5' });
    await me.patch(`/api/pieces/${id}`).send({ sequence: { right: 'x'.repeat(20_001) } }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ sequence: { left: '' } }).expect(200);
    expect((await me.get(`/api/pieces/${id}`).expect(200)).body.data.sequence).toBeNull();
    // A cover from a file: kept, served by its own address, copied with the piece.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const sent = `data:image/png;base64,${png.toString('base64')}`;
    await me.patch(`/api/pieces/${id}`).send({ cover: 'data:text/html;base64,PGI+' }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ cover: `data:image/png;base64,${'A'.repeat(700_000)}` }).expect(400);
    const path = `/api/pieces/${id}/image?v=${sent.length}`;
    expect((await me.patch(`/api/pieces/${id}`).send({ cover: sent }).expect(200)).body.data.cover).toBe(path);
    expect((await me.get('/api/pieces').expect(200)).body.data[0].cover).toBe(path);
    const image = await me.get(`/api/pieces/${id}/image`).expect(200).expect('Content-Type', 'image/png');
    expect(Buffer.compare(image.body as Buffer, png)).toBe(0);
    await other.get(`/api/pieces/${id}/image`).expect(404);
    const withCover = (await me.get(`/api/pieces/${id}`).expect(200)).body.data;
    const twin = (await me.post('/api/pieces').send({ piece: { title: 'Jumeau', artist: null, source: 'midi', bpm: null, notes: withCover.notes }, cover: withCover.cover }).expect(201)).body.data.id;
    expect((await me.get(`/api/pieces/${twin}`).expect(200)).body.data.cover).toBe(`/api/pieces/${twin}/image?v=${sent.length}`);
    await me.get(`/api/pieces/${twin}/image`).expect(200);
    // Another's cannot be taken.
    const stolen = (await other.post('/api/pieces').send({ piece: { title: 'Volé', artist: null, source: 'midi', bpm: null, notes: withCover.notes }, cover: withCover.cover }).expect(201)).body.data.id;
    await other.get(`/api/pieces/${stolen}/image`).expect(404);
    await me.delete(`/api/pieces/${twin}`).expect(200);
    await other.delete(`/api/pieces/${stolen}`).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ cover: null }).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ title: 'Do majeur' }).expect(200);
    await request(app).get('/api/pieces/cover?title=x').expect(401);
    await other.patch(`/api/pieces/${id}`).send({ artist: 'x' }).expect(404);

    // Folders, in order of priority, and difficulty tags.
    const first = (await me.post('/api/pieces/folders').send({ name: 'Priorité' }).expect(201)).body.data.id;
    const second = (await me.post('/api/pieces/folders').send({ name: 'Plus tard' }).expect(201)).body.data.id;
    await me.put('/api/pieces/folders/order').send({ ids: [second, first] }).expect(200);
    const folders = (await me.get('/api/pieces/folders').expect(200)).body.data;
    expect(folders.map((f: { name: string }) => f.name)).toEqual(['Plus tard', 'Priorité']);
    expect((await other.get('/api/pieces/folders').expect(200)).body.data).toHaveLength(0);
    const otherFolder = (await other.post('/api/pieces/folders').send({ name: 'À moi' }).expect(201)).body.data.id;
    await me.patch(`/api/pieces/${id}`).send({ folder_id: otherFolder }).expect(400);
    await me.patch(`/api/pieces/${id}`).send({ folder_id: first, difficulty: 'hard' }).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ difficulty: 'trivial' }).expect(400);
    meta = (await me.get('/api/pieces').expect(200)).body.data[0];
    expect(meta).toMatchObject({ folder_id: first, difficulty: 'hard', title: 'Do majeur' });

    // Subfolders: no folder inside itself; deleting moves the content up.
    const sub = (await me.post('/api/pieces/folders').send({ name: 'Chopin', parent_id: first }).expect(201)).body.data.id;
    const subsub = (await me.post('/api/pieces/folders').send({ name: 'Nocturnes', parent_id: sub }).expect(201)).body.data.id;
    await me.post('/api/pieces/folders').send({ name: 'x', parent_id: otherFolder }).expect(400);
    await me.patch(`/api/pieces/folders/${first}`).send({ parent_id: subsub }).expect(400);
    await me.patch(`/api/pieces/folders/${first}`).send({ parent_id: first }).expect(400);
    await me.patch(`/api/pieces/folders/${subsub}`).send({ parent_id: second }).expect(200);
    await me.patch(`/api/pieces/folders/${subsub}`).send({ parent_id: sub }).expect(200);
    await me.patch(`/api/pieces/${id}`).send({ folder_id: sub }).expect(200);
    await me.delete(`/api/pieces/folders/${sub}`).expect(200);
    const tree = (await me.get('/api/pieces/folders').expect(200)).body.data as { id: number; parent_id: number | null }[];
    expect(tree.find((f) => f.id === subsub)?.parent_id).toBe(first);
    expect((await me.get('/api/pieces').expect(200)).body.data[0].folder_id).toBe(first);

    await me.delete(`/api/pieces/folders/${first}`).expect(200);
    meta = (await me.get('/api/pieces').expect(200)).body.data[0];
    expect(meta).toMatchObject({ folder_id: null, difficulty: 'hard' });
    const top = (await me.get('/api/pieces/folders').expect(200)).body.data as { id: number; parent_id: number | null }[];
    expect(top.find((f) => f.id === subsub)?.parent_id).toBeNull();
    await me.delete(`/api/pieces/${id}`).expect(200);
    expect((await me.get('/api/pieces').expect(200)).body.data).toHaveLength(0);
  });

  it('reads images for accounts only, and says why it could not', async () => {
    await addUser('me', 'password123');
    const image = 'data:image/jpeg;base64,AAAA';
    await request(app).post('/api/ai/read').send({ images: [image] }).expect(401);
    const me = await login('me', 'password123');
    expect((await me.post('/api/ai/read').send({ images: [image] }).expect(200)).body.data.kind).toBe('nothing');
    expect((await me.post('/api/ai/read').send({ images: [image, image] }).expect(422)).body.error).toBe('Illisible');
    await me.post('/api/ai/read').send({ images: ['https://example.com/a.jpg'] }).expect(400);
    await me.post('/api/ai/read').send({ images: [] }).expect(400);
  });
});
