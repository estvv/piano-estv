import { useEffect, useRef, useState } from 'react';
import { ensureAudio, tick } from '../audio';
import { useNoteInput } from '../input/hooks';
import type { Played } from './score';

const COUNT_IN = 4;
const MIN_HELD = 0.04;

export interface Take {
  played: Played[];
  // First beat, with the metronome; null without.
  start: number | null;
}

// Keys played, with their times. With the metronome: four clicks first.
export function useRecorder({ bpm, metronome, onStart, onDone }: {
  bpm: number;
  metronome: boolean;
  // The first beat: what is already written may play along.
  onStart(): void;
  onDone(take: Take): void;
}) {
  // Counting in (clicks left), recording, or neither.
  const [state, setState] = useState<{ phase: 'count'; left: number } | { phase: 'on' } | null>(null);
  const take = useRef<{ played: Played[]; down: Map<number, number>; start: number | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ onStart, onDone });
  latest.current = { onStart, onDone };
  useEffect(() => () => clearTimeout(timer.current), []);

  useNoteInput((e) => {
    const t = take.current;
    if (!t || e.source === 'mic') return;
    const now = e.time / 1000;
    if (e.type === 'on') t.down.set(e.midi, now);
    else {
      const on = t.down.get(e.midi);
      t.down.delete(e.midi);
      if (on !== undefined) t.played.push({ midi: e.midi, on, off: Math.max(on + MIN_HELD, now) });
    }
  });

  const start = async () => {
    await ensureAudio().catch(() => {});
    if (!metronome) {
      take.current = { played: [], down: new Map(), start: null };
      setState({ phase: 'on' });
      return;
    }
    const beat = 60 / bpm;
    const zero = performance.now() / 1000 + 0.15;
    // A key pressed a hair before the first beat belongs to it.
    take.current = { played: [], down: new Map(), start: zero + COUNT_IN * beat };
    let n = 0;
    const next = () => {
      const i = n++;
      tick(i % 4 === 0);
      if (i < COUNT_IN) setState({ phase: 'count', left: COUNT_IN - i });
      else if (i === COUNT_IN) {
        setState({ phase: 'on' });
        latest.current.onStart();
      }
      timer.current = setTimeout(next, Math.max(0, (zero + n * beat) * 1000 - performance.now()));
    };
    timer.current = setTimeout(next, zero * 1000 - performance.now());
  };

  const stop = () => {
    clearTimeout(timer.current);
    const t = take.current;
    take.current = null;
    setState(null);
    if (!t) return;
    const now = performance.now() / 1000;
    const played = [...t.played, ...[...t.down].map(([midi, on]) => ({ midi, on, off: Math.max(on + MIN_HELD, now) }))];
    const from = t.start === null ? -Infinity : t.start - 30 / bpm;
    latest.current.onDone({ played: played.filter((k) => k.on >= from), start: t.start });
  };

  return { state, start, stop };
}
