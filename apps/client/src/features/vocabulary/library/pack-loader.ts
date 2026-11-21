import { vocabularyPackIndexSchema, vocabularyPackSchema, type VocabularyPack, type VocabularyPackIndex, type VocabularyPackSummary } from '@ldg/shared';
import { useEffect, useState } from 'react';

/**
 * Static vocabulary packs are files served with the app (`public/content/
 * vocabulary/`), not part of the JavaScript bundle: the small catalogue is
 * fetched when the Library opens, and each pack only when it is chosen.
 * Both are validated before use; a broken pack is reported, never half-used.
 * They are plain static files, so no request ever reaches `/api/`.
 */

export const CONTENT_ROOT = '/content/vocabulary';

export class PackLoadError extends Error {
  override readonly name = 'PackLoadError';
}

let indexPromise: Promise<VocabularyPackIndex> | null = null;
const packPromises = new Map<string, Promise<VocabularyPack>>();

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' } });
  } catch {
    throw new PackLoadError("The vocabulary library couldn't be loaded. Check your connection to the app, then try again.");
  }
  if (!response.ok) throw new PackLoadError(`The vocabulary library couldn't be loaded (${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new PackLoadError('The vocabulary file is not valid JSON.');
  }
}

export function loadPackIndex(): Promise<VocabularyPackIndex> {
  indexPromise ??= fetchJson(`${CONTENT_ROOT}/index.json`).then((raw) => {
    const parsed = vocabularyPackIndexSchema.safeParse(raw);
    if (!parsed.success) throw new PackLoadError('The vocabulary catalogue is damaged and was not used.');
    return parsed.data;
  });
  // A failure should not be cached forever: the next attempt retries.
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

export function loadPack(summary: VocabularyPackSummary): Promise<VocabularyPack> {
  const key = `${summary.id}@${summary.version}`;
  let promise = packPromises.get(key);
  if (!promise) {
    promise = fetchJson(`${CONTENT_ROOT}/${summary.path}`).then((raw) => {
      const parsed = vocabularyPackSchema.safeParse(raw);
      if (!parsed.success) throw new PackLoadError(`The pack “${summary.title}” failed validation and was not used.`);
      if (parsed.data.id !== summary.id || parsed.data.version !== summary.version) throw new PackLoadError(`The pack “${summary.title}” doesn't match the catalogue.`);
      return parsed.data;
    });
    packPromises.set(key, promise);
    promise.catch(() => packPromises.delete(key));
  }
  return promise;
}

export type LoadState<T> = { readonly status: 'loading' } | { readonly status: 'error'; readonly message: string } | { readonly status: 'ready'; readonly data: T };

function describe(error: unknown): string {
  return error instanceof PackLoadError ? error.message : "The vocabulary library couldn't be loaded.";
}

export function usePackIndex(enabled = true): LoadState<VocabularyPackIndex> & { retry: () => void } {
  const [state, setState] = useState<LoadState<VocabularyPackIndex>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ status: 'loading' });
    loadPackIndex().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) => active && setState({ status: 'error', message: describe(error) }),
    );
    return () => {
      active = false;
    };
  }, [enabled, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

export function usePack(summary: VocabularyPackSummary | null): LoadState<VocabularyPack> & { retry: () => void } {
  const [state, setState] = useState<LoadState<VocabularyPack>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!summary) return;
    let active = true;
    setState({ status: 'loading' });
    loadPack(summary).then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) => active && setState({ status: 'error', message: describe(error) }),
    );
    return () => {
      active = false;
    };
  }, [summary, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/** Finds a pack by id in the catalogue and loads it (used by the trainer page to rebuild retry rounds). */
export async function loadPackById(packId: string): Promise<VocabularyPack | null> {
  const index = await loadPackIndex();
  const summary = index.packs.find((pack) => pack.id === packId);
  return summary ? loadPack(summary) : null;
}
