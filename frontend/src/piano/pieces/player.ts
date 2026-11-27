import type { Hand, PieceNote } from '@piano/shared';
import { Observable } from '../../lib/store';
import { ensureAudio, keepPlaying, playNote, releaseAll } from '../audio';
import { inputBus, type NoteEvent } from '../input/bus';
import { startBackgroundTimer } from './backgroundTimer';
import type { TakeEvent } from './takes';

export type PlayMode = 'listen' | 'wait';

// Notes starting within this window are played together (a chord).
const CHORD_WINDOW = 0.04;
// Loop bounds are bar lines; notes on them may land a hair early.
const LOOP_SLACK = 0.03;

export interface Loop {
  start: number;
  end: number;
}

interface Group {
  time: number;
  notes: PieceNote[];
}

export interface PlayerState {
  playing: boolean;
  // Wait mode: the notes the player must play before the piece goes on.
  expected: { midi: number; hand: Hand | null }[];
  // Notes of the expected chord already played.
  played: number[];
  // Last wrong note, cleared shortly after.
  wrong: number | null;
  finished: boolean;
}

// Plays a piece in sync with the screen. `position` is read every animation
// frame (falling notes) so it lives outside React; coarse state is observable.
export class PiecePlayer {
  notes: PieceNote[] = [];
  // Of the whole piece: turning tracks off does not change the timeline
  // (cutting the piece in the editor does).
  duration: number;
  // Nothing is played before: silence, or the notes of other tracks.
  start = 0;
  readonly state = new Observable<PlayerState>({ playing: false, expected: [], played: [], wrong: null, finished: false });
  position = 0;
  rate = 1;
  mode: PlayMode = 'listen';
  // Notes heard by the microphone: the right note at any octave, one note of the
  // chord is enough, and nothing heard counts as wrong (one note at a time, echoes).
  lenient = false;
  // Played over and over while set.
  loop: Loop | null = null;

  private groups: Group[] = [];
  private nextNote = 0; // listen mode: index of the next note to sound
  private nextGroup = 0; // wait mode: index of the next chord to wait for
  private waiting = false;
  private raf = 0;
  private lastFrame = 0;
  private starts = 0; // a pause while the sounds load cancels the start
  private stopTimer: (() => void) | null = null;
  private wrongTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: () => void;
  // Wait mode: when it stopped on the chord, and the wrong keys since.
  private arrived = 0;
  private wrongs: number[] = [];
  private watchers = new Set<(e: TakeEvent) => void>();
  private wrapping = false;

  constructor(notes: PieceNote[], duration?: number) {
    this.load(notes);
    this.duration = duration ?? this.notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0);
    this.unsubscribe = inputBus.subscribe((e) => this.onInput(e));
  }

  // Other notes (tracks turned on or off, corrections), same place in the piece.
  setNotes(notes: PieceNote[], duration = this.duration, start = 0) {
    this.load(notes);
    this.duration = duration;
    this.start = start;
    this.seek(this.position);
  }

  private load(notes: PieceNote[]) {
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.groups = [];
    for (const n of this.notes) {
      const last = this.groups[this.groups.length - 1];
      if (last && n.time - last.time <= CHORD_WINDOW) last.notes.push(n);
      else this.groups.push({ time: n.time, notes: [n] });
    }
  }

  dispose() {
    this.pause();
    this.unsubscribe();
    clearTimeout(this.wrongTimer);
  }

  async play() {
    const start = ++this.starts;
    await ensureAudio().catch(() => {});
    if (start !== this.starts) return;
    if (this.state.get().finished) this.seek(this.start);
    this.lastFrame = performance.now();
    this.state.set((s) => ({ ...s, playing: true }));
    keepPlaying(true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    // The music goes on while the tab is hidden.
    this.stopTimer ??= startBackgroundTimer(() => document.hidden && this.state.get().playing && this.step(performance.now()));
  }

  pause() {
    this.starts++;
    cancelAnimationFrame(this.raf);
    this.stopTimer?.();
    this.stopTimer = null;
    releaseAll();
    if (this.state.get().playing) keepPlaying(false);
    this.state.set((s) => ({ ...s, playing: false }));
  }

  toggle() {
    if (this.state.get().playing) this.pause();
    else void this.play();
  }

  // What is played in wait mode, chord after chord.
  watch(fn: (e: TakeEvent) => void): () => void {
    this.watchers.add(fn);
    return () => void this.watchers.delete(fn);
  }
  private tell(e: TakeEvent) {
    for (const fn of this.watchers) fn(e);
  }

  // Chords between two times.
  chordsBetween(start: number, end: number): number {
    return this.groups.filter((g) => g.time >= start - LOOP_SLACK && g.time < end - LOOP_SLACK).length;
  }

  seek(seconds: number) {
    if (!this.wrapping) this.tell({ kind: 'jump' });
    releaseAll();
    this.position = Math.max(this.start, Math.min(this.duration, seconds));
    this.nextNote = this.notes.findIndex((n) => n.time >= this.position);
    if (this.nextNote < 0) this.nextNote = this.notes.length;
    this.nextGroup = this.groups.findIndex((g) => g.time >= this.position - 1e-6);
    if (this.nextGroup < 0) this.nextGroup = this.groups.length;
    this.waiting = false;
    this.state.set((s) => ({ ...s, expected: [], played: [], finished: false }));
  }

  setLoop(loop: Loop | null) {
    this.loop = loop;
    if (loop) this.seek(Math.max(0, loop.start - LOOP_SLACK));
  }

  setMode(mode: PlayMode) {
    this.mode = mode;
    this.seek(this.position);
  }

  // Notes sounding at the current position (listen mode highlight).
  sounding(): PieceNote[] {
    const out: PieceNote[] = [];
    for (let i = Math.max(0, this.nextNote - 64); i < this.nextNote && i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time <= this.position && n.time + n.duration > this.position) out.push(n);
    }
    return out;
  }

  private tick = (now: number) => {
    if (this.step(now)) this.raf = requestAnimationFrame(this.tick);
  };

  // False at the end of the piece.
  private step(now: number): boolean {
    const dt = Math.min(0.1, Math.max(0, now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.waiting) {
      const next = this.position + dt * this.rate;
      if (this.loop && next >= this.loop.end - LOOP_SLACK) {
        if (this.mode === 'wait') this.tell({ kind: 'end' });
        this.wrapping = true;
        this.seek(Math.max(0, this.loop.start - LOOP_SLACK));
        this.wrapping = false;
      } else if (this.mode === 'wait') this.advanceWaiting(next);
      else this.advanceListening(next);
    }
    if (this.position >= this.duration + 0.5) {
      if (this.mode === 'wait') this.tell({ kind: 'end' });
      this.pause();
      this.state.set((s) => ({ ...s, finished: true }));
      return false;
    }
    return true;
  }

  private advanceListening(next: number) {
    while (this.nextNote < this.notes.length && this.notes[this.nextNote].time < next) {
      const n = this.notes[this.nextNote++];
      playNote(n.midi, n.duration / this.rate, n.velocity);
    }
    this.position = next;
  }

  private advanceWaiting(next: number) {
    const group = this.groups[this.nextGroup];
    if (group && group.time <= next) {
      // Stop on the chord until the player plays it.
      this.position = group.time;
      this.waiting = true;
      this.arrived = performance.now();
      this.wrongs = [];
      this.state.set((s) => ({ ...s, expected: unique(group.notes), played: [] }));
      return;
    }
    this.position = next;
  }

  private onInput(e: NoteEvent) {
    if (e.type !== 'on' || this.mode !== 'wait' || !this.waiting) return;
    const { expected, played } = this.state.get();
    if (this.lenient && e.source === 'mic') {
      if (expected.some((n) => matches(n.midi, e.midi))) this.done(expected.map((n) => n.midi));
      return;
    }
    if (!expected.some((n) => n.midi === e.midi)) {
      clearTimeout(this.wrongTimer);
      this.wrongs.push(e.midi);
      this.state.set((s) => ({ ...s, wrong: e.midi }));
      this.wrongTimer = setTimeout(() => this.state.set((s) => ({ ...s, wrong: null })), 400);
      return;
    }
    const nowPlayed = played.includes(e.midi) ? played : [...played, e.midi];
    if (nowPlayed.length >= expected.length) this.done(nowPlayed);
    else this.state.set((s) => ({ ...s, played: nowPlayed }));
  }

  // Chord complete: go on.
  private done(_played: number[]) {
    this.nextGroup++;
    this.waiting = false;
    const group = this.groups[this.nextGroup - 1];
    this.tell({ kind: 'chord', result: { wrong: this.wrongs.length, waited: (performance.now() - this.arrived) / 1000 / this.rate, at: group.time, notes: unique(group.notes), keys: this.wrongs } });
    this.state.set((s) => ({ ...s, expected: [], played: [] }));
  }
}

// The same note, an octave or two away: microphones often hear it so.
export const matches = (wanted: number, heard: number) => (wanted - heard) % 12 === 0 && Math.abs(wanted - heard) <= 24;

function unique(notes: PieceNote[]): { midi: number; hand: Hand | null }[] {
  const seen = new Map<number, Hand | null>();
  for (const n of notes) if (!seen.has(n.midi)) seen.set(n.midi, n.hand);
  return [...seen].map(([midi, hand]) => ({ midi, hand }));
}

// Keyboard range that fits the piece, whole octaves, at least two.
export function pieceRange(notes: PieceNote[]): [number, number] {
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  let from = Math.max(21, Math.floor(lo / 12) * 12);
  let to = Math.min(108, Math.ceil((hi + 1) / 12) * 12 - 1);
  while (to - from < 23) {
    if (from > 21) from -= 12;
    else to += 12;
  }
  return [Math.max(21, from), Math.min(108, to)];
}
