import { useCallback, useState } from 'react';

/**
 * Reading preferences are a per-device convenience (not learning data), so
 * they live in localStorage and fall back to defaults when it is unavailable.
 */
export interface ReadingPreferences {
  readonly size: 'small' | 'medium' | 'large' | 'xlarge';
  readonly spacing: 'compact' | 'comfortable' | 'airy';
  readonly width: 'narrow' | 'medium' | 'wide';
  readonly font: 'serif' | 'sans';
}

export const DEFAULT_PREFERENCES: ReadingPreferences = { size: 'medium', spacing: 'comfortable', width: 'medium', font: 'serif' };

const KEY = 'ldg.reading.preferences';
const VALUES = {
  size: ['small', 'medium', 'large', 'xlarge'],
  spacing: ['compact', 'comfortable', 'airy'],
  width: ['narrow', 'medium', 'wide'],
  font: ['serif', 'sans'],
} as const;

function load(): ReadingPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const pick = <K extends keyof ReadingPreferences>(key: K): ReadingPreferences[K] =>
      (VALUES[key] as readonly string[]).includes(String(raw[key])) ? (raw[key] as ReadingPreferences[K]) : DEFAULT_PREFERENCES[key];
    return { size: pick('size'), spacing: pick('spacing'), width: pick('width'), font: pick('font') };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function useReadingPreferences() {
  const [preferences, setPreferences] = useState<ReadingPreferences>(load);
  const update = useCallback(<K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode or blocked storage: keep the choice for this page only.
      }
      return next;
    });
  }, []);
  return { preferences, update };
}

export const SIZE_CLASSES = { small: 'text-[1rem]', medium: 'text-[1.125rem]', large: 'text-[1.25rem]', xlarge: 'text-[1.4rem]' } as const;
export const SPACING_CLASSES = { compact: 'leading-[1.6]', comfortable: 'leading-[1.8]', airy: 'leading-[2]' } as const;
export const WIDTH_CLASSES = { narrow: 'max-w-[34rem]', medium: 'max-w-[40rem]', wide: 'max-w-[48rem]' } as const;

const EXPLANATION_KEY = 'ldg.vocabulary.explanation';

/** English by default; Portuguese explanations are an opt-in addition. */
export function useExplanationLanguage() {
  const [language, setLanguage] = useState<'en' | 'pt'>(() => {
    try {
      return localStorage.getItem(EXPLANATION_KEY) === 'pt' ? 'pt' : 'en';
    } catch {
      return 'en';
    }
  });
  const update = useCallback((value: 'en' | 'pt') => {
    setLanguage(value);
    try {
      localStorage.setItem(EXPLANATION_KEY, value);
    } catch {
      // Keep the choice for this page only.
    }
  }, []);
  return [language, update] as const;
}
