import { renderScore, type LyricLine, type Piece, type PieceNumbering, type PieceEdits, type PieceLevel, type PieceNote, type PieceNumber, type PieceSection, type Score } from '@piano/shared';
import { api } from '../../lib/api';
import type { PieceChange } from './derive';
import type { FoundLyrics } from './lyrics';
import type { PieceCopy } from './pieceCopy';
import type { PieceFolder, PieceMeta, PieceSequence, PieceSummary, StoredPiece } from './types';

export const piecesApi = {
  list: () => api<PieceSummary[]>('/pieces'),
  get: (id: number) => api<StoredPiece>(`/pieces/${id}`),
  create: (piece: Piece, extra: Partial<Pick<PieceMeta, 'folder_id' | 'difficulty' | 'description'>> = {}) =>
    api<{ id: number }>('/pieces', { method: 'POST', json: { piece, ...extra } }),
  createScore: (piece: Pick<Piece, 'title' | 'artist'>, score: Score, extra: Partial<Pick<PieceMeta, 'folder_id' | 'difficulty'>>) =>
    api<{ id: number }>('/pieces', { method: 'POST', json: { piece: { ...piece, source: 'manual', bpm: score.bpm, notes: renderScore(score).notes }, score, ...extra } }),
  paste: (copy: PieceCopy, folder_id: number | null) => api<{ id: number }>('/pieces', { method: 'POST', json: { ...copy, folder_id } }),
  saveScore: (id: number, score: Score) => api(`/pieces/${id}/score`, { method: 'PUT', json: { score } }),
  // Answers the cover, searched again when the title or artist changed.
  // cover: picked by hand (from a link); left out, it follows the title and artist.
  update: (id: number, meta: Partial<PieceMeta> & { cover?: string | null; tracks_enabled?: boolean[]; level?: PieceLevel; sections?: PieceSection[] | null; edits?: PieceEdits | null; numbers?: PieceNumber[] | null; lyrics?: LyricLine[] | null; numbering?: PieceNumbering; whole?: boolean; sequence?: PieceSequence | null }) => api<{ cover: string | null }>(`/pieces/${id}`, { method: 'PATCH', json: meta }),
  remove: (id: number) => api(`/pieces/${id}`, { method: 'DELETE' }),
  // Corrected notes replace the piece's.
  saveNotes: (id: number, change: { bpm?: number; notes: PieceNote[]; sections?: PieceSection[] | null; edits?: PieceEdits | null; lyrics?: LyricLine[] | null }) => api(`/pieces/${id}/notes`, { method: 'PUT', json: change }),
  // What changeOf (derive.ts) says to save.
  saveChange: (id: number, { notes, bpm, ...rest }: PieceChange): Promise<unknown> => (notes ? piecesApi.saveNotes(id, { notes, bpm, ...rest }) : piecesApi.update(id, rest)),
  practice: () => api<Practice>('/pieces/practice'),
  // `leaving`: sent even as the page goes.
  addTime: (id: number, seconds: number, leaving = false) => api(`/pieces/${id}/time`, { method: 'POST', json: { seconds }, keepalive: leaving }),
  takes: (id: number) => api<Best[]>(`/pieces/${id}/takes`),
  // Answers the best of each part again.
  addTake: (id: number, take: { level: PieceLevel; part: string; score: number; chords: number; wrong: number; rate: number }) =>
    api<Best[]>(`/pieces/${id}/takes`, { method: 'POST', json: take }),
  findLyrics: (title: string, artist: string | null) => api<FoundLyrics[]>(`/pieces/lyrics?${new URLSearchParams({ title, ...(artist ? { artist } : {}) })}`),
  coverFromLink: (link: string, signal?: AbortSignal) =>
    api<{ cover: string | null }>(`/pieces/cover?${new URLSearchParams({ link })}`, { signal }),
  findCover: (title: string, artist: string | null, signal?: AbortSignal) =>
    api<{ cover: string | null }>(`/pieces/cover?${new URLSearchParams({ title, ...(artist ? { artist } : {}) })}`, { signal }),
};

// The best take of a part, at a level.
export interface Best { level: PieceLevel; part: string; best: number; count: number }

// Time spent playing (backend/src/practice.ts).
export interface Practice {
  today: number;
  days: { day: string; seconds: number }[];
  pieces: { id: number; title: string; artist: string | null; cover: string | null; seconds: number; last: string; best: number | null }[];
}

export const foldersApi = {
  list: () => api<PieceFolder[]>('/pieces/folders'),
  create: (name: string, parent_id: number | null = null) =>
    api<{ id: number }>('/pieces/folders', { method: 'POST', json: { name, parent_id } }),
  // Rename, or move into another folder (parent_id null: top level).
  update: (id: number, change: { name?: string; parent_id?: number | null }) => api(`/pieces/folders/${id}`, { method: 'PATCH', json: change }),
  reorder: (ids: number[]) => api('/pieces/folders/order', { method: 'PUT', json: { ids } }),
  remove: (id: number) => api(`/pieces/folders/${id}`, { method: 'DELETE' }),
};

export type FileKind = 'midi' | 'musicxml' | 'pdf' | 'image' | 'video' | 'audio';

export function fileKind(file: File): FileKind | null {
  if (/\.(mid|midi)$/i.test(file.name)) return 'midi';
  if (/\.(musicxml|xml|mxl)$/i.test(file.name)) return 'musicxml';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|m4a|aac)$/i.test(file.name)) return 'audio';
  return null;
}

export const ACCEPT = '.mid,.midi,.musicxml,.xml,.mxl,.pdf,image/*,audio/*,video/*';
