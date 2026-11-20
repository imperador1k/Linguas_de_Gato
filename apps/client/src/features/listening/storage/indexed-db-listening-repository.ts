import {
  dictationRecordSchema,
  listeningExerciseSetSchema,
  listeningSessionSchema,
  transcriptRecordSchema,
  type DictationRecord,
  type ListeningExerciseSet,
  type ListeningSession,
  type TranscriptRecord,
} from '@ldg/shared';
import {
  APP_DB_NAME,
  APP_DB_VERSION,
  STORES as APP_STORES,
  LISTENING_EXERCISES_BY_SESSION,
  openAppDatabase,
} from '@/lib/storage/app-database';
import {
  parseStoredRecord as parseOrNull,
  requestToPromise,
  runInTransaction,
  StorageError,
  transactionDone,
} from '@/lib/storage/indexed-db';
import {
  sortByLastOpened,
  sortSetsNewestFirst,
  toTranscriptRecord,
  withMediaStored,
  type ListeningRepository,
  type TranscriptContent,
} from './listening-repository';

/** The shared app database (see lib/storage/app-database.ts for versions and migrations). */
export const LISTENING_DB_NAME = APP_DB_NAME;
export const LISTENING_DB_VERSION = APP_DB_VERSION;

/**
 * Listening stores:
 * - sessions     keyPath id                    small metadata, listed often
 * - transcripts  keyPath sessionId             cues (+ provider segments/words since M2), loaded per session
 * - media        keyPath sessionId             optional opt-in copy of a local file
 * - dictation    keyPath [sessionId, cueId]    attempts per transcript line
 * - listeningExercises keyPath id, index bySession   AI-generated question sets and answers (v3)
 *
 * Large payloads live outside `sessions` so listing stays cheap.
 */
const STORES = {
  sessions: APP_STORES.sessions,
  transcripts: APP_STORES.transcripts,
  media: APP_STORES.media,
  dictation: APP_STORES.dictation,
  exercises: APP_STORES.listeningExercises,
} as const;
const ALL_STORES = Object.values(STORES);

interface MediaRecord {
  readonly sessionId: string;
  readonly blob: Blob;
}

/** All dictation keys of one session: arrays sort after strings, so [id, []] bounds every cueId. */
function sessionDictationRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId], [sessionId, []]);
}

export class IndexedDbListeningRepository implements ListeningRepository {
  readonly persistent = true;

  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<IndexedDbListeningRepository> {
    return new IndexedDbListeningRepository(await openAppDatabase(factory));
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

  async createSession(session: ListeningSession, transcript?: TranscriptContent): Promise<void> {
    // Validate everything before opening the transaction, so a bad value never half-writes.
    const sessionRow = listeningSessionSchema.parse(session);
    const transcriptRow = transcript ? transcriptRecordSchema.parse(toTranscriptRecord(session.id, transcript)) : null;
    const transaction = this.transaction([STORES.sessions, STORES.transcripts], 'readwrite');
    transaction.objectStore(STORES.sessions).add(sessionRow);
    if (transcriptRow) transaction.objectStore(STORES.transcripts).put(transcriptRow);
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
    const exercises = transaction.objectStore(STORES.exercises);
    const keys = exercises.index(LISTENING_EXERCISES_BY_SESSION).getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) exercises.delete(key);
    };
    await transactionDone(transaction);
  }

  async getTranscript(sessionId: string): Promise<TranscriptRecord | null> {
    const transaction = this.transaction(STORES.transcripts, 'readonly');
    const row: unknown = await requestToPromise(transaction.objectStore(STORES.transcripts).get(sessionId));
    return parseOrNull(transcriptRecordSchema, row, 'transcript');
  }

  async replaceTranscript(session: ListeningSession, transcript: TranscriptContent | null): Promise<void> {
    const sessionRow = listeningSessionSchema.parse(session);
    const transcriptRow = transcript ? transcriptRecordSchema.parse(toTranscriptRecord(session.id, transcript)) : null;
    const transaction = this.transaction([STORES.sessions, STORES.transcripts, STORES.dictation], 'readwrite');
    transaction.objectStore(STORES.sessions).put(sessionRow);
    const transcripts = transaction.objectStore(STORES.transcripts);
    if (transcriptRow) {
      transcripts.put(transcriptRow);
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

  async listExerciseSets(sessionId: string): Promise<ListeningExerciseSet[]> {
    const transaction = this.transaction(STORES.exercises, 'readonly');
    const rows = await requestToPromise(
      transaction.objectStore(STORES.exercises).index(LISTENING_EXERCISES_BY_SESSION).getAll(sessionId),
    );
    return sortSetsNewestFirst(
      rows
        .map((row: unknown) => parseOrNull(listeningExerciseSetSchema, row, 'listening exercise set'))
        .filter((set): set is ListeningExerciseSet => set !== null),
    );
  }

  async getExerciseSet(id: string): Promise<ListeningExerciseSet | null> {
    const transaction = this.transaction(STORES.exercises, 'readonly');
    const row: unknown = await requestToPromise(transaction.objectStore(STORES.exercises).get(id));
    return parseOrNull(listeningExerciseSetSchema, row, 'listening exercise set');
  }

  async putExerciseSet(set: ListeningExerciseSet): Promise<void> {
    const row = listeningExerciseSetSchema.parse(set);
    const transaction = this.transaction(STORES.exercises, 'readwrite');
    transaction.objectStore(STORES.exercises).put(row);
    await transactionDone(transaction);
  }

  async deleteExerciseSet(id: string): Promise<void> {
    const transaction = this.transaction(STORES.exercises, 'readwrite');
    transaction.objectStore(STORES.exercises).delete(id);
    await transactionDone(transaction);
  }
}
