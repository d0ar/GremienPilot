import { useCallback, useSyncExternalStore } from 'react';

// Environments without matchMedia (e.g. jsdom) are treated as "no match".
function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

/** Tracks whether a CSS media query currently matches. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = getMediaQueryList(query);
    if (!list) return () => {};
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    // Older Safari only supports the deprecated listener API.
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);
  const getSnapshot = () => getMediaQueryList(query)?.matches ?? false;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
