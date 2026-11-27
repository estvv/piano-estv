import { describe, expect, it } from 'vitest';
import { currentOf, drop, next, previous, queueFrom, startQueue, type Queue } from './shuffle';

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

describe('shuffled listening', () => {
  it('plays every piece once per round, never twice in a row', () => {
    for (let n = 2; n < 6; n++) {
      const all = Array.from({ length: n }, (_, i) => i + 1);
      let q = startQueue(all)!;
      let last = 0;
      for (let round = 0; round < 50; round++) {
        const heard: number[] = [];
        for (let i = 0; i < n; i++) {
          expect(currentOf(q)).not.toBe(last);
          last = currentOf(q);
          heard.push(last);
          q = next(q);
        }
        expect(sorted(heard)).toEqual(all);
      }
    }
  });

  it('plays a single piece again and again', () => {
    const q = startQueue([7])!;
    const again = next(q);
    expect(currentOf(again)).toBe(7);
    expect(again.turn).not.toBe(q.turn);
  });

  it('starts from the piece being played', () => {
    const q = queueFrom([1, 2, 3, 4], 3, 8);
    expect([currentOf(q), q.turn]).toEqual([3, 8]);
    expect(sorted(q.ids)).toEqual([1, 2, 3, 4]);
    expect(queueFrom([], 3, 0).ids).toEqual([3]);
  });

  it('has nothing to play without pieces', () => expect(startQueue([])).toBe(null));

  it('goes back, down to the first piece', () => {
    const q: Queue = { ids: [1, 2, 3], index: 1, turn: 0 };
    expect(currentOf(previous(q))).toBe(1);
    expect(currentOf(previous(previous(q)))).toBe(1);
  });

  it('drops a piece', () => {
    const q: Queue = { ids: [1, 2, 3], index: 1, turn: 4 };
    expect(currentOf(drop(q, 2)!)).toBe(3);
    expect(drop(q, 1)).toEqual({ ids: [2, 3], index: 0, turn: 4 });
    expect(sorted(drop({ ...q, index: 2 }, 3)!.ids)).toEqual([1, 2]);
    expect(drop(q, 9)).toBe(q);
    expect(drop({ ids: [1], index: 0, turn: 0 }, 1)).toBe(null);
  });
});
