import { useEffect, useState } from 'react';
import { ControlButton, controlIcon, PlayButton } from './PlayerControls';

// Seen when the mouse moves, the screen is touched, or the piece is stopped.
const SEEN = 2500; // ms

export function FullscreenControls({ playing, onToggle, onExit }: { playing: boolean; onToggle(): void; onExit(): void }) {
  const [moved, setMoved] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setMoved(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMoved(false), SEEN);
    };
    onMove();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    };
  }, []);
  const seen = moved || !playing;
  return (
    <div className={`absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-neutral-200 bg-white/90 p-1 shadow-sm transition-opacity focus-within:opacity-100 ${seen ? '' : 'pointer-events-none opacity-0'}`}>
      <PlayButton playing={playing} onClick={onToggle} />
      <ControlButton title="Quitter le plein écran (Échap)" onClick={onExit}><FullscreenIcon out /></ControlButton>
    </div>
  );
}

export const FullscreenIcon = ({ out }: { out?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={controlIcon} aria-hidden>
    <path d={out ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
  </svg>
);
