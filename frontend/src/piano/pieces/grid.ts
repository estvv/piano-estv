import type { PieceNote } from '@piano/shared';

// Where the beats of a piece fall. Scores and most MIDI files follow their
// tempo to the letter; a recorded or transcribed performance drifts around a
// tempo its file does not even know, so its beats are followed one by one.

export const BEATS_PER_BAR = 4;
// Notes starting this close together form one chord (as in the player).
export const CHORD_WINDOW = 0.04;

// Onsets agreeing this much with a constant tempo follow it.
const STEADY = 0.6;
// Beat tracking works on 10 ms frames.
const FRAME = 0.01;
// How much a beat longer or shorter than the tempo costs.
const TIGHTNESS = 70;

export class BeatGrid {
  // Times of the beats, in seconds, at least two, rising.
  readonly beats: number[];

  constructor(beats: number[]) {
    this.beats = beats;
  }

  static regular(origin: number, beat: number) {
    return new BeatGrid([origin, origin + beat]);
  }

  // Seconds to beats since the first one; steady before and after the beats known.
  toBeats(time: number): number {
    const b = this.beats;
    let lo = 0;
    let hi = b.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo + (time - b[lo]) / (b[lo + 1] - b[lo]);
  }

  toTime(beats: number): number {
    const b = this.beats;
    const i = Math.min(b.length - 2, Math.max(0, Math.floor(beats)));
    return b[i] + (beats - i) * (b[i + 1] - b[i]);
  }
}

// Null when there is too little to find a beat in.
export function beatGrid(notes: PieceNote[], bpm: number | null): BeatGrid | null {
  if (!notes.length) return null;
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const onsets = onsetTimes(sorted);
  const beat = bpm ? 60 / bpm : estimateBeat(onsets);
  if (!beat) return null;
  // Too few notes to doubt the tempo.
  if (onsets.length < 16 || steadiness(onsets, beat) >= STEADY) return BeatGrid.regular(sorted[0].time, beat);
  return new BeatGrid(trackBeats(sorted));
}

// Chords count once.
function onsetTimes(sorted: PieceNote[]): number[] {
  const out: number[] = [];
  for (const n of sorted) if (!out.length || n.time - out[out.length - 1] > CHORD_WINDOW) out.push(n.time);
  return out;
}

// 0 to 1: how well times line up on a period.
function alignment(times: number[], period: number): number {
  let re = 0;
  let im = 0;
  for (const t of times) {
    const a = (2 * Math.PI * t) / period;
    re += Math.cos(a);
    im += Math.sin(a);
  }
  return Math.hypot(re, im) / times.length;
}

// Same for a beat: its halves, thirds and quarters will do.
const steadiness = (onsets: number[], beat: number) => Math.max(...[1, 2, 3, 4].map((d) => alignment(onsets, beat / d)));

// Pieces without a known tempo (audio): the beat period the onsets line up on
// best, nudged towards ~100 bpm to avoid picking half or double time.
export function estimateBeat(onsets: number[]): number | null {
  if (onsets.length < 8) return null;
  let best = 0;
  let bestScore = -1;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const period = 60 / bpm;
    const score = alignment(onsets, period) * Math.exp(-2 * Math.log2(bpm / 100) ** 2);
    if (score > bestScore) {
      bestScore = score;
      best = period;
    }
  }
  return best;
}

// Dynamic programming (Ellis, 2007): the chain of beats landing on the
// strongest onsets while staying close to the tempo.
function trackBeats(sorted: PieceNote[]): number[] {
  const first = sorted[0].time;
  const last = sorted[sorted.length - 1].time;
  const pad = 10;
  const size = Math.ceil((last - first) / FRAME) + 2 * pad + 1;
  const strength = new Float64Array(size);
  for (const n of sorted) {
    const at = (n.time - first) / FRAME + pad;
    for (let i = Math.max(0, Math.floor(at) - 8); i <= Math.min(size - 1, at + 8); i++) {
      // Bass notes tell the beat more than the melody does.
      strength[i] += (n.midi < 60 ? 1.3 : 1) * Math.exp(-0.5 * ((i - at) / 2.5) ** 2);
    }
  }
  // A chord counts more than a note, not six times more.
  for (let i = 0; i < size; i++) strength[i] = Math.sqrt(strength[i]);

  const period = tempoPeriod(strength);
  const score = new Float64Array(size);
  const from = new Int32Array(size).fill(-1);
  const lo = Math.round(period * 0.6);
  const hi = Math.round(period * 1.6);
  for (let i = 0; i < size; i++) {
    let best = 0;
    for (let gap = lo; gap <= hi && gap <= i; gap++) {
      const s = score[i - gap] - TIGHTNESS * Math.log(gap / period) ** 2;
      if (s > best) {
        best = s;
        from[i] = i - gap;
      }
    }
    score[i] = strength[i] + best;
  }
  let end = size - 1;
  for (let i = Math.max(0, size - hi); i < size; i++) if (score[i] > score[end]) end = i;
  const beats: number[] = [];
  for (let i = end; i >= 0; i = from[i]) beats.unshift(first + (i - pad) * FRAME);

  // The first bar starts on the first note, or on the beat just before it.
  const beat = period * FRAME;
  while (beats[0] > first + beat / 4) beats.unshift(beats[0] - beat);
  while (beats.length > 2 && beats[1] <= first + beat / 4) beats.shift();
  if (beats.length < 2) beats.push(beats[0] + beat);
  return beats;
}

// Frames between two beats: the delay at which the music best matches itself,
// nudged towards 120 bpm.
function tempoPeriod(strength: Float64Array): number {
  let best = 50;
  let bestScore = -1;
  for (let lag = 30; lag <= 100; lag++) {
    let sum = 0;
    for (let i = lag; i < strength.length; i++) sum += strength[i] * strength[i - lag];
    const score = sum * Math.exp(-0.5 * Math.log2(lag / 50) ** 2);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}
