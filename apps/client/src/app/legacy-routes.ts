/**
 * Backwards compatibility for URLs from before M7.1. Progress sections used a
 * query parameter (`/progress?section=errors`); they are now paths, and data
 * management moved to Settings. Old bookmarks and links keep working.
 */

export const PROGRESS_SECTIONS = ['skills', 'mistakes', 'recommendations', 'training'] as const;
export type ProgressSection = 'overview' | (typeof PROGRESS_SECTIONS)[number];

export const SETTINGS_SECTIONS = ['appearance', 'learning', 'privacy', 'data', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const LEGACY_PROGRESS: Readonly<Record<string, string>> = {
  overview: '/progress',
  skills: '/progress/skills',
  errors: '/progress/mistakes',
  recommendations: '/progress/recommendations',
  training: '/progress/training',
  data: '/settings/data',
};

/** The new location for a legacy `/progress?section=…` URL, or null when nothing needs to change. */
export function legacyProgressTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  const section = params.get('section');
  if (section === null) return null;
  const target = LEGACY_PROGRESS[section] ?? '/progress';
  // Keep the other parameters (e.g. the training category).
  params.delete('section');
  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}

export function isProgressSection(value: string | undefined): value is (typeof PROGRESS_SECTIONS)[number] {
  return (PROGRESS_SECTIONS as readonly string[]).includes(value ?? '');
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? '');
}
