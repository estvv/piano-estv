import { useEffect, useRef } from 'react';
import type { PiecePlayer } from './player';

// What the phone shows on the lock screen and in its notifications: the piece,
// and buttons that drive it.
export function useMediaSession(player: PiecePlayer, about: { title: string; artist: string | null; cover: string | null }, nav: { next(): void; previous(): void }) {
  const session = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
  const { title, artist, cover } = about;
  useEffect(() => {
    if (!session || typeof MediaMetadata === 'undefined') return;
    session.metadata = new MediaMetadata({ title, artist: artist ?? '', artwork: cover ? [{ src: cover, sizes: '250x250' }] : [] });
  }, [session, title, artist, cover]);

  const latest = useRef(nav);
  latest.current = nav;
  useEffect(() => {
    if (!session) return;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void player.play()],
      ['pause', () => player.pause()],
      ['nexttrack', () => latest.current.next()],
      ['previoustrack', () => latest.current.previous()],
      ['seekto', (d) => d.seekTime !== undefined && player.seek(d.seekTime)],
      ['seekbackward', (d) => player.seek(player.position - (d.seekOffset ?? 10))],
      ['seekforward', (d) => player.seek(player.position + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not known to this browser.
      }
    }
    const show = () => {
      const { playing } = player.state.get();
      session.playbackState = playing ? 'playing' : 'paused';
      if (player.duration > 0 && 'setPositionState' in session) {
        try {
          session.setPositionState({ duration: player.duration, playbackRate: player.rate, position: Math.min(player.duration, Math.max(0, player.position)) });
        } catch {
          // Out of range for a moment.
        }
      }
    };
    show();
    const unsubscribe = player.state.subscribe(show);
    const timer = setInterval(show, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Same.
        }
      }
      session.playbackState = 'none';
    };
  }, [session, player]);
}
