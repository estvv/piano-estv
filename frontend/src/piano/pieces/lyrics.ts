import type { LyricLine } from '@piano/shared';

// Lyrics along with a piece, line by line. Those found have the times of a
// recording: a few lines put in their place are enough to move the others.

// As the backend finds them (backend/src/lyrics.ts).
export interface FoundLyrics {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  synced: string | null;
  plain: string | null;
}

const MAX_LINES = 500;
const MAX_TEXT = 300;
const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

// LRC ("[01:23.45] la la"), or plain text: a line each, times not known.
export function parseLyrics(text: string): LyricLine[] {
  const rows = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const timed: { time: number; text: string }[] = [];
  let shift = 0;
  for (const row of rows) {
    const offset = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(row);
    // In milliseconds; positive: the lines come sooner.
    if (offset) shift = Number(offset[1]) / 1000;
    const stamps = [...row.matchAll(STAMP)];
    if (!stamps.length) continue;
    // Words may have a time too.
    const words = clean(row.replace(STAMP, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, ''));
    for (const [, minutes, seconds] of stamps) timed.push({ time: Number(minutes) * 60 + Number(seconds.replace(':', '.')), text: words });
  }
  if (timed.length) {
    const lines = timed.map((l) => ({ ...l, time: Math.max(0, l.time - shift) })).sort((a, b) => a.time - b.time);
    // Nobody sings: said once, and not before the first line.
    return lines.filter((l, i) => l.text || (i > 0 && !!lines[i - 1].text)).slice(0, MAX_LINES);
  }
  return rows.map(clean).filter((t) => t && !/^\[[a-z]+:.*\]$/i.test(t)).map((t) => ({ time: null, text: t })).slice(0, MAX_LINES);
}

// --- Putting them in their place -----------------------------------------------------

// Lines put in their place by hand: line -> seconds.
export type Anchors = ReadonlyMap<number, number>;

// Anchors further apart than this tell how fast the piece goes (seconds).
const TELLING = 20;

// Times only go up: an anchor takes off those it contradicts.
export function anchored(anchors: Anchors, line: number, time: number): Map<number, number> {
  const out = new Map([...anchors].filter(([i, t]) => (i < line ? t < time : i > line ? t > time : false)));
  out.set(line, time);
  return out;
}

// Between two anchors, lines are spread as they were; around them, they follow.
export function placed(lines: LyricLine[], anchors: Anchors): LyricLine[] {
  const known = [...anchors]
    .filter(([i]) => lines[i]?.time !== null && lines[i] !== undefined)
    .map(([i, to]) => ({ from: lines[i].time!, to }))
    .sort((a, b) => a.from - b.from);
  const first = known[0];
  const last = known[known.length - 1];
  const telling = known.length > 1 && last.from - first.from >= TELLING;
  const speed = telling ? (last.to - first.to) / (last.from - first.from) : 1;
  const move = (time: number): number => {
    if (!first) return time;
    if (time <= first.from) return first.to + (time - first.from) * speed;
    if (time >= last.from) return last.to + (time - last.from) * speed;
    const i = known.findIndex((k) => k.from > time);
    const [a, b] = [known[i - 1], known[i]];
    return b.from === a.from ? a.to : a.to + ((time - a.from) / (b.from - a.from)) * (b.to - a.to);
  };
  return lines.map((l, i) => {
    const own = anchors.get(i);
    if (own !== undefined) return { ...l, time: own };
    return l.time === null ? l : { ...l, time: move(l.time) };
  });
}

// What is kept: lines sung before the piece starts are not shown.
export const toSave = (lines: LyricLine[]): LyricLine[] =>
  lines.map((l) => ({ ...l, time: l.time === null || l.time < 0 ? null : Math.round(l.time * 1000) / 1000 }));

// --- Showing them ---------------------------------------------------------------------

// Sung now, and next. -1: none yet.
export function lineAt(lines: LyricLine[], time: number): { now: number; next: number } {
  let now = -1;
  let next = -1;
  lines.forEach((l, i) => {
    if (l.time === null) return;
    if (l.time <= time + 0.05) {
      if (now < 0 || l.time >= lines[now].time!) now = i;
    } else if (next < 0 || l.time < lines[next].time!) next = i;
  });
  return { now, next };
}

// --- Following the piece --------------------------------------------------------------

interface Span { label: string; start: number; end: number }

// A piece written by hand, changed: lines follow the part they are sung in.
// `scale`: how much longer it lasts. `match`: where each part was.
export function movedLyrics(lines: LyricLine[], before: Span[], after: Span[], scale: number, match = (i: number): number => samePart(before, after, i)): LyricLine[] {
  return after.flatMap((s, i) => {
    const k = match(i);
    const was = before[k];
    if (!was) return [];
    const end = k + 1 === before.length ? Infinity : was.end;
    return lines.flatMap((l) => {
      if (l.time === null || l.time < was.start || l.time >= end) return [];
      const time = s.start + (l.time - was.start) * scale;
      return time < s.end || i + 1 === after.length ? [{ ...l, time }] : [];
    });
  });
}

// The part of the same name, as many times as it was played before.
function samePart(before: Span[], after: Span[], i: number): number {
  const { label } = after[i];
  const times = after.slice(0, i).filter((s) => s.label === label).length;
  const same = before.flatMap((s, k) => (s.label === label ? [k] : []));
  if (same.length) return same[Math.min(times, same.length - 1)];
  // Renamed.
  return before[i] && !after.some((s) => s.label === before[i].label) ? i : -1;
}

// --- Word by word -----------------------------------------------------------------------

export interface SungLine {
  text: string;
  time: number;
  // When its last word is over, about.
  end: number;
  words: { text: string; from: number; to: number }[];
}

// How long a word is to sing: its syllables, about (French or English), and the
// breath after a comma.
export function wordWeight(word: string): number {
  const plain = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe');
  const letters = plain.replace(/[^\p{L}\p{N}]/gu, '');
  const silent = /[^aeiouy]e?(?:es|e)$/.test(letters) && !/é(?:e?s?)\W*$/i.test(word.normalize('NFC'));
  const vowels = letters.match(/[aeiouy]+/g)?.length ?? 0;
  const syllables = Math.max(letters ? 1 : 0, vowels - (silent && vowels > 1 ? 1 : 0));
  return syllables + (/[,;:.!?…]$/.test(word) ? 0.5 : 0);
}

// A little longer than usual still counts as singing; more than that is a rest.
const SLOW = 1.3;
// Of the time there is before the next line.
const FULL = 0.95;
const USUAL_PACE = 0.3; // seconds a syllable

// Only when lines start is known: their words are spread at the pace of the song.
export function sungLines(lines: LyricLine[]): SungLine[] {
  const timed = lines.flatMap((l) => (l.time === null ? [] : [{ text: l.text, time: l.time }])).sort((a, b) => a.time - b.time);
  const weights = timed.map((l) => l.text.split(/\s+/).filter(Boolean).map((text) => ({ text, weight: wordWeight(text) })));
  const total = (i: number) => weights[i].reduce((sum, w) => sum + w.weight, 0);
  const paces = timed
    .flatMap((l, i) => (timed[i + 1] && total(i) ? [(timed[i + 1].time - l.time) / total(i)] : []))
    .filter((p) => p > 0.05)
    .sort((a, b) => a - b);
  const pace = paces.length ? Math.min(1, paces[paces.length >> 1]) : USUAL_PACE;
  return timed.map((l, i) => {
    const room = timed[i + 1] ? (timed[i + 1].time - l.time) * FULL : Infinity;
    const length = Math.min(room, total(i) * pace * SLOW);
    const unit = total(i) ? length / total(i) : 0;
    let at = l.time;
    const words = weights[i].map(({ text, weight }) => {
      const from = at;
      at += weight * unit;
      return { text, from, to: at };
    });
    return { text: l.text, time: l.time, end: at, words };
  });
}

// The last one that has started; -1: none.
export function sungAt(lines: SungLine[], time: number): number {
  let now = -1;
  while (now + 1 < lines.length && lines[now + 1].time <= time + 0.05) now++;
  return now;
}

// How much of it is sung, 0 to 1.
export const filled = ({ from, to }: { from: number; to: number }, time: number): number =>
  (to > from ? Math.min(1, Math.max(0, (time - from) / (to - from))) : time >= to ? 1 : 0);
