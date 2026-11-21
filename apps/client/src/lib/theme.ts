import { useEffect, useSyncExternalStore } from 'react';

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

/*
 * One shared store, so every theme control (sidebar, Settings → Appearance)
 * shows the same choice. Other tabs are followed through the storage event.
 */
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ThemePreference {
  current ??= readPreference();
  return current;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    current = readPreference();
    applyPreference(current);
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setThemePreference(next: ThemePreference): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-critical: the choice still applies for this session.
  }
  applyPreference(next);
  emit();
}

export function useTheme(): { preference: ThemePreference; setPreference: (next: ThemePreference) => void } {
  const preference = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as const);

  useEffect(() => {
    applyPreference(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyPreference('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  return { preference, setPreference: setThemePreference };
}
