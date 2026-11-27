import { describe, expect, it } from 'vitest';
import { compare, writtenKeys, type Expected } from './anomalies';

const expected = (text: string): Expected[] => text.split(/[- \n]+/).map((t, i) => ({ text: t, step: { step: i, time: i, end: i + 0.5, chords: [], notes: [] }, part: 0 }));

describe('keys written against those worked out', () => {
  it('reads keys and chords, wherever lines are cut', () => {
    expect(writtenKeys('5-7-5-4\n3-7-6 9 + 1').map((w) => w.text)).toEqual(['5', '7', '5', '4', '3', '7', '6', '1+9']);
    expect(compare(writtenKeys('1-2\n3 4'), expected('1-2-3-4'))).toEqual([]);
    expect(compare(writtenKeys('9+1-2'), expected('1+9-2'))).toEqual([]);
  });

  it('finds a key wrong, too many or left out', () => {
    const gaps = compare(writtenKeys('1-2-7-4-4-5'), expected('1-2-3-4-5-6'));
    expect(gaps.map((g) => g.kind)).toEqual(['wrong', 'extra', 'missing']);
    const [wrong, extra, missing] = gaps;
    expect(wrong.kind === 'wrong' && [wrong.written.text, wrong.expected.text]).toEqual(['7', '3']);
    expect(extra.kind === 'extra' && extra.written.text).toBe('4');
    expect(missing.kind === 'missing' && missing.expected.text).toBe('6');
  });
});
