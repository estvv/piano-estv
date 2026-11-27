import type { Hand, PieceNumber } from '@piano/shared';
import type { Key, Part } from './numbers';

// Numbers the owner of an imported piece gives its keys, part by part (by
// letter) and hand by hand. Keys left alone go on being numbered as they come.

// The numbers shown for a letter, over all the parts that bear it.
export function keysOf(parts: Part[], label: string, hand: Hand): Key[] {
  const out: Key[] = [];
  for (const p of parts) {
    if (p.label !== label) continue;
    for (const k of p.keys) if (k.hand === hand && !out.some((o) => o.midi === k.midi)) out.push(k);
  }
  return out.sort((a, b) => a.number - b.number);
}

const labelsOf = (parts: Part[]) => [...new Set(parts.map((p) => p.label))];

// The letters a change is for.
const targets = (parts: Part[], label: string, everywhere: boolean) => (everywhere ? labelsOf(parts) : [label]);

const replace = (own: PieceNumber[], label: string, hand: Hand, keys: { midi: number; number: number }[]): PieceNumber[] => [
  ...own.filter((n) => n.label !== label || n.hand !== hand),
  ...keys.map(({ midi, number }) => ({ label, hand, midi, number })),
];

// One key's number. The key that had it takes the old one.
export function setNumber(own: PieceNumber[], parts: Part[], at: { label: string; hand: Hand; everywhere: boolean }, midi: number, number: number): PieceNumber[] {
  return targets(parts, at.label, at.everywhere).reduce((all, label) => {
    const keys = keysOf(parts, label, at.hand);
    const key = keys.find((k) => k.midi === midi);
    if (!key) return all;
    return replace(all, label, at.hand, keys.map((k) => ({ midi: k.midi, number: k === key ? number : k.number === number ? key.number : k.number })));
  }, own);
}

// 1, 2, 3… in the order keys are pressed; the others come after, as they were.
export function orderNumbers(own: PieceNumber[], parts: Part[], at: { label: string; hand: Hand; everywhere: boolean }, pressed: number[]): PieceNumber[] {
  return targets(parts, at.label, at.everywhere).reduce((all, label) => {
    const keys = keysOf(parts, label, at.hand);
    if (!keys.length) return all;
    let next = pressed.length;
    return replace(all, label, at.hand, keys.map((k) => {
      const rank = pressed.indexOf(k.midi);
      return { midi: k.midi, number: rank >= 0 ? rank + 1 : ++next };
    }));
  }, own);
}

// Back to the order keys come in.
export const resetNumbers = (own: PieceNumber[], parts: Part[], at: { label: string; hand: Hand; everywhere: boolean }): PieceNumber[] =>
  own.filter((n) => n.hand !== at.hand || !targets(parts, at.label, at.everywhere).includes(n.label));

export const isOwn = (own: PieceNumber[], label: string, hand: Hand) => own.some((n) => n.label === label && n.hand === hand);
