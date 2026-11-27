import { pieceDifficulties, type PieceDifficulty } from '@piano/shared';
import { useState } from 'react';
import { inputClass } from '../../components/Field';
import { difficultyLabels, difficultyStyles, type PieceFolder } from './types';

export function DifficultyBadge({ value, className = '' }: { value: PieceDifficulty; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${difficultyStyles[value].badge} ${className}`}>
      {difficultyLabels[value]}
    </span>
  );
}

// One tag or none; clicking the selected tag clears it.
export function DifficultyPicker({ value, onChange }: { value: PieceDifficulty | null; onChange(value: PieceDifficulty | null): void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {pieceDifficulties.map((d) => {
        const on = value === d;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(on ? null : d)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
              on ? difficultyStyles[d].badge : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${difficultyStyles[d].dot}`} />
            {difficultyLabels[d]}
          </button>
        );
      })}
    </div>
  );
}

// Folders in tree order (each one followed by its subfolders), with their depth.
export function folderTree(folders: PieceFolder[]): { folder: PieceFolder; depth: number }[] {
  const out: { folder: PieceFolder; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const f of folders.filter((x) => x.parent_id === parent)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function FolderSelect({ folders, value, onChange }: { folders: PieceFolder[]; value: number | null; onChange(id: number | null): void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
      <option value="">Sans dossier</option>
      {folderTree(folders).map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>{'\u00a0\u00a0\u00a0'.repeat(depth)}{depth ? '└ ' : ''}{folder.name}</option>
      ))}
    </select>
  );
}

// The album cover or artist photo found on Deezer, else a plain note.
const COVER_SIZES = { sm: 'h-8 w-8 rounded-md', md: 'h-11 w-11 rounded-lg', lg: 'h-24 w-24 rounded-xl' };
const NOTE_SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-9 w-9' };

export function Cover({ src, size = 'md' }: { src: string | null | undefined; size?: keyof typeof COVER_SIZES }) {
  const [failed, setFailed] = useState(false);
  const box = COVER_SIZES[size];
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${box} shrink-0 bg-neutral-100 object-cover`} />;
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center bg-neutral-100 text-neutral-400`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={NOTE_SIZES[size]} aria-hidden>
        <path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" />
      </svg>
    </span>
  );
}
