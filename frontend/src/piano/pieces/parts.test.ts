import { shiftSections } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { cutAt, fromSaved, joinPrevious, moveStart, rename } from './parts';

const ABA = [{ start: 0, label: 'A' }, { start: 4, label: 'B' }, { start: 8, label: 'A' }];
const text = (p: { start: number; label: string }[]) => p.map((x) => `${x.label}${x.start}`).join(' ');

describe('parts corrected by hand', () => {
  it('cuts with a new letter, once per place', () => {
    expect(text(cutAt(ABA, 6))).toBe('A0 B4 C6 A8');
    expect(cutAt(ABA, 4.01)).toBe(ABA);
    expect(cutAt(ABA, 0)).toBe(ABA);
  });

  it('joins a part to the one before it', () => {
    expect(text(joinPrevious(ABA, 1))).toBe('A0 A8');
    expect(joinPrevious(ABA, 0)).toBe(ABA);
  });

  it('moves a start between its neighbours', () => {
    expect(text(moveStart(ABA, 1, 5))).toBe('A0 B5 A8');
    expect(moveStart(ABA, 1, 8)).toBe(ABA);
    expect(moveStart(ABA, 0, 1)).toBe(ABA);
  });

  it('renames, never to nothing', () => {
    expect(text(rename(ABA, 1, ' A '))).toBe('A0 A4 A8');
    expect(rename(ABA, 1, '  ')).toBe(ABA);
  });

  it('follows a piece cut at its start', () => {
    expect(text(shiftSections(ABA, 5))).toBe('B0 A3');
    expect(text(shiftSections(ABA, 4))).toBe('B0 A4');
    expect(text(shiftSections(ABA, 20))).toBe('A0');
    expect(shiftSections(ABA, 0)).toEqual(ABA);
  });

  it('gives each part its end, within the piece', () => {
    expect(fromSaved(ABA, 10).map((s) => s.end)).toEqual([4, 8, 10]);
    expect(fromSaved(ABA, 7).map((s) => s.end)).toEqual([4, 7]);
  });
});
