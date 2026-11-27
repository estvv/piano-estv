import type { Hand } from '@piano/shared';
import type { Part, Step } from './numbers';
import { sequenceSaid } from './sequence';

// Where the keys written by hand part from those worked out from the notes: a
// key written instead of another, one too many, one left out. Only the keys
// count: how they are cut into lines, or "-" against " ", does not.

// A key, or keys played together, in the text written: where it is in it.
export interface Written {
  text: string;
  from: number;
  to: number;
}

// A key worked out: its step, and the part it is in.
export interface Expected {
  text: string;
  step: Step;
  part: number;
}

export type Gap =
  | { kind: 'wrong'; written: Written; expected: Expected }
  | { kind: 'extra'; written: Written; near: Expected | null }
  | { kind: 'missing'; expected: Expected; at: number };

// "9+1" is "1+9".
const same = (keys: string) => keys.split('+').map(Number).sort((a, b) => a - b).join('+');

export function writtenKeys(text: string): Written[] {
  return [...text.matchAll(/\d+(?:\s*\+\s*\d+)*/g)].map((m) => ({ text: same(m[0].replace(/\s+/g, '')), from: m.index, to: m.index + m[0].length }));
}

export function expectedKeys(parts: Part[], hand: Hand): Expected[] {
  return parts.flatMap((p, part) => sequenceSaid(p, hand).flatMap((line) =>
    line.flatMap((x) => [...x.text.matchAll(/\d+(?:\+\d+)*/g)].map((m) => ({ text: same(m[0]), step: x.step, part })))));
}

// Longest run in common, then what lies between: as many wrong as can be
// paired, the rest too many or missing.
export function compare(written: Written[], expected: Expected[]): Gap[] {
  const [n, m] = [written.length, expected.length];
  const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i][j] = written[i].text === expected[j].text ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const gaps: Gap[] = [];
  let [i, j] = [0, 0];
  let extra: Written[] = [];
  let missing: Expected[] = [];
  const settle = () => {
    const paired = Math.min(extra.length, missing.length);
    for (let k = 0; k < paired; k++) gaps.push({ kind: 'wrong', written: extra[k], expected: missing[k] });
    for (const w of extra.slice(paired)) gaps.push({ kind: 'extra', written: w, near: expected[j] ?? expected[j - 1] ?? null });
    const at = written[i]?.from ?? written[n - 1]?.to ?? 0;
    for (const e of missing.slice(paired)) gaps.push({ kind: 'missing', expected: e, at });
    [extra, missing] = [[], []];
  };
  while (i < n || j < m) {
    if (i < n && j < m && written[i].text === expected[j].text) {
      settle();
      i++;
      j++;
    } else if (j >= m || (i < n && common[i + 1][j] >= common[i][j + 1])) {
      extra.push(written[i++]);
    } else {
      missing.push(expected[j++]);
    }
  }
  settle();
  return gaps;
}
