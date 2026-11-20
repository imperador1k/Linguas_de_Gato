import { useEffect, useState } from 'react';
import { openAppDatabase } from './app-database';
import { StorageError, toStorageError } from './indexed-db';

export interface FeatureStorage<R> {
  readonly repository: R;
  /** False for the in-memory fallback. */
  readonly persistent: boolean;
  /** Why we fell back to memory, when we did. */
  readonly fallbackReason: StorageError | null;
}

/**
 * Opens the app database once per page for a feature and degrades to an
 * in-memory repository (data lasts until the tab closes) instead of failing.
 */
export function createFeatureStorage<R>(label: string, fromDatabase: (database: IDBDatabase) => R, inMemory: () => R) {
  let promise: Promise<FeatureStorage<R>> | null = null;

  function get(): Promise<FeatureStorage<R>> {
    promise ??= openAppDatabase().then(
      (database): FeatureStorage<R> => ({ repository: fromDatabase(database), persistent: true, fallbackReason: null }),
      (error: unknown): FeatureStorage<R> => {
        console.warn(`IndexedDB unavailable, keeping ${label} data in memory.`, error);
        return { repository: inMemory(), persistent: false, fallbackReason: toStorageError(error) };
      },
    );
    return promise;
  }

  function use(): FeatureStorage<R> | null {
    const [storage, setStorage] = useState<FeatureStorage<R> | null>(null);
    useEffect(() => {
      let active = true;
      void get().then((value) => active && setStorage(value));
      return () => {
        active = false;
      };
    }, []);
    return storage;
  }

  return { get, use };
}

export function describeStorageFailure(error: unknown): string {
  return toStorageError(error).message;
}
