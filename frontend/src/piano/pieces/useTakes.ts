import type { PieceLevel } from '@piano/shared';
import { useEffect, useRef, useState } from 'react';
import { piecesApi, type Best } from './api';
import type { PiecePlayer } from './player';
import { TakeTracker, type Take } from './takes';

export interface Done extends Take {
  part: string;
  // Better than ever, and what was the best before.
  record: boolean;
  before: number | null;
  // The tempo it was played at, and the next one when a loop goes faster.
  rate: number;
  next: number | null;
}

// Takes of a piece in wait mode: scored as they end, kept on the account.
// `range`: what is played through, and its name ('' for the whole piece).
export function useTakes(player: PiecePlayer, piece: number, level: PieceLevel, range: { start: number; end: number; part: string }, faster: (score: number) => number | null = () => null) {
  const [bests, setBests] = useState<Best[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  // Kept once the card is gone, for the coach.
  const [last, setLast] = useState<Done | null>(null);
  useEffect(() => {
    let stale = false;
    setBests([]);
    piecesApi.takes(piece).then((b) => !stale && setBests(b), () => {});
    return () => {
      stale = true;
    };
  }, [piece]);

  const now = useRef({ range, level, bests });
  const after = useRef(faster);
  after.current = faster;
  now.current = { range, level, bests };
  useEffect(() => {
    const tracker = new TakeTracker(() => player.chordsBetween(now.current.range.start, now.current.range.end));
    const atStart = () => Math.abs(player.position - now.current.range.start) < 0.1;
    if (atStart()) tracker.begin();
    return player.watch((e) => {
      const take = tracker.feed(e);
      if (e.kind === 'jump') queueMicrotask(() => atStart() && tracker.begin());
      if (!take) return;
      const { part } = now.current.range;
      const before = now.current.bests.find((b) => b.level === now.current.level && b.part === part)?.best ?? null;
      const rate = player.rate;
      const ended = { ...take, part, before, record: before === null || take.score > before, rate, next: after.current(take.score) };
      setDone(ended);
      setLast(ended);
      piecesApi.addTake(piece, { level: now.current.level, part, score: take.score, chords: take.chords, wrong: take.wrong, rate })
        .then(setBests, () => {});
    });
  }, [player, piece]);

  // Shown a few seconds.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), 6000);
    return () => clearTimeout(id);
  }, [done]);

  return { bests, done, last, dismiss: () => setDone(null) };
}
