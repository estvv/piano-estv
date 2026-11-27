import { aiReadingSchema, scoreSchema } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { fromReading, numbersToPlace, scoreFromNumbers } from './aiImport';
import { runText } from './score';

const read = (value: unknown) => fromReading(aiReadingSchema.parse(value), 'photo');

describe('pictures read by the AI', () => {
  it('turns aligned numbers into a score, both hands in step', () => {
    const r = read({ kind: 'numbers', title: 'Loop', parts: [{ label: 'A', aligned: true, left: ['1', '3', '', '5'], right: ['4', '', '4', '6+2'] }] });
    if (r.kind !== 'numbers') throw new Error();
    expect(r.title).toBe('Loop');
    expect(scoreSchema.safeParse(r.score).success).toBe(true);
    const [part] = r.score.parts;
    expect([runText(part, 'left'), runText(part, 'right')]).toEqual(['1 3 5', '4 4 2+6']);
    expect(part.notes.filter((n) => n.hand === 'right').map((n) => n.step).sort()).toEqual([0, 2, 3, 3]);
    expect(numbersToPlace(r.score)).toEqual([{ hand: 'left', numbers: [1, 3, 5] }, { hand: 'right', numbers: [2, 4, 6] }]);
  });

  it('keeps the parts, named once each, with the same keys', () => {
    const score = scoreFromNumbers([
      { label: '', aligned: false, left: [], right: ['1', '2'] },
      { label: 'A', aligned: false, left: [], right: ['0', '2', 'x'] },
      { label: 'Refrain qui est long', aligned: false, left: ['7'], right: [] },
    ]);
    expect(score.parts.map((p) => p.label)).toEqual(['A', 'A2', 'Refrain qui ']);
    expect(new Set(score.parts.map((p) => p.keys.find((k) => k.hand === 'right' && k.number === 2)?.midi)).size).toBe(1);
    expect(score.order).toHaveLength(3);
    expect(() => scoreFromNumbers([{ label: 'A', aligned: false, left: [], right: ['?'] }])).toThrow('Aucun numéro');
  });

  it('makes a long run fit its part', () => {
    const score = scoreFromNumbers([{ label: 'A', aligned: false, left: [], right: Array(21).fill('1') }]);
    expect([score.parts[0].beats, score.parts[0].notes.length]).toEqual([12, 21]);
    expect(scoreSchema.safeParse(score).success).toBe(true);
  });

  it('turns a score into notes, bar by bar', () => {
    const r = read({
      kind: 'score', bpm: 60,
      measures: [
        { right: [{ notes: ['D5', 'F#5'], beats: 1 }, { notes: [], beats: 1 }, { notes: ['Bb4'], beats: 2 }], left: [{ notes: ['G2'], beats: 4 }] },
        { right: [{ notes: ['C5', 'Z9'], beats: 1 }], left: [{ notes: ['C3'], beats: 2 }] },
      ],
    });
    if (r.kind !== 'notes') throw new Error();
    expect(r.result.notes.map((n) => `${n.midi}@${n.time}${n.hand![0]}`)).toEqual(['43@0l', '74@0r', '78@0r', '70@2r', '48@4l', '72@4r']);
    expect(r.result.title).toBe('photo');
    expect(r.result.warnings).toHaveLength(2);
  });

  it('says why nothing was read', () => {
    expect(() => read({ kind: 'nothing', reason: 'Un chat.' })).toThrow('Un chat.');
  });
});
