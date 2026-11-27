import type { PieceNote } from '@piano/shared';
import { beatGrid, BEATS_PER_BAR, type BeatGrid } from './grid';

// Splits a piece into practice sections from its notes alone, whatever it was
// imported from: cut into bars, find the passages that come back, cut there,
// and give the same letter to sections that sound the same (A B A C…).

export interface Section {
  start: number; // seconds
  end: number;
  label: string;
}

// Time signatures are not stored: bars are assumed to hold four beats.
// Bars sharing this much of their notes (pitch + position) count as the same.
const SIMILAR = 0.6;
// A repeat must last this many bars to cut the piece around it.
const MIN_REPEAT = 4;
const MIN_SECTION = 2;
const MAX_SECTION = 8;
// Long sections are cut in chunks of about this many bars.
const CHUNK = 4;

export function detectSections(notes: PieceNote[], bpm: number | null, grid: BeatGrid | null = beatGrid(notes, bpm)): Section[] {
  if (notes.length === 0 || !grid) return [];
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const duration = sorted.reduce((end, n) => Math.max(end, n.time + n.duration), 0);

  // Each bar as a set of "pitch@sixteenth"; rounding to the sixteenth absorbs
  // the timing jitter of live recordings and transcriptions.
  const bars: Set<string>[] = [];
  for (const n of sorted) {
    const sixteenth = Math.max(0, Math.round(grid.toBeats(n.time) * 4));
    const index = Math.floor(sixteenth / (BEATS_PER_BAR * 4));
    while (bars.length <= index) bars.push(new Set());
    bars[index].add(`${n.midi}@${sixteenth % (BEATS_PER_BAR * 4)}`);
  }
  const count = bars.length;
  if (count < 2 * MIN_SECTION) return [];

  const cache = new Map<number, number>();
  const sim = (i: number, j: number) => {
    const key = i * count + j;
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = jaccard(bars[i], bars[j])));
    return v;
  };

  // Repeats: runs of similar bars along each lag. One differing bar inside a
  // run (another ending, a variation) does not break it.
  const runs: { a: number; b: number; len: number }[] = [];
  for (let lag = MIN_REPEAT; lag < count; lag++) {
    let i = 0;
    while (i + lag < count) {
      if (sim(i, i + lag) < SIMILAR) { i++; continue; }
      let len = 1;
      while (i + len + lag < count) {
        if (sim(i + len, i + len + lag) >= SIMILAR) len++;
        else if (i + len + 1 + lag < count && sim(i + len + 1, i + len + 1 + lag) >= SIMILAR) len += 2;
        else break;
      }
      // Copies must not overlap (that is an ostinato, not a repeat). A copy
      // ending just short of the next one differs only by its ending (first /
      // second ending): it runs up to the next copy.
      if (len >= MIN_REPEAT) runs.push({ a: i, b: i + lag, len: lag - len < MIN_SECTION ? lag : Math.min(len, lag) });
      i += len;
    }
  }

  // Cut at both ends of both copies, longest repeats first; a cut too close to
  // an existing one is dropped.
  const cuts = [0, count];
  runs.sort((x, y) => y.len - x.len);
  for (const r of runs) {
    for (const c of [r.a, r.a + r.len, r.b, r.b + r.len]) {
      if (cuts.every((k) => Math.abs(k - c) >= MIN_SECTION)) cuts.push(c);
    }
  }
  cuts.sort((x, y) => x - y);

  const spans: [number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, len] = [cuts[i], cuts[i + 1] - cuts[i]];
    const parts = len > MAX_SECTION ? Math.round(len / CHUNK) : 1;
    const base = Math.floor(len / parts);
    const extra = len - base * parts; // the last chunks take one bar more
    let at = from;
    for (let p = 0; p < parts; p++) {
      const size = base + (p >= parts - extra ? 1 : 0);
      spans.push([at, at + size]);
      at += size;
    }
  }

  // Same length and similar bars: same letter.
  const labels: string[] = [];
  let next = 0;
  spans.forEach(([from, to], i) => {
    const same = spans.findIndex(([f, t], j) => {
      if (j >= i || t - f !== to - from) return false;
      let total = 0;
      for (let k = 0; k < to - from; k++) total += sim(f + k, from + k);
      return total / (to - from) >= SIMILAR;
    });
    labels.push(same >= 0 ? labels[same] : letter(next++));
  });

  return spans.map(([from, to], i) => ({
    start: i === 0 ? 0 : grid.toTime(from * BEATS_PER_BAR),
    end: i === spans.length - 1 ? duration : grid.toTime(to * BEATS_PER_BAR),
    label: labels[i],
  }));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common);
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`);
