// A take: the piece, or the parts looped, played through in wait mode. Each chord
// counts: right the first time or not, and how long it took to find.

export interface ChordResult {
  // Wrong keys before it was right.
  wrong: number;
  // Seconds from when the piece stopped on it to when it was played.
  waited: number;
  // Where it is in the piece (seconds), what it is, and the wrong keys played.
  at?: number;
  notes?: { midi: number; hand: 'left' | 'right' | null }[];
  keys?: number[];
}

export type TakeEvent =
  | { kind: 'chord'; result: ChordResult }
  // Played through to its end: the piece, or the loop that starts again.
  | { kind: 'end' }
  // Somewhere else, other notes, another mode: what was played does not count.
  | { kind: 'jump' };

// Up to this, a chord is found at once (seconds); from there to the end, less
// and less.
const AT_ONCE = 0.35;
const SLOW = 2.5;
// Of its points, a chord keeps this much when found late, and that much with one
// or several wrong keys.
const LATE = 0.4;
const ONE_WRONG = 0.6;
const MORE_WRONG = 0.3;
// Points for one star, two, three.
export const STARS = [60, 80, 95];

export function chordPoints({ wrong, waited }: ChordResult): number {
  const right = wrong === 0 ? 1 : wrong === 1 ? ONE_WRONG : MORE_WRONG;
  const late = Math.min(1, Math.max(0, waited - AT_ONCE) / (SLOW - AT_ONCE));
  return right * (1 - LATE * late);
}

export interface Take {
  score: number; // 0..100
  stars: number; // 0..3
  chords: number;
  // Right the first time.
  clean: number;
  wrong: number;
  // Chord by chord, for the coach.
  results: ChordResult[];
}

export function takeOf(results: readonly ChordResult[]): Take {
  const score = results.length ? Math.round((100 * results.reduce((s, r) => s + chordPoints(r), 0)) / results.length) : 0;
  return {
    score,
    stars: STARS.filter((s) => score >= s).length,
    chords: results.length,
    clean: results.filter((r) => r.wrong === 0).length,
    wrong: results.reduce((s, r) => s + r.wrong, 0),
    results: [...results],
  };
}

// Chords played since the start of a take. A take started in the middle, or
// that missed too much of it, does not count.
export class TakeTracker {
  private results: ChordResult[] = [];
  private whole = false;

  // `total`: chords in what is played through.
  constructor(private total: () => number) {}

  // From its start: the piece or the loop starts now.
  begin() {
    this.results = [];
    this.whole = true;
  }

  feed(e: TakeEvent): Take | null {
    if (e.kind === 'chord') {
      this.results.push(e.result);
      return null;
    }
    const results = this.results;
    const counted = this.whole && results.length >= Math.max(1, this.total() * 0.9);
    this.results = [];
    // After the end, the loop starts again from its start.
    this.whole = e.kind === 'end';
    return counted ? takeOf(results) : null;
  }
}
