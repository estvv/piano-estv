import type { LyricLine, Piece, PieceNumbering, PieceDifficulty, PieceEdits, PieceLevel, PieceNumber, PieceSection, Score } from '@piano/shared';

export interface ImportResult extends Piece {
  // Things the user should know about the conversion.
  warnings: string[];
}

export interface PieceSummary {
  id: number;
  title: string;
  artist: string | null;
  // Optional note telling versions apart ("en entier", "boucle du refrain").
  description: string | null;
  // Album cover or artist photo found on Deezer.
  cover: string | null;
  folder_id: number | null;
  difficulty: PieceDifficulty | null;
  source: Piece['source'];
  bpm: number | null;
  note_count: number;
  duration: number;
  created_at: number;
}

export interface StoredPiece extends Piece {
  id: number;
  folder_id?: number | null;
  difficulty?: PieceDifficulty | null;
  cover?: string | null;
  description?: string | null;
  level?: PieceLevel;
  // Parts set by hand; null: found automatically.
  sections?: PieceSection[] | null;
  // Numbers given to keys by hand (see ownNumbers.ts).
  numbers?: PieceNumber[] | null;
  // Changes made by hand to the easier levels (see levelEdits.ts).
  edits?: PieceEdits | null;
  // How the player numbers keys; `whole`: across parts (see numbers.ts).
  numbering?: PieceNumbering;
  whole?: boolean;
  // Sung along (see lyrics.ts).
  lyrics?: LyricLine[] | null;
  // The order of the keys as written by hand (see sequence.ts); null: worked out.
  sequence?: PieceSequence | null;
  // Pieces written by hand; null: imported.
  score?: Score | null;
}

export interface PieceSequence {
  left?: string;
  right?: string;
}

export interface PieceFolder {
  id: number;
  name: string;
  parent_id: number | null;
  position: number;
}

// What the owner can change on a piece.
export interface PieceMeta {
  title: string;
  artist: string | null;
  description: string | null;
  folder_id: number | null;
  difficulty: PieceDifficulty | null;
}

export const difficultyLabels: Record<PieceDifficulty, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
  impossible: 'Impossible',
};

// Tag colours: full class names so Tailwind keeps them.
export const difficultyStyles: Record<PieceDifficulty, { badge: string; dot: string }> = {
  easy: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  medium: { badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  hard: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  impossible: { badge: 'bg-neutral-900 text-white ring-neutral-900', dot: 'bg-neutral-900' },
};

export const sourceLabels: Record<Piece['source'], string> = {
  midi: 'MIDI',
  musicxml: 'Partition',
  audio: 'Audio',
  video: 'Vidéo',
  manual: 'Fait main',
};
