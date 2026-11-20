import {
  writingAttemptSchema,
  writingDraftSchema,
  writingTaskRecordSchema,
  type WritingAttempt,
  type WritingDraft,
  type WritingTaskRecord,
} from '@ldg/shared';
import { STORES, WRITING_ATTEMPTS_BY_TASK } from '@/lib/storage/app-database';
import { createFeatureStorage } from '@/lib/storage/feature-storage';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/**
 * Writing persistence:
 * - tasks     saved writing tasks (generated, possibly edited)
 * - drafts    one working draft per task, keyed by task id (autosaved)
 * - attempts  submitted texts with their task snapshot, assessment and optional improved version
 */
export interface WritingRepository {
  readonly tasks: KeyedStore<WritingTaskRecord>;
  readonly drafts: KeyedStore<WritingDraft>;
  readonly attempts: KeyedStore<WritingAttempt>;
}

const definitions = {
  tasks: { name: STORES.writingTasks, schema: writingTaskRecordSchema, label: 'writing task', key: 'id' } as const,
  drafts: { name: STORES.writingDrafts, schema: writingDraftSchema, label: 'writing draft', key: 'taskId' } as const,
  attempts: {
    name: STORES.writingAttempts,
    schema: writingAttemptSchema,
    label: 'writing attempt',
    key: 'id',
    indexes: { [WRITING_ATTEMPTS_BY_TASK]: 'taskId' },
  } as const,
};

export function indexedDbWritingRepository(database: IDBDatabase): WritingRepository {
  return {
    tasks: new IndexedDbKeyedStore(database, definitions.tasks),
    drafts: new IndexedDbKeyedStore(database, definitions.drafts),
    attempts: new IndexedDbKeyedStore(database, definitions.attempts),
  };
}

export function memoryWritingRepository(): WritingRepository {
  return {
    tasks: new MemoryKeyedStore(definitions.tasks),
    drafts: new MemoryKeyedStore(definitions.drafts),
    attempts: new MemoryKeyedStore(definitions.attempts),
  };
}

export const writingStorage = createFeatureStorage('Writing', indexedDbWritingRepository, memoryWritingRepository);

export const newestFirst = <T extends { updatedAt: number }>(rows: T[]): T[] => rows.sort((a, b) => b.updatedAt - a.updatedAt);

/**
 * Deletes a task and its draft. Submitted attempts are kept: each carries a
 * snapshot of its task, and they are the learner's history.
 */
export async function deleteWritingTask(repository: WritingRepository, taskId: string): Promise<void> {
  await repository.drafts.delete(taskId);
  await repository.tasks.delete(taskId);
}
