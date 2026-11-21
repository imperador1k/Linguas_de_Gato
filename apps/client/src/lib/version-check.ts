import { useEffect, useState } from 'react';

/*
 * Stale-version detection. A production build stamps its id into the bundle
 * (`__APP_BUILD_ID__`) and writes the same id to `/version.json`. When the tab
 * comes back into view (at most every few minutes, never on a timer) the
 * client fetches that small file; a different id means a newer build is being
 * served. A failed lazy chunk load (`vite:preloadError`) means the same thing.
 * Nothing reloads automatically: the learner decides when.
 */

export const CHECK_INTERVAL_MS = 5 * 60_000;
const DEV_BUILD = 'dev';

declare const __APP_BUILD_ID__: string;

export function currentBuildId(): string {
  return typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : DEV_BUILD;
}

/** Throttle: the first check runs once the interval has passed since load or the last check. */
export function shouldCheck(lastCheckedAt: number, now: number, interval = CHECK_INTERVAL_MS): boolean {
  return now - lastCheckedAt >= interval;
}

/** True only for a well-formed version file naming a different build. Anything malformed is ignored. */
export function isNewerBuild(current: string, payload: unknown): boolean {
  if (current === DEV_BUILD || typeof payload !== 'object' || payload === null) return false;
  const buildId = (payload as { buildId?: unknown }).buildId;
  return typeof buildId === 'string' && buildId.length > 0 && buildId.length <= 100 && buildId !== current;
}

async function fetchVersion(): Promise<unknown> {
  const response = await fetch('/version.json', { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json();
}

/** Whether a newer build than the running one is available. */
export function useNewVersionAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const current = currentBuildId();
    // A lazy chunk that no longer exists on the server is the clearest sign of a new deployment, also in dev.
    const onPreloadError = () => setAvailable(true);
    window.addEventListener('vite:preloadError', onPreloadError);
    if (current === DEV_BUILD) return () => window.removeEventListener('vite:preloadError', onPreloadError);

    let lastCheckedAt = Date.now();
    let checking = false;
    const check = () => {
      if (document.visibilityState !== 'visible' || checking || !shouldCheck(lastCheckedAt, Date.now())) return;
      checking = true;
      lastCheckedAt = Date.now();
      fetchVersion()
        .then((payload) => {
          if (isNewerBuild(current, payload)) setAvailable(true);
        })
        // Offline or the server is restarting: try again on a later visit.
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('vite:preloadError', onPreloadError);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  return available;
}
