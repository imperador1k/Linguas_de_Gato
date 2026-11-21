import { useSyncExternalStore } from 'react';

/** True while the media query matches; follows changes (window resizes, rotation). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The desktop layout breakpoint (Tailwind `lg`). */
export const DESKTOP_QUERY = '(min-width: 64rem)';
