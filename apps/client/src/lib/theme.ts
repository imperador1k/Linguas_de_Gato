import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Keep in sync with public/theme-init.js. */
const STORAGE_KEY = 'ldg:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage may be blocked; fall back to the system preference.
  }
  return 'system';
}

function applyPreference(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme(): { preference: ThemePreference; setPreference: (next: ThemePreference) => void } {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    applyPreference(preference);
    if (preference !== 'system') return;

    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyPreference('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-critical: the choice still applies for this session.
    }
  }, []);

  return { preference, setPreference };
}
