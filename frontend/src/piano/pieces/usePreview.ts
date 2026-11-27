import type { PieceNote } from '@piano/shared';
import { useEffect, useMemo, useState } from 'react';
import { useObservable } from '../../lib/store';
import { PiecePlayer } from './player';

// Listening to what is being written: from a point, to the end or over and over.
export function usePreview(notes: PieceNote[], duration: number) {
  const player = useMemo(() => new PiecePlayer([], 0), []);
  const { playing } = useObservable(player.state);
  const [, setFrame] = useState(0);
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => player.setNotes(notes, duration), [player, notes, duration]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setFrame((f) => f + 1), 50);
    return () => clearInterval(id);
  }, [playing]);
  return {
    player,
    playing,
    position: player.position,
    stop: () => player.pause(),
    play: (start: number, loop?: { start: number; end: number }) => {
      player.setLoop(loop ?? null);
      player.seek(start);
      void player.play();
    },
  };
}
