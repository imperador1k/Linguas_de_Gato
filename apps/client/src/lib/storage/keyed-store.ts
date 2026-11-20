import type { ZodType, z } from 'zod';
import { StorageError, parseStoredRecord, requestToPromise, runInTransaction, transactionDone } from './indexed-db';

/**
 * A validated store of records with a single key, in IndexedDB or in memory.
 * Records are validated before every write (an invalid value never reaches
 * storage) and after every read (a corrupt or outdated record is skipped, not
 * fatal). Used by the Writing and Grammar repositories.
 */
export interface KeyedStore<T> {
  /** All valid records, in no particular order. */
  list(): Promise<T[]>;
  /** Valid records whose indexed field equals `value`. */
  listBy(index: string, value: IDBValidKey): Promise<T[]>;
  get(key: IDBValidKey): Promise<T | null>;
  put(value: T): Promise<void>;
  /** Read-modify-write in one transaction; null if the record doesn't exist. */
  update(key: IDBValidKey, change: (current: T) => T): Promise<T | null>;
  delete(key: IDBValidKey): Promise<void>;
}

export interface KeyedStoreDefinition<S extends ZodType> {
  readonly name: string;
  readonly schema: S;
  /** For console warnings about skipped records. */
  readonly label: string;
  /** The key path's field (must match the object store's keyPath). */
  readonly key: keyof z.infer<S> & string;
  /** Index name → field, for `listBy` (must match the object store's indexes). */
  readonly indexes?: Readonly<Record<string, keyof z.infer<S> & string>>;
}

export class IndexedDbKeyedStore<S extends ZodType> implements KeyedStore<z.infer<S>> {
  constructor(
    private readonly database: IDBDatabase,
    private readonly definition: KeyedStoreDefinition<S>,
  ) {}

  private transaction(mode: IDBTransactionMode): IDBTransaction {
    try {
      return this.database.transaction(this.definition.name, mode);
    } catch (error) {
      // InvalidStateError: the connection was closed (e.g. a newer tab upgraded the schema).
      throw new StorageError('blocked', undefined, { cause: error });
    }
  }

  private parseAll(rows: unknown[]): z.infer<S>[] {
    return rows.map((row) => parseStoredRecord(this.definition.schema, row, this.definition.label)).filter((row): row is z.infer<S> => row !== null);
  }

  async list(): Promise<z.infer<S>[]> {
    const transaction = this.transaction('readonly');
    return this.parseAll(await requestToPromise(transaction.objectStore(this.definition.name).getAll()));
  }

  async listBy(index: string, value: IDBValidKey): Promise<z.infer<S>[]> {
    const transaction = this.transaction('readonly');
    return this.parseAll(await requestToPromise(transaction.objectStore(this.definition.name).index(index).getAll(value)));
  }

  async get(key: IDBValidKey): Promise<z.infer<S> | null> {
    const transaction = this.transaction('readonly');
    return parseStoredRecord(this.definition.schema, await requestToPromise(transaction.objectStore(this.definition.name).get(key)), this.definition.label);
  }

  async put(value: z.infer<S>): Promise<void> {
    const row = this.definition.schema.parse(value);
    const transaction = this.transaction('readwrite');
    transaction.objectStore(this.definition.name).put(row);
    await transactionDone(transaction);
  }

  async update(key: IDBValidKey, change: (current: z.infer<S>) => z.infer<S>): Promise<z.infer<S> | null> {
    const transaction = this.transaction('readwrite');
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(this.definition.name);
      const current = parseStoredRecord(this.definition.schema, await requestToPromise(store.get(key)), this.definition.label);
      if (current === null) return null;
      const next = this.definition.schema.parse(change(current));
      store.put(next);
      return next;
    });
  }

  async delete(key: IDBValidKey): Promise<void> {
    const transaction = this.transaction('readwrite');
    transaction.objectStore(this.definition.name).delete(key);
    await transactionDone(transaction);
  }
}

/** Same contract, kept for the tab's lifetime. Values are cloned so callers can't mutate storage. */
export class MemoryKeyedStore<S extends ZodType> implements KeyedStore<z.infer<S>> {
  private readonly rows = new Map<string, z.infer<S>>();

  constructor(private readonly definition: KeyedStoreDefinition<S>) {}

  private keyOf(value: z.infer<S>): string {
    return JSON.stringify((value as Record<string, unknown>)[this.definition.key]);
  }

  async list(): Promise<z.infer<S>[]> {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  async listBy(index: string, value: IDBValidKey): Promise<z.infer<S>[]> {
    const field = this.definition.indexes?.[index];
    if (!field) throw new Error(`Unknown index ${index}`);
    return [...this.rows.values()].filter((row) => (row as Record<string, unknown>)[field] === value).map((row) => structuredClone(row));
  }

  async get(key: IDBValidKey): Promise<z.infer<S> | null> {
    const row = this.rows.get(JSON.stringify(key));
    return row === undefined ? null : structuredClone(row);
  }

  async put(value: z.infer<S>): Promise<void> {
    const row = this.definition.schema.parse(value);
    this.rows.set(this.keyOf(row), structuredClone(row));
  }

  async update(key: IDBValidKey, change: (current: z.infer<S>) => z.infer<S>): Promise<z.infer<S> | null> {
    const current = await this.get(key);
    if (current === null) return null;
    const next = this.definition.schema.parse(change(current));
    this.rows.set(JSON.stringify(key), structuredClone(next));
    return structuredClone(next);
  }

  async delete(key: IDBValidKey): Promise<void> {
    this.rows.delete(JSON.stringify(key));
  }
}
