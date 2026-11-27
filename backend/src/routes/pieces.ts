import express, { Router } from 'express';
import { pieceDifficulties, pieceDuration, pieceEditsSchema, pieceLevels, pieceLyricsSchema, pieceNumberings, pieceNoteSchema, pieceNumbersSchema, pieceSchema, pieceSectionsSchema, renderScore, scoreSchema, trimSilence, type Score } from '@piano/shared';
import { z } from 'zod';
import { requireUser } from '../auth/session.js';
import { coverFromLink, coverPath, coverPathId, isCatalogImage, isUploadedCover, MAX_UPLOADED_COVER, type CoverFinder } from '../covers.js';
import type { DB } from '../db/index.js';
import { LyricsError, type LyricsFinder } from '../lyrics.js';
import { addTime, practiceOf } from '../practice.js';

// Imported pieces are private to their owner: often copyrighted songs, never
// shown to other accounts or guests. The owner sorts them into folders (in
// their order of priority) and tags how hard each one is.

const folderId = z.number().int().positive().nullable();
const difficulty = z.enum(pieceDifficulties).nullable();
const description = z.string().trim().max(200).nullable();
// From Deezer or Apple Music, sent from a file, or that of another piece of the
// owner's (when copied).
const cover = z.union([
  z.string().url().max(500).refine(isCatalogImage),
  z.string().max(MAX_UPLOADED_COVER).refine(isUploadedCover),
  z.string().max(40).refine((s) => Number.isInteger(coverPathId(s))),
]).nullable();
// What is shown of a stored cover.
const COVER_SQL = `CASE WHEN cover LIKE 'data:%' THEN '/api/pieces/' || id || '/image?v=' || length(cover) ELSE NULLIF(cover, '') END AS cover`;

// The order of the keys, each hand's as its owner wrote it.
const sequence = z.object({ left: z.string().max(20_000).optional(), right: z.string().max(20_000).optional() });

const createBody = z.object({
  piece: pieceSchema,
  // Written by hand: the notes come from it.
  score: scoreSchema.optional(),
  folder_id: folderId.optional(),
  difficulty: difficulty.optional(),
  description: description.optional(),
  // Of a piece copied from elsewhere, as its owner had set it.
  cover: cover.optional(),
  level: z.enum(pieceLevels).optional(),
  sections: pieceSectionsSchema.nullable().optional(),
  edits: pieceEditsSchema.nullable().optional(),
  numbers: pieceNumbersSchema.nullable().optional(),
  lyrics: pieceLyricsSchema.nullable().optional(),
  numbering: z.enum(pieceNumberings).optional(),
  whole: z.boolean().optional(),
  sequence: sequence.nullable().optional(),
});
const updateBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  artist: z.string().trim().max(120).nullable().optional(),
  description: description.optional(),
  folder_id: folderId.optional(),
  difficulty: difficulty.optional(),
  level: z.enum(pieceLevels).optional(),
  // Parts set by hand; null: found automatically.
  sections: pieceSectionsSchema.nullable().optional(),
  // Numbers given to keys by hand; null: as they come.
  numbers: pieceNumbersSchema.nullable().optional(),
  // Changes made by hand to the easier levels; null: none.
  edits: pieceEditsSchema.nullable().optional(),
  // Null: none.
  lyrics: pieceLyricsSchema.nullable().optional(),
  numbering: z.enum(pieceNumberings).optional(),
  whole: z.boolean().optional(),
  // Null: worked out from the notes.
  sequence: sequence.nullable().optional(),
  // Which tracks are on, one flag per track of the piece.
  tracks_enabled: z.array(z.boolean()).max(64).optional(),
  // Cover picked by hand (from a link): a catalogue image, or null for none.
  cover: cover.optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined));

const folderName = z.string().trim().min(1).max(60);
const folderCreate = z.object({ name: folderName, parent_id: folderId.optional() });
const folderUpdate = z.object({ name: folderName.optional(), parent_id: folderId.optional() })
  .refine((b) => b.name !== undefined || b.parent_id !== undefined);
const folderOrder = z.object({ ids: z.array(z.number().int().positive()).max(500) });

const firstIssue = (e: z.ZodError, otherwise: string) => e.issues.find((i) => i.code === 'custom')?.message ?? otherwise;
const notesOf = (score: Score) => renderScore(score).notes;

// Empty artist: none.
const artistOrNull = (a: string | null | undefined) => a?.trim() || null;
const textOrNull = artistOrNull;

// Pieces imported before covers existed get one when the list is next opened,
// a few at a time, in the background.
const BACKFILL = 5;

export function pieceRoutes(db: DB, findCover: CoverFinder, findLyrics: LyricsFinder) {
  const router = Router();
  // A cover as it is kept: that of another piece is copied, if the owner's.
  const storedCover = (sent: string | null, userId: number): string | null => {
    if (!sent) return null;
    const other = coverPathId(sent);
    if (!Number.isInteger(other)) return sent;
    const row = db.prepare('SELECT cover FROM pieces WHERE id = ? AND user_id = ?').get(other, userId) as { cover: string | null } | undefined;
    return row?.cover || null;
  };

  router.use(requireUser);

  const searching = new Set<number>();
  const backfill = (userId: number) => {
    const rows = db.prepare('SELECT id, title, artist FROM pieces WHERE user_id = ? AND cover IS NULL LIMIT ?')
      .all(userId, BACKFILL) as { id: number; title: string; artist: string | null }[];
    for (const r of rows) {
      if (searching.has(r.id)) continue;
      searching.add(r.id);
      void findCover(r.title, r.artist)
        .then((url) => db.prepare('UPDATE pieces SET cover = ? WHERE id = ? AND cover IS NULL').run(url ?? '', r.id))
        .finally(() => searching.delete(r.id));
    }
  };

  const ownsFolder = (id: number | null | undefined, userId: number) =>
    id == null || !!db.prepare('SELECT 1 FROM piece_folders WHERE id = ? AND user_id = ?').get(id, userId);

  // --- Folders (before /:id, which would catch "folders") ---------------------
  // A tree: each folder has a parent (or none) and a position among the
  // folders of that parent, its order of priority.

  type FolderRow = { id: number; parent_id: number | null };
  const folder = (id: number, userId: number) =>
    db.prepare('SELECT id, parent_id FROM piece_folders WHERE id = ? AND user_id = ?').get(id, userId) as FolderRow | undefined;
  const nextPosition = (userId: number, parent: number | null) =>
    ((db.prepare('SELECT MAX(position) AS last FROM piece_folders WHERE user_id = ? AND parent_id IS ?')
      .get(userId, parent) as { last: number | null }).last ?? -1) + 1;
  // Moving `id` under `parent` must not put a folder inside itself.
  const createsCycle = (id: number, parent: number | null, userId: number) => {
    for (let at = parent; at !== null; at = folder(at, userId)?.parent_id ?? null) if (at === id) return true;
    return false;
  };

  router.get('/folders', (req, res) => {
    const rows = db.prepare('SELECT id, name, parent_id, position FROM piece_folders WHERE user_id = ? ORDER BY position, id').all(req.user!.id);
    res.json({ success: true, data: rows });
  });

  router.post('/folders', (req, res) => {
    const parsed = folderCreate.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Nom de dossier invalide' });
    const { name } = parsed.data;
    const parent = parsed.data.parent_id ?? null;
    if (parent !== null && !folder(parent, req.user!.id)) return void res.status(400).json({ success: false, error: 'Dossier parent introuvable' });
    const r = db.prepare('INSERT INTO piece_folders (user_id, name, parent_id, position, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user!.id, name, parent, nextPosition(req.user!.id, parent), Date.now());
    res.status(201).json({ success: true, data: { id: Number(r.lastInsertRowid) } });
  });

  // New order of priority among sibling folders: their ids, most important first.
  router.put('/folders/order', (req, res) => {
    const parsed = folderOrder.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Ordre invalide' });
    const set = db.prepare('UPDATE piece_folders SET position = ? WHERE id = ? AND user_id = ?');
    db.transaction(() => parsed.data.ids.forEach((id, i) => set.run(i, id, req.user!.id)))();
    res.json({ success: true });
  });

  // Rename, or move into another folder (parent_id null: top level).
  router.patch('/folders/:id', (req, res) => {
    const parsed = folderUpdate.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Dossier invalide' });
    const id = Number(req.params.id);
    const current = folder(id, req.user!.id);
    if (!current) return void res.status(404).json({ success: false, error: 'Dossier introuvable' });
    const { name, parent_id } = parsed.data;
    if (parent_id !== undefined && parent_id !== current.parent_id) {
      if (parent_id !== null && !folder(parent_id, req.user!.id)) return void res.status(400).json({ success: false, error: 'Dossier parent introuvable' });
      if (createsCycle(id, parent_id, req.user!.id)) return void res.status(400).json({ success: false, error: 'Un dossier ne peut pas aller dans un de ses sous-dossiers' });
      db.prepare('UPDATE piece_folders SET parent_id = ?, position = ? WHERE id = ?').run(parent_id, nextPosition(req.user!.id, parent_id), id);
    }
    if (name !== undefined) db.prepare('UPDATE piece_folders SET name = ? WHERE id = ?').run(name, id);
    res.json({ success: true });
  });

  // Nothing is lost: the folder's pieces and subfolders move up to its parent.
  router.delete('/folders/:id', (req, res) => {
    const id = Number(req.params.id);
    const current = folder(id, req.user!.id);
    if (!current) return void res.json({ success: true });
    db.transaction(() => {
      db.prepare('UPDATE pieces SET folder_id = ? WHERE folder_id = ? AND user_id = ?').run(current.parent_id, id, req.user!.id);
      const children = db.prepare('SELECT id FROM piece_folders WHERE parent_id = ? ORDER BY position, id').all(id) as { id: number }[];
      let at = nextPosition(req.user!.id, current.parent_id);
      for (const c of children) db.prepare('UPDATE piece_folders SET parent_id = ?, position = ? WHERE id = ?').run(current.parent_id, at++, c.id);
      db.prepare('DELETE FROM piece_folders WHERE id = ?').run(id);
    })();
    res.json({ success: true });
  });

  // --- Pieces ------------------------------------------------------------------

  // Cover preview while editing, nothing saved: searched from a title and
  // artist, or read from a Deezer / Apple Music link.
  router.get('/cover', async (req, res) => {
    const parsed = z.union([
      z.object({ link: z.string().trim().min(1).max(500) }),
      z.object({ title: z.string().trim().min(1).max(120), artist: z.string().trim().max(120).optional() }),
    ]).safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Titre ou lien invalide' });
    const q = parsed.data;
    const url = 'link' in q ? await coverFromLink(q.link) : await findCover(q.title, artistOrNull(q.artist));
    res.json({ success: true, data: { cover: url } });
  });

  // Lyrics of a song, from a public catalogue; nothing saved.
  router.get('/lyrics', async (req, res) => {
    const parsed = z.object({ title: z.string().trim().min(1).max(120), artist: z.string().trim().max(120).optional() }).safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Titre invalide' });
    try {
      res.json({ success: true, data: await findLyrics(parsed.data.title, artistOrNull(parsed.data.artist)) });
    } catch (e) {
      if (e instanceof LyricsError) return void res.status(502).json({ success: false, error: e.message });
      throw e;
    }
  });

  // Time spent playing, and days in a row.
  router.get('/practice', (req, res) => {
    res.json({ success: true, data: practiceOf(db, req.user!.id) });
  });

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT id, title, artist, description, ${COVER_SQL}, folder_id, difficulty, source, bpm, note_count, duration, created_at
      FROM pieces WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user!.id);
    res.json({ success: true, data: rows });
    backfill(req.user!.id);
  });

  // A cover sent from a file.
  router.get('/:id/image', (req, res) => {
    const row = db.prepare('SELECT cover FROM pieces WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as { cover: string | null } | undefined;
    const found = row?.cover && /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(row.cover);
    if (!found) return void res.status(404).end();
    res.set('Cache-Control', 'private, no-cache').type(found[1]).send(Buffer.from(found[2], 'base64'));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare(`SELECT id, title, artist, description, ${COVER_SQL}, folder_id, difficulty, source, bpm, tracks, sections, score, edits, numbers, lyrics, sequence, COALESCE(numbering, 'order') AS numbering, whole, COALESCE(level, 'original') AS level, data FROM pieces WHERE id = ? AND user_id = ?`)
      .get(Number(req.params.id), req.user!.id) as { data: string } & Record<string, unknown> | undefined;
    if (!row) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    const { data, tracks, sections, score, edits, numbers, lyrics, sequence: written, whole, ...meta } = row;
    res.json({ success: true, data: { ...meta, whole: !!whole, tracks: tracks ? JSON.parse(tracks as string) : undefined, sections: sections ? JSON.parse(sections as string) : null, score: score ? JSON.parse(score as string) : null, edits: edits ? JSON.parse(edits as string) : null, numbers: numbers ? JSON.parse(numbers as string) : null, lyrics: lyrics ? JSON.parse(lyrics as string) : null, sequence: written ? JSON.parse(written as string) : null, notes: JSON.parse(data) } });
  });

  // Large pieces exceed the global JSON limit.
  router.post('/', express.json({ limit: '8mb' }), async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: firstIssue(parsed.error, 'Morceau invalide') });
    const { piece, score } = parsed.data;
    if (!ownsFolder(parsed.data.folder_id, req.user!.id)) return void res.status(400).json({ success: false, error: 'Dossier introuvable' });
    const b = parsed.data;
    const { notes: own, sections, edits, lyrics } = score
      ? { notes: notesOf(score), sections: null, edits: null, lyrics: b.lyrics }
      : trimSilence({ notes: piece.notes, sections: b.sections, edits: b.edits, lyrics: b.lyrics });
    const notes = [...own].sort((a, z) => a.time - z.time || a.midi - z.midi);
    const now = Date.now();
    const artist = artistOrNull(piece.artist);
    const found = (b.cover !== undefined ? storedCover(b.cover, req.user!.id) : null) ?? (await findCover(piece.title, artist)) ?? '';
    const json = (value: unknown) => (value ? JSON.stringify(value) : null);
    const r = db.prepare(`
      INSERT INTO pieces (
        user_id, title, artist, description, cover, folder_id, difficulty, source, bpm, tracks, score, level, sections, edits, numbers, lyrics, numbering, whole, sequence,
        data, note_count, duration, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user!.id, piece.title, artist, textOrNull(b.description), found, b.folder_id ?? null, b.difficulty ?? null,
      score ? 'manual' : piece.source, score ? score.bpm : piece.bpm, !score && piece.tracks?.length ? json(piece.tracks) : null, json(score), b.level ?? null,
      json(sections), json(edits), json(b.numbers), json(lyrics), b.numbering ?? null, b.whole ? 1 : null, b.sequence && (b.sequence.left || b.sequence.right) ? JSON.stringify(b.sequence) : null, JSON.stringify(notes), notes.length, pieceDuration(notes), now,
    );
    res.status(201).json({ success: true, data: { id: Number(r.lastInsertRowid) } });
  });

  // Only the fields sent change; null clears artist, folder and difficulty.
  // A new title or artist means a new cover search; the answer carries it.
  router.patch('/:id', async (req, res) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Modification invalide' });
    const b = parsed.data;
    if (!ownsFolder(b.folder_id, req.user!.id)) return void res.status(400).json({ success: false, error: 'Dossier introuvable' });
    const old = db.prepare('SELECT title, artist, cover, tracks FROM pieces WHERE id = ? AND user_id = ?')
      .get(Number(req.params.id), req.user!.id) as { title: string; artist: string | null; cover: string | null; tracks: string | null } | undefined;
    if (!old) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    const sets: string[] = [];
    const values: unknown[] = [];
    if (b.title !== undefined) { sets.push('title = ?'); values.push(b.title); }
    if (b.artist !== undefined) { sets.push('artist = ?'); values.push(artistOrNull(b.artist)); }
    if (b.folder_id !== undefined) { sets.push('folder_id = ?'); values.push(b.folder_id); }
    if (b.difficulty !== undefined) { sets.push('difficulty = ?'); values.push(b.difficulty); }
    if (b.level !== undefined) { sets.push('level = ?'); values.push(b.level); }
    if (b.sections !== undefined) { sets.push('sections = ?'); values.push(b.sections && JSON.stringify(b.sections)); }
    if (b.numbers !== undefined) { sets.push('numbers = ?'); values.push(b.numbers && JSON.stringify(b.numbers)); }
    if (b.numbering !== undefined) { sets.push('numbering = ?'); values.push(b.numbering); }
    if (b.whole !== undefined) { sets.push('whole = ?'); values.push(b.whole ? 1 : 0); }
    if (b.sequence !== undefined) { sets.push('sequence = ?'); values.push(b.sequence && (b.sequence.left || b.sequence.right) ? JSON.stringify(b.sequence) : null); }
    if (b.lyrics !== undefined) { sets.push('lyrics = ?'); values.push(b.lyrics?.length ? JSON.stringify(b.lyrics) : null); }
    if (b.edits !== undefined) { sets.push('edits = ?'); values.push(b.edits && JSON.stringify(b.edits)); }
    if (b.description !== undefined) { sets.push('description = ?'); values.push(textOrNull(b.description)); }
    if (b.tracks_enabled !== undefined) {
      const tracks = old.tracks ? (JSON.parse(old.tracks) as { enabled: boolean }[]) : [];
      if (b.tracks_enabled.length !== tracks.length) return void res.status(400).json({ success: false, error: 'Pistes invalides' });
      sets.push('tracks = ?');
      values.push(JSON.stringify(tracks.map((t, i) => ({ ...t, enabled: b.tracks_enabled![i] }))));
    }
    const title = b.title ?? old.title;
    const artist = b.artist !== undefined ? artistOrNull(b.artist) : old.artist;
    let cover = old.cover;
    if (b.cover !== undefined) {
      cover = storedCover(b.cover, req.user!.id) ?? '';
      sets.push('cover = ?');
      values.push(cover);
    } else if (title !== old.title || artist !== old.artist) {
      cover = (await findCover(title, artist)) ?? '';
      sets.push('cover = ?');
      values.push(cover);
    }
    db.prepare(`UPDATE pieces SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values, Number(req.params.id), req.user!.id);
    res.json({ success: true, data: { cover: cover?.startsWith('data:') ? coverPath(Number(req.params.id), cover) : cover || null } });
  });

  // Notes corrected in the editor: they replace the piece's. Cutting
  // the start moves the parts and the changes to the easier levels too.
  router.put('/:id/notes', express.json({ limit: '8mb' }), (req, res) => {
    const parsed = z.object({ bpm: z.number().positive().max(1000).optional(), notes: z.array(pieceNoteSchema).min(1).max(50_000), sections: pieceSectionsSchema.nullable().optional(), edits: pieceEditsSchema.nullable().optional(), lyrics: pieceLyricsSchema.nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Notes invalides' });
    const row = db.prepare('SELECT tracks, score FROM pieces WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as { tracks: string | null; score: string | null } | undefined;
    if (!row) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    if (row.score) return void res.status(400).json({ success: false, error: 'Ce morceau se modifie par ses chiffres' });
    const trackCount = row.tracks ? (JSON.parse(row.tracks) as unknown[]).length : 0;
    if (parsed.data.notes.some((n) => n.track !== undefined && n.track >= trackCount)) return void res.status(400).json({ success: false, error: 'Piste inconnue' });
    const notes = [...parsed.data.notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
    const sets = ['data = ?', 'note_count = ?', 'duration = ?'];
    const values: unknown[] = [JSON.stringify(notes), notes.length, pieceDuration(notes)];
    if (parsed.data.bpm !== undefined) {
      sets.push('bpm = ?');
      values.push(parsed.data.bpm);
    }
    for (const key of ['sections', 'edits', 'lyrics'] as const) {
      const value = parsed.data[key];
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      values.push(value && JSON.stringify(value));
    }
    db.prepare(`UPDATE pieces SET ${sets.join(', ')} WHERE id = ?`).run(...values, Number(req.params.id));
    res.json({ success: true });
  });

  // A piece written by hand, rewritten: its notes, tempo and parts follow.
  router.put('/:id/score', express.json({ limit: '8mb' }), (req, res) => {
    const parsed = z.object({ score: scoreSchema }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: firstIssue(parsed.error, 'Morceau invalide') });
    const row = db.prepare('SELECT score FROM pieces WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as { score: string | null } | undefined;
    if (!row) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    if (!row.score) return void res.status(400).json({ success: false, error: 'Ce morceau est importé' });
    const { score } = parsed.data;
    const notes = notesOf(score);
    db.prepare('UPDATE pieces SET score = ?, bpm = ?, data = ?, note_count = ?, duration = ?, sections = NULL WHERE id = ?')
      .run(JSON.stringify(score), score.bpm, JSON.stringify(notes), notes.length, pieceDuration(notes), Number(req.params.id));
    res.json({ success: true });
  });

  // --- Takes ---------------------------------------------------------------------

  const takeBody = z.object({
    level: z.enum(pieceLevels),
    part: z.string().trim().max(60),
    score: z.number().int().min(0).max(100),
    chords: z.number().int().min(1).max(100_000),
    wrong: z.number().int().min(0).max(1_000_000),
    rate: z.number().min(0.1).max(4),
  });
  const owns = (id: number, userId: number) => !!db.prepare('SELECT 1 FROM pieces WHERE id = ? AND user_id = ?').get(id, userId);
  const bests = (id: number) => db.prepare(`
    SELECT level, part, MAX(score) AS best, COUNT(*) AS count FROM piece_takes WHERE piece_id = ? GROUP BY level, part
  `).all(id);

  router.get('/:id/takes', (req, res) => {
    const id = Number(req.params.id);
    if (!owns(id, req.user!.id)) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    res.json({ success: true, data: bests(id) });
  });

  router.post('/:id/takes', (req, res) => {
    const id = Number(req.params.id);
    const parsed = takeBody.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Prise invalide' });
    if (!owns(id, req.user!.id)) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    const t = parsed.data;
    db.prepare('INSERT INTO piece_takes (user_id, piece_id, level, part, score, chords, wrong, rate, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user!.id, id, t.level, t.part, t.score, t.chords, t.wrong, t.rate, Date.now());
    res.status(201).json({ success: true, data: bests(id) });
  });

  // Sent every minute or so while playing.
  router.post('/:id/time', (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ seconds: z.number().min(1).max(600) }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: 'Durée invalide' });
    if (!owns(id, req.user!.id)) return void res.status(404).json({ success: false, error: 'Morceau introuvable' });
    addTime(db, req.user!.id, id, parsed.data.seconds);
    res.json({ success: true });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM pieces WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
    res.json({ success: true });
  });

  return router;
}
