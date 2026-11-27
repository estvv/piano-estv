// Kept in TypeScript (not a .sql file) so the bundle is self-contained.
export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  avatar BLOB,
  avatar_type TEXT,
  avatar_updated_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Folders of pieces, in the owner's order of priority.
CREATE TABLE IF NOT EXISTS piece_folders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Folder it sits in; NULL at the top level.
  parent_id INTEGER REFERENCES piece_folders(id) ON DELETE CASCADE,
  -- Order of priority among the folders of the same parent.
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_piece_folders_user ON piece_folders (user_id);

-- Pieces (MIDI, MusicXML, audio transcription, written by hand), private to their owner.
CREATE TABLE IF NOT EXISTS pieces (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT,
  -- Free note to tell versions apart ("en entier", "boucle du refrain").
  description TEXT,
  folder_id INTEGER REFERENCES piece_folders(id) ON DELETE SET NULL,
  difficulty TEXT,
  -- Cover image URL; '' when searched without result, NULL when not searched yet.
  cover TEXT,
  -- Instruments of a multi-track file, JSON [{ name, instrument, enabled }].
  tracks TEXT,
  -- Level shown in the player (original, simplified, melody); NULL: original.
  level TEXT,
  -- Practice parts set by hand, JSON [{ start, label }]; NULL: automatic.
  sections TEXT,
  -- Numbers given to keys by hand, JSON [{ label, hand, midi, number }].
  numbers TEXT,
  -- How the player numbers keys (order, hand, fixed; NULL: order), and whether
  -- across parts (whole = 1).
  numbering TEXT,
  whole INTEGER,
  -- The order of the keys as the owner wrote it, JSON { left?, right? }; NULL:
  -- worked out from the notes.
  sequence TEXT,
  -- Lyrics, JSON [{ time, text }], times in seconds.
  lyrics TEXT,
  -- Changes made by hand to the easier levels, JSON { simplified?, melody? }.
  edits TEXT,
  -- Pieces written by hand, JSON (shared/src/score.ts): the notes come from it.
  score TEXT,
  source TEXT NOT NULL,
  bpm REAL,
  data TEXT NOT NULL,
  note_count INTEGER NOT NULL,
  duration REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pieces_user ON pieces (user_id);

-- Pieces played through in wait mode: the piece, or the parts looped (part, by
-- their letters; '' for the whole piece), at a level.
CREATE TABLE IF NOT EXISTS piece_takes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  part TEXT NOT NULL,
  score INTEGER NOT NULL,
  chords INTEGER NOT NULL,
  wrong INTEGER NOT NULL,
  rate REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_piece_takes ON piece_takes (piece_id, level, part);

-- Seconds spent playing a piece, each day (in the owner's time zone).
CREATE TABLE IF NOT EXISTS piece_time (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, piece_id, day)
);
`;
