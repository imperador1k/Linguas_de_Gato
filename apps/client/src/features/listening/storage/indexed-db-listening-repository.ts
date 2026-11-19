import {
  dictationRecordSchema,
  listeningSessionSchema,
  transcriptRecordSchema,
  type DictationRecord,
  type ListeningSession,
  type SubtitleCue,
  type TranscriptRecord,
} from '@ldg/shared';
import type { z } from 'zod';
import { openDatabase, requestToPromise, StorageError, transactionDone } from '@/lib/storage/indexed-db';
import { sortByLastOpened, withMediaStored, type ListeningRepository } from './listening-repository';

export const LISTENING_DB_NAME = 'linguas-de-gato';
export const LISTENING_DB_VERSION = 1;

/**
 * Stores (schema v1):
 * - sessions     keyPath id                    small metadata, listed often
 * - transcripts  keyPath sessionId             cue arrays, loaded per session
 * - media        keyPath sessionId             optional opt-in copy of a local file
 * - dictation    keyPath [sessionId, cueId]    attempts per transcript line
 *
 * Large payloads live outside `sessions` so listing stays cheap.
 */
const STORES = { sessions: 'sessions', transcripts: 'transcripts', media: 'media', dictation: 'dictation' } as const;
const ALL_STORES = Object.values(STORES);

interface MediaRecord {
  readonly sessionId: string;
  readonly blob: Blob;
}

function upgrade(database: IDBDatabase, oldVersion: number): void {
  // Each step migrates from the previous version; never edit a released step.
  if (oldVersion < 1) {
    database.createObjectStore(STORES.sessions, { keyPath: 'id' });
    database.createObjectStore(STORES.transcripts, { keyPath: 'sessionId' });
    database.createObjectStore(STORES.media, { keyPath: 'sessionId' });
    database.createObjectStore(STORES.dictation, { keyPath: ['sessionId', 'cueId'] });
  }
}

/** All dictation keys of one session: arrays sort after strings, so [id, []] bounds every cueId. */
function sessionDictationRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId], [sessionId, []]);
}

function parseOrNull<S extends z.ZodType>(schema: S, value: unknown, label: string): z.infer<S> | null {
  if (value === undefined) return null;
  const result = schema.safeParse(value);
  if (!result.success) {
    console.warn(`Skipping an unreadable ${label} record in browser storage.`, result.error.issues);
    return null;
  }
  return result.data;
}

/**
 * Runs `work` inside `transaction` and resolves once the transaction commits.
 * If `work` throws, the transaction is aborted so no partial write survives.
 */
async function runInTransaction<T>(transaction: IDBTransaction, work: () => Promise<T>): Promise<T> {
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

export class IndexedDbListeningRepository implements ListeningRepository {
  readonly persistent = true;

  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<IndexedDbListeningRepository> {
    const database = await openDatabase({ name: LISTENING_DB_NAME, version: LISTENING_DB_VERSION, upgrade, factory });
    return new IndexedDbListeningRepository(database);
  }

  close(): void {
    this.database.close();
  }

  private transaction(stores: string | string[], mode: IDBTransactionMode): IDBTransaction {
    try {
      return this.database.transaction(stores, mode);
    } catch (error) {
      // InvalidStateError: the connection was closed (e.g. a newer tab upgraded the schema).
      throw new StorageError('blocked', undefined, { cause: error });
    }
  }

  async listSessions(): Promise<ListeningSession[]> {
    const transaction = this.transaction(STORES.sessions, 'readonly');
    const rows = await requestToPromise(transaction.objectStore(STORES.sessions).getAll());
    const sessions = rows
      .map((row: unknown) => parseOrNull(listeningSessionSchema, row, 'session'))
      .filter((session): session is ListeningSession => session !== null);
    return sortByLastOpened(sessions);
  }

  async getSession(id: string): Promise<ListeningSession | null> {
    const transaction = this.transaction(STORES.sessions, 'readonly');
    const row: unknown = await requestToPromise(transaction.objectStore(STORES.sessions).get(id));
    return parseOrNull(listeningSessionSchema, row, 'session');
  }

  async createSession(session: ListeningSession): Promise<void> {
    const transaction = this.transaction(STORES.sessions, 'readwrite');
    transaction.objectStore(STORES.sessions).add(listeningSessionSchema.parse(session));
    await transactionDone(transaction);
  }

  async updateSession(
    id: string,
    update: (session: ListeningSession) => ListeningSession,
  ): Promise<ListeningSession | null> {
    const transaction = this.transaction(STORES.sessions, 'readwrite');
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(STORES.sessions);
      // Awaiting an IDB request keeps the transaction alive (microtask continuation).
      const current = parseOrNull(listeningSessionSchema, await requestToPromise(store.get(id)), 'session');
      if (!current) return null;
      const next = listeningSessionSchema.parse(update(current));
      store.put(next);
      return next;
    });
  }

  async deleteSession(id: string): Promise<void> {
    const transaction = this.transaction(ALL_STORES, 'readwrite');
    transaction.objectStore(STORES.sessions).delete(id);
    transaction.objectStore(STORES.transcripts).delete(id);
    transaction.objectStore(STORES.media).delete(id);
    transaction.objectStore(STORES.dictation).delete(sessionDictationRange(id));
    await transactionDone(transaction);
  }

  async getTranscript(sessionId: string): Promise<TranscriptRecord | null> {
    const transaction = this.transaction(STORES.transcripts, 'readonly');
    const row: unknown = await requestToPromise(transaction.objectStore(STORES.transcripts).get(sessionId));
    return parseOrNull(transcriptRecordSchema, row, 'transcript');
  }

  async replaceTranscript(session: ListeningSession, cues: readonly SubtitleCue[] | null): Promise<void> {
    const transaction = this.transaction([STORES.sessions, STORES.transcripts, STORES.dictation], 'readwrite');
    transaction.objectStore(STORES.sessions).put(listeningSessionSchema.parse(session));
    const transcripts = transaction.objectStore(STORES.transcripts);
    if (cues) {
      transcripts.put(transcriptRecordSchema.parse({ sessionId: session.id, cues }));
    } else {
      transcripts.delete(session.id);
    }
    transaction.objectStore(STORES.dictation).delete(sessionDictationRange(session.id));
    await transactionDone(transaction);
  }

  async getMedia(sessionId: string): Promise<Blob | null> {
    const transaction = this.transaction(STORES.media, 'readonly');
    const row = (await requestToPromise(transaction.objectStore(STORES.media).get(sessionId))) as MediaRecord | undefined;
    return row?.blob instanceof Blob ? row.blob : null;
  }

  async saveMedia(sessionId: string, media: Blob): Promise<ListeningSession | null> {
    return this.writeMediaFlag(sessionId, (store) => store.put({ sessionId, blob: media } satisfies MediaRecord), true);
  }

  async deleteMedia(sessionId: string): Promise<ListeningSession | null> {
    return this.writeMediaFlag(sessionId, (store) => store.delete(sessionId), false);
  }

  private async writeMediaFlag(
    sessionId: string,
    write: (store: IDBObjectStore) => void,
    mediaStored: boolean,
  ): Promise<ListeningSession | null> {
    const transaction = this.transaction([STORES.sessions, STORES.media], 'readwrite');
    return runInTransaction(transaction, async () => {
      const sessions = transaction.objectStore(STORES.sessions);
      const current = parseOrNull(listeningSessionSchema, await requestToPromise(sessions.get(sessionId)), 'session');
      if (!current) return null;
      write(transaction.objectStore(STORES.media));
      const next = withMediaStored(current, mediaStored, Date.now());
      sessions.put(next);
      return next;
    });
  }

  async listDictation(sessionId: string): Promise<DictationRecord[]> {
    const transaction = this.transaction(STORES.dictation, 'readonly');
    const rows = await requestToPromise(transaction.objectStore(STORES.dictation).getAll(sessionDictationRange(sessionId)));
    return rows
      .map((row: unknown) => parseOrNull(dictationRecordSchema, row, 'dictation'))
      .filter((record): record is DictationRecord => record !== null);
  }

  async putDictation(record: DictationRecord): Promise<void> {
    const transaction = this.transaction(STORES.dictation, 'readwrite');
    transaction.objectStore(STORES.dictation).put(dictationRecordSchema.parse(record));
    await transactionDone(transaction);
  }
}
