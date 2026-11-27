import { useEffect } from 'react';
import { piecesApi } from './api';
import type { PiecePlayer } from './player';

// Counts the time a piece plays, and sends it every minute, when it stops, and
// when the page is left.
const EVERY = 60; // seconds
// Not worth sending.
const SHORT = 2;

export function usePracticeClock(player: PiecePlayer, piece: number) {
  useEffect(() => {
    let since: number | null = null;
    let kept = 0;
    const count = () => {
      if (since !== null) {
        const now = performance.now();
        kept += (now - since) / 1000;
        since = player.state.get().playing ? now : null;
      }
    };
    const send = (leaving = false) => {
      count();
      // A tab left open while playing for hours is not practice: no more than that.
      const seconds = Math.min(600, kept);
      if (seconds < SHORT) return;
      kept = 0;
      void piecesApi.addTime(piece, seconds, leaving).catch(() => {});
    };
    const onState = () => {
      const { playing } = player.state.get();
      if (playing && since === null) since = performance.now();
      if (!playing && since !== null) send();
    };
    onState();
    const unsubscribe = player.state.subscribe(onState);
    const timer = setInterval(() => {
      count();
      if (kept >= EVERY) send();
    }, 5000);
    const onLeave = () => send(true);
    window.addEventListener('pagehide', onLeave);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('pagehide', onLeave);
      send(true);
    };
  }, [player, piece]);
}
