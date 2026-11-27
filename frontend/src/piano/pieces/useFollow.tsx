import { useCallback, useEffect, useRef, useState } from 'react';

// A view that keeps what is played in sight, until the user scrolls it: it then
// stays where they put it, the piece going on, until they recentre it.

// A scroll this soon after a wheel, touch or key of theirs is theirs (ms);
// momentum goes on after the finger is lifted.
const INTENT = 1500;
// The longest a smooth scroll of ours takes (ms).
const OURS = 900;
const MARKS = ['wheel', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'keydown'] as const;

export interface Follow<T extends HTMLElement> {
  // To put on the scrolled element.
  ref(el: T | null): void;
  el: T | null;
  // Scrolled by hand: not followed any more.
  free: boolean;
  // Scrolling of ours, not taken for the user's.
  scrollTo(options: ScrollToOptions): void;
  recentre(): void;
}

export function useFollow<T extends HTMLElement>(): Follow<T> {
  const [el, setEl] = useState<T | null>(null);
  const [free, setFree] = useState(false);
  const intent = useRef(-Infinity);
  const ours = useRef(-Infinity);

  useEffect(() => {
    if (!el) return;
    const mark = () => {
      intent.current = performance.now();
    };
    const onScroll = () => {
      const now = performance.now();
      if (now < ours.current) return;
      if (now - intent.current < INTENT) setFree(true);
    };
    const settled = () => {
      ours.current = -Infinity;
    };
    for (const type of MARKS) el.addEventListener(type, mark, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settled);
    return () => {
      for (const type of MARKS) el.removeEventListener(type, mark);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settled);
    };
  }, [el]);

  const scrollTo = useCallback((options: ScrollToOptions) => {
    if (!el) return;
    ours.current = performance.now() + OURS;
    el.scrollTo(options);
  }, [el]);
  const recentre = useCallback(() => {
    intent.current = -Infinity;
    setFree(false);
  }, []);
  return { ref: setEl, el, free, scrollTo, recentre };
}

// Shown while the view is free, over it.
export function RecentreButton({ free, onClick, className = 'bottom-3 left-1/2 -translate-x-1/2' }: { free: boolean; onClick(): void; className?: string }) {
  if (!free) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Revenir à ce qui est joué, et le suivre"
      className={`absolute z-20 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-neutral-700 ${className}`}
    >
      Recentrer
    </button>
  );
}
