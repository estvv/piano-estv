import { isBlack } from '@piano/shared';

// Horizontal position of each key as a fraction of the keyboard width. The
// on-screen keyboard and the falling notes use the same numbers so notes land
// exactly on their key.

export interface KeyBox {
  x: number; // left, 0..1
  width: number; // 0..1
  black: boolean;
}

// A range always starts and ends on white keys.
export function widenRange(from: number, to: number): [number, number] {
  return [isBlack(from) ? from - 1 : from, isBlack(to) ? to + 1 : to];
}

export function keyLayout(from: number, to: number): Map<number, KeyBox> {
  const [lo, hi] = widenRange(from, to);
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const w = 1 / whites.length;
  const boxes = new Map<number, KeyBox>();
  whites.forEach((m, i) => {
    boxes.set(m, { x: i * w, width: w, black: false });
    if (m + 1 <= hi && isBlack(m + 1)) boxes.set(m + 1, { x: (i + 1) * w - w * 0.3, width: w * 0.6, black: true });
  });
  return boxes;
}
