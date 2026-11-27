import type { PieceSection } from '@piano/shared';
import type { Section } from './sections';

// Parts corrected by hand. Every function returns new parts; the first one
// always starts the piece.

export const toSaved = (sections: Section[]): PieceSection[] =>
  sections.length ? sections.map(({ start, label }) => ({ start, label })) : [{ start: 0, label: 'A' }];

export function fromSaved(saved: PieceSection[], duration: number): Section[] {
  const inside = saved.filter((s) => s.start < duration);
  return inside.map((s, i) => ({ ...s, end: inside[i + 1]?.start ?? duration }));
}

const index = (parts: PieceSection[], start: number) => parts.findIndex((p) => Math.abs(p.start - start) < 0.05);

// First letter not used yet.
export function newLabel(parts: PieceSection[]): string {
  const used = new Set(parts.map((p) => p.label));
  for (let i = 0; ; i++) {
    const label = String.fromCharCode(65 + (i % 26)) + (i < 26 ? '' : Math.floor(i / 26) + 1);
    if (!used.has(label)) return label;
  }
}

export function cutAt(parts: PieceSection[], start: number): PieceSection[] {
  if (start <= 0.05 || index(parts, start) >= 0) return parts;
  return [...parts, { start, label: newLabel(parts) }].sort((a, b) => a.start - b.start);
}

// The part joins the one before it.
export const joinPrevious = (parts: PieceSection[], i: number) => (i > 0 ? parts.filter((_, k) => k !== i) : parts);

export function moveStart(parts: PieceSection[], i: number, start: number): PieceSection[] {
  const next = parts[i + 1]?.start ?? Infinity;
  if (i <= 0 || start <= parts[i - 1].start + 0.05 || start >= next - 0.05) return parts;
  return parts.map((p, k) => (k === i ? { ...p, start } : p));
}

export function rename(parts: PieceSection[], i: number, label: string): PieceSection[] {
  const clean = label.trim().slice(0, 12);
  return clean ? parts.map((p, k) => (k === i ? { ...p, label: clean } : p)) : parts;
}
