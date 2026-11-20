import type { ZodType, z } from 'zod';

/**
 * Minimal promise helpers over the native IndexedDB API. We deliberately avoid
 * a wrapper library: the surface we need is small, and owning it lets us map
 * browser failures (private mode, quota, blocked upgrades) to clear errors.
 */

export type StorageErrorKind = 'unavailable' | 'quota' | 'blocked' | 'version' | 'unknown';

const MESSAGES: Readonly<Record<StorageErrorKind, string>> = {
  unavailable: "This browser isn't letting the app save data (private browsing or blocked site data).",
  quota: 'Browser storage is full. Delete old sessions or saved media copies to free space.',
  blocked: 'Storage is being upgraded. Close other Linguas de Gato tabs, then reload this one.',
  version: 'Your saved data was created by a newer version of the app. Reload to update.',
  unknown: 'Saving to browser storage failed.',
};

export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string = MESSAGES[kind], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.kind = kind;
  }
}

function errorName(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') return error.name;
  return undefined;
}

export function isQuotaError(error: unknown): boolean {
  const name = errorName(error);
  // Firefox historically used its own name for the same condition.
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaError(error)) return new StorageError('quota', undefined, { cause: error });
  switch (errorName(error)) {
    case 'VersionError':
      return new StorageError('version', undefined, { cause: error });
    case 'SecurityError':
    case 'InvalidAccessError':
      return new StorageError('unavailable', undefined, { cause: error });
    default:
      return new StorageError('unknown', undefined, { cause: error });
  }
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toStorageError(request.error));
  });
}

/** Resolves when the transaction commits; rejects if it errors or aborts (e.g. quota). */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(toStorageError(transaction.error));
    transaction.onabort = () => reject(toStorageError(transaction.error ?? new DOMException('Aborted', 'AbortError')));
  });
}

/**
 * Runs `work` inside `transaction` and resolves once the transaction commits.
 * If `work` throws, the transaction is aborted so no partial write survives.
 */
export async function runInTransaction<T>(transaction: IDBTransaction, work: () => Promise<T>): Promise<T> {
  const done = transactionDone(transaction);
  let result: T;
  try {
    result = await work();
  } catch (error) {
    done.catch(() => undefined);
    try {
      transaction.abort();
    } catch {
      // Already finished; nothing to roll back.
    }
    throw error;
  }
  await done;
  return result;
}

/** Validates a stored record; a corrupt or outdated one is skipped (null) instead of crashing the UI. */
export function parseStoredRecord<S extends ZodType>(schema: S, value: unknown, label: string): z.infer<S> | null {
  if (value === undefined) return null;
  const result = schema.safeParse(value);
  if (!result.success) {
    console.warn(`Skipping an unreadable ${label} record in browser storage.`, result.error.issues);
    return null;
  }
  return result.data;
}

export interface OpenDatabaseOptions {
  readonly name: string;
  readonly version: number;
  /** Runs inside the version-change transaction. Migrate step by step from `oldVersion`. */
  readonly upgrade: (database: IDBDatabase, oldVersion: number, transaction: IDBTransaction) => void;
  readonly factory?: IDBFactory | undefined;
}

export function openDatabase({ name, version, upgrade, factory }: OpenDatabaseOptions): Promise<IDBDatabase> {
  const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!idb) return Promise.reject(new StorageError('unavailable'));

  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(name, version);
    } catch (error) {
      // Some browsers throw synchronously when storage is disabled.
      reject(new StorageError('unavailable', undefined, { cause: error }));
      return;
    }

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (transaction) upgrade(request.result, event.oldVersion, transaction);
    };
    request.onblocked = () => {
      settled = true;
      reject(new StorageError('blocked'));
    };
    request.onerror = () => {
      settled = true;
      reject(toStorageError(request.error));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        // We already reported "blocked"; don't leak a connection nobody uses.
        database.close();
        return;
      }
      // Let another tab running a newer version upgrade the schema.
      database.onversionchange = () => database.close();
      settled = true;
      resolve(database);
    };
  });
}
