import { describe, expect, it } from 'vitest';
import { frenchName, noteLabel, noteName, parseNote, parseRange } from './index.ts';

describe('music', () => {
  it('parses and names notes', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('A0')).toBe(21);
    expect(parseNote('C#4')).toBe(61);
    expect(parseNote('Db4')).toBe(61);
    expect(parseNote('H4')).toBeUndefined();
    expect(noteName(61)).toBe('C#4');
    expect(noteName(61, true)).toBe('Db4');
    expect(frenchName(67)).toBe('Sol');
    expect(noteLabel(60, true)).toBe('Do (C4)');
    expect(noteLabel(61)).toBe('Do♯ / Ré♭ (C♯ / D♭)');
    expect(parseRange('C3-C5')).toEqual([48, 72]);
    expect(parseRange('C5..C3')).toEqual([48, 72]);
  });
});
