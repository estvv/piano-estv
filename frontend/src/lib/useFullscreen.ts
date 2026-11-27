import { useCallback, useEffect, useState } from 'react';

// The whole screen when the browser lets it (not on iPhones), else the whole
// page. Escape leaves it.
export function useFullscreen() {
  const [full, setFull] = useState(false);
  const enter = useCallback(() => {
    setFull(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  const exit = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!full) return;
    // Left from the browser.
    const onChange = () => !document.fullscreenElement && setFull(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      exit();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [full, exit]);
  // Another page.
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  return { full, enter, exit };
}
