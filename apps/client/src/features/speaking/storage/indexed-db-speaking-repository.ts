import { customTopicSchema, speakingAttemptSchema, type CustomTopic, type SpeakingAttempt } from '@ldg/shared';
import { STORES, openAppDatabase } from '@/lib/storage/app-database';
import { parseStoredRecord, requestToPromise, runInTransaction, StorageError, toStorageError, transactionDone } from '@/lib/storage/indexed-db';
import {
  assertStorableRecording,
  recordingRepair,
  sortNewestFirst,
  withRecordingStored,
  type RecordingReconciliation,
  type SpeakingRepository,
} from './speaking-repository';

interface RecordingRecord {
  readonly attemptId: string;
  readonly blob: Blob;
}

export class IndexedDbSpeakingRepository implements SpeakingRepository {
  readonly persistent = true;

  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<IndexedDbSpeakingRepository> {
    return new IndexedDbSpeakingRepository(await openAppDatabase(factory));
  }

  close(): void {
    this.database.close();
  }

  private transaction(stores: string | string[], mode: IDBTransactionMode): IDBTransaction {
    try {
      return this.database.transaction(stores, mode);
    } catch (error) {
      throw new StorageError('blocked', undefined, { cause: error });
    }
  }

  async listAttempts(): Promise<SpeakingAttempt[]> {
    const transaction = this.transaction(STORES.speakingAttempts, 'readonly');
    const rows = await requestToPromise(transaction.objectStore(STORES.speakingAttempts).getAll());
    return sortNewestFirst(
      rows
        .map((row: unknown) => parseStoredRecord(speakingAttemptSchema, row, 'speaking attempt'))
        .filter((attempt): attempt is SpeakingAttempt => attempt !== null),
    );
  }

  async getAttempt(id: string): Promise<SpeakingAttempt | null> {
    const transaction = this.transaction(STORES.speakingAttempts, 'readonly');
    const row: unknown = await requestToPromise(transaction.objectStore(STORES.speakingAttempts).get(id));
    return parseStoredRecord(speakingAttemptSchema, row, 'speaking attempt');
  }

  async putAttempt(attempt: SpeakingAttempt, recording?: Blob): Promise<void> {
    if (recording) assertStorableRecording(recording);
    const row = speakingAttemptSchema.parse(recording ? withRecordingStored(attempt, true, attempt.updatedAt) : attempt);
    const stores = recording ? [STORES.speakingAttempts, STORES.speakingRecordings] : STORES.speakingAttempts;
    const transaction = this.transaction(stores, 'readwrite');
    try {
      transaction.objectStore(STORES.speakingAttempts).put(row);
      // Same transaction: a recording that doesn't fit leaves no half-saved attempt behind.
      if (recording) transaction.objectStore(STORES.speakingRecordings).put({ attemptId: attempt.id, blob: recording } satisfies RecordingRecord);
    } catch (error) {
      // A synchronous failure (e.g. a value that can't be cloned) would otherwise let the attempt commit alone.
      transaction.abort();
      throw toStorageError(error);
    }
    await transactionDone(transaction);
  }

  async reconcileRecording(attemptId: string): Promise<RecordingReconciliation | null> {
    const transaction = this.transaction([STORES.speakingAttempts, STORES.speakingRecordings], 'readwrite');
    return runInTransaction(transaction, async () => {
      const attempts = transaction.objectStore(STORES.speakingAttempts);
      const current = parseStoredRecord(speakingAttemptSchema, await requestToPromise(attempts.get(attemptId)), 'speaking attempt');
      if (!current) return null;
      const present = (await requestToPromise(transaction.objectStore(STORES.speakingRecordings).count(attemptId))) > 0;
      const repaired = recordingRepair(current, present);
      if (!repaired) return { attempt: current, present, repaired };
      const next = withRecordingStored(current, present, Date.now());
      attempts.put(next);
      return { attempt: next, present, repaired };
    });
  }

  async listRecordingKeys(): Promise<string[]> {
    const transaction = this.transaction(STORES.speakingRecordings, 'readonly');
    return (await requestToPromise(transaction.objectStore(STORES.speakingRecordings).getAllKeys())).map(String);
  }

  async updateAttempt(id: string, update: (attempt: SpeakingAttempt) => SpeakingAttempt): Promise<SpeakingAttempt | null> {
    const transaction = this.transaction(STORES.speakingAttempts, 'readwrite');
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(STORES.speakingAttempts);
      const current = parseStoredRecord(speakingAttemptSchema, await requestToPromise(store.get(id)), 'speaking attempt');
      if (!current) return null;
      const next = speakingAttemptSchema.parse(update(current));
      store.put(next);
      return next;
    });
  }

  async deleteAttempt(id: string): Promise<void> {
    const transaction = this.transaction([STORES.speakingAttempts, STORES.speakingRecordings], 'readwrite');
    transaction.objectStore(STORES.speakingAttempts).delete(id);
    transaction.objectStore(STORES.speakingRecordings).delete(id);
    await transactionDone(transaction);
  }

  async getRecording(attemptId: string): Promise<Blob | null> {
    const transaction = this.transaction(STORES.speakingRecordings, 'readonly');
    const row = (await requestToPromise(transaction.objectStore(STORES.speakingRecordings).get(attemptId))) as
      | RecordingRecord
      | undefined;
    return row?.blob instanceof Blob ? row.blob : null;
  }

  saveRecording(attemptId: string, recording: Blob): Promise<SpeakingAttempt | null> {
    assertStorableRecording(recording);
    return this.writeRecording(attemptId, (store) => store.put({ attemptId, blob: recording } satisfies RecordingRecord), true);
  }

  deleteRecording(attemptId: string): Promise<SpeakingAttempt | null> {
    return this.writeRecording(attemptId, (store) => store.delete(attemptId), false);
  }

  private writeRecording(attemptId: string, write: (store: IDBObjectStore) => void, stored: boolean): Promise<SpeakingAttempt | null> {
    const transaction = this.transaction([STORES.speakingAttempts, STORES.speakingRecordings], 'readwrite');
    return runInTransaction(transaction, async () => {
      const attempts = transaction.objectStore(STORES.speakingAttempts);
      const current = parseStoredRecord(speakingAttemptSchema, await requestToPromise(attempts.get(attemptId)), 'speaking attempt');
      if (!current) return null;
      write(transaction.objectStore(STORES.speakingRecordings));
      const next = withRecordingStored(current, stored, Date.now());
      attempts.put(next);
      return next;
    });
  }

  async listTopics(): Promise<CustomTopic[]> {
    const transaction = this.transaction(STORES.speakingTopics, 'readonly');
    const rows = await requestToPromise(transaction.objectStore(STORES.speakingTopics).getAll());
    return sortNewestFirst(
      rows
        .map((row: unknown) => parseStoredRecord(customTopicSchema, row, 'custom topic'))
        .filter((topic): topic is CustomTopic => topic !== null),
    );
  }

  async putTopic(topic: CustomTopic): Promise<void> {
    const row = customTopicSchema.parse(topic);
    const transaction = this.transaction(STORES.speakingTopics, 'readwrite');
    transaction.objectStore(STORES.speakingTopics).put(row);
    await transactionDone(transaction);
  }

  async deleteTopic(id: string): Promise<void> {
    const transaction = this.transaction(STORES.speakingTopics, 'readwrite');
    transaction.objectStore(STORES.speakingTopics).delete(id);
    await transactionDone(transaction);
  }
}
