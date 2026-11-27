import { useEffect } from 'react';

// Keeps the screen on while `active` (music playing, hands on a real piano).
// The browser drops the lock when the page is hidden: asked again on return.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let over = false;
    const ask = async () => {
      if (document.hidden) return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (over) void got.release();
        else lock = got;
      } catch {
        // Refused (low battery…): the screen just turns off as usual.
      }
    };
    void ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      over = true;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release();
    };
  }, [active]);
}
