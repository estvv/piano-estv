import type { LyricLine } from '@piano/shared';
import { describe, expect, it } from 'vitest';
import { anchored, filled, lineAt, movedLyrics, parseLyrics, placed, sungAt, sungLines, toSave, wordWeight } from './lyrics';

const lines = (...times: (number | null)[]): LyricLine[] => times.map((time, i) => ({ time, text: `ligne ${i}` }));
const times = (list: LyricLine[]) => list.map((l) => l.time);

describe('lyrics', () => {
  it('are read from LRC', () => {
    const lrc = '﻿[ti:Chanson]\r\n[offset:+500]\r\n[00:05.00]\r\n[00:10.50] la <00:10.70>la\r\n[01:02.25][00:30.00]refrain\r\n[00:40.00]\r\n[00:41.00] ';
    expect(parseLyrics(lrc)).toEqual([
      { time: 10, text: 'la la' }, { time: 29.5, text: 'refrain' }, { time: 39.5, text: '' }, { time: 61.75, text: 'refrain' },
    ]);
  });

  it('or from plain text', () => {
    expect(parseLyrics('Une ligne\n\n  deux   lignes \n[ar:X]\n')).toEqual([{ time: null, text: 'Une ligne' }, { time: null, text: 'deux lignes' }]);
    expect(parseLyrics('  \n')).toEqual([]);
  });

  it('all follow one line put in its place', () => {
    expect(times(placed(lines(10, 20, 30), new Map([[0, 4]])))).toEqual([4, 14, 24]);
    expect(times(placed(lines(10, 20, 30), new Map()))).toEqual([10, 20, 30]);
  });

  it('are spread between several, and follow their tempo around', () => {
    // The piece goes twice as fast as the recording.
    expect(times(placed(lines(0, 10, 50, 90, 100), new Map([[1, 5], [3, 45]])))).toEqual([0, 5, 25, 45, 50]);
    // Too close to tell a tempo.
    expect(times(placed(lines(10, 12, 60), new Map([[0, 5], [1, 7.4]])))).toEqual([5, 7.4, 55.4]);
  });

  it('with no times are the ones tapped', () => {
    let a = anchored(new Map(), 0, 3);
    a = anchored(a, 1, 6);
    expect(times(placed(lines(null, null, null), a))).toEqual([3, 6, null]);
    // Going back on one takes off those it contradicts.
    expect([...anchored(anchored(a, 2, 9), 1, 10)]).toEqual([[0, 3], [1, 10]]);
    expect([...anchored(a, 0, 8)]).toEqual([[0, 8]]);
  });

  it('are saved without those before the start', () => {
    expect(times(toSave(lines(-2, 0.12345, null)))).toEqual([null, 0.123, null]);
  });

  it('say which line is sung', () => {
    const list = lines(2, null, 5, 9);
    expect([0, 2, 6, 20].map((t) => lineAt(list, t))).toEqual([{ now: -1, next: 0 }, { now: 0, next: 2 }, { now: 2, next: 3 }, { now: 3, next: -1 }]);
  });

  it('follow the parts of a piece written by hand', () => {
    const span = (label: string, start: number) => ({ label, start, end: start + 4 });
    const before = [span('A', 0), span('B', 4), span('A', 8)];
    const list = lines(1, 5, 9, 14);
    expect(times(movedLyrics(list, before, before, 1))).toEqual([1, 5, 9, 14]);
    expect(times(movedLyrics(list, before, [span('B', 0), span('A', 4)], 1))).toEqual([1, 5]);
    expect(times(movedLyrics(list, before, before.map((s) => ({ ...s, start: s.start * 2, end: s.end * 2 })), 2))).toEqual([2, 10, 18, 28]);
    expect(times(movedLyrics(list, before, [span('A', 0), span('Z', 4), span('A', 8)], 1))).toEqual([1, 5, 9, 14]);
    // The second A rather than the first.
    expect(times(movedLyrics(list, before, [span('A', 0)], 1, () => 2))).toEqual([1, 6]);
  });

  it('are spread word by word, by syllables', () => {
    expect(['la', 'corde', 'pendu', 'impact', 'comprendre', 'Allée', 'beauté', 'the', 'mots,', '!'].map(wordWeight)).toEqual([1, 1, 2, 2, 2, 2, 2, 1, 1.5, 0.5]);
    const [first, second, silence, last] = sungLines([
      { time: 10, text: 'pendu la' }, { time: 13, text: 'la la la' }, { time: 16, text: '' }, { time: null, text: 'non' }, { time: 40, text: 'la la' },
    ]);
    // Two syllables, then one; over just before the next line.
    expect(first.words.map((w) => [w.text, +w.from.toFixed(2), +w.to.toFixed(2)])).toEqual([['pendu', 10, 11.9], ['la', 11.9, 12.85]]);
    expect(second.end).toBeCloseTo(15.85);
    expect(silence.words).toEqual([]);
    // Nothing after it: at the pace of the song.
    expect(last.end).toBeGreaterThan(41);
    expect(last.end).toBeLessThan(43);
  });

  it('do not drag over a rest', () => {
    const list = sungLines([0, 2, 4, 6, 30].map((time) => ({ time, text: 'la la la la' })));
    expect(list[3].end).toBeLessThan(9);
    expect([-1, 0, 3, 29, 99].map((t) => sungAt(list, t))).toEqual([-1, 0, 1, 3, 4]);
    expect([0, 1, 2, 9].map((t) => filled({ from: 1, to: 3 }, t))).toEqual([0, 0, 0.5, 1]);
    expect(sungLines([])).toEqual([]);
  });
});
