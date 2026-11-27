import { useCallback, useSyncExternalStore } from 'react';

// Same conditions as the `phone` and `compact` variants of index.css, for the
// screens whose structure changes and not only their style.
// A phone, upright or on its side.
export const PHONE = '(width < 48rem) or (height < 32rem)';
// A phone on its side: hardly any height.
export const SHORT = '(height < 32rem)';
// No room for one full toolbar: phones and tablets.
export const COMPACT = '(width < 80rem) or (height < 32rem)';
// Fingers instead of a mouse.
export const TOUCH = '(hover: none)';

export function useMedia(query: string): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
