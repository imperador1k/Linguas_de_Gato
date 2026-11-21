import {
  BACKUP_STORES,
  recommendationStateSchema,
  trainingSessionSchema,
  type LearningSnapshot,
  type RecommendationState,
  type TrainingSession,
  type WritingDraft,
  type WritingTaskRecord,
} from '@ldg/shared';
import { STORES } from '@/lib/storage/app-database';
import { createFeatureStorage } from '@/lib/storage/feature-storage';
import { parseStoredRecord, requestToPromise, StorageError } from '@/lib/storage/indexed-db';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/**
 * The Personal Learning Engine stores only the learner's decisions. Every
 * metric and insight is derived from the module stores on demand.
 */
export interface LearningRepository {
  readonly recommendations: KeyedStore<RecommendationState>;
  readonly training: KeyedStore<TrainingSession>;
  /** Everything the analytics need, read in one consistent transaction. Null in memory mode. */
  loadSnapshot(): Promise<LearningData | null>;
}

export interface LearningData {
  readonly snapshot: LearningSnapshot;
  readonly recommendationStates: RecommendationState[];
  readonly trainingSessions: TrainingSession[];
  /** For Today's "continue" list: unfinished drafts and the tasks they belong to. */
  readonly writingDrafts: WritingDraft[];
  readonly writingTasks: WritingTaskRecord[];
  /** Records skipped because they failed validation (outdated or corrupt): reported, never guessed at. */
  readonly unreadable: number;
}

const recommendationDefinition = { name: STORES.recommendationStates, schema: recommendationStateSchema, label: 'recommendation decision', key: 'id' } as const;
const trainingDefinition = { name: STORES.trainingSessions, schema: trainingSessionSchema, label: 'training log', key: 'id' } as const;

const SNAPSHOT_STORES = {
  listeningSessions: 'sessions',
  dictation: 'dictation',
  listeningExerciseSets: 'listeningExercises',
  speakingAttempts: 'speakingAttempts',
  writingAttempts: 'writingAttempts',
  grammarSets: 'grammarSets',
  readingTexts: 'readingTexts',
  readingQuestionSets: 'readingQuestionSets',
  vocabularyEntries: 'vocabularyEntries',
  vocabularyPracticeSets: 'vocabularyPracticeSets',
} as const satisfies Record<keyof LearningSnapshot, keyof typeof BACKUP_STORES>;

export async function loadLearningData(database: IDBDatabase): Promise<LearningData> {
  const names = [...Object.values(SNAPSHOT_STORES), STORES.recommendationStates, STORES.trainingSessions, STORES.writingDrafts, STORES.writingTasks];
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(names, 'readonly');
  } catch (error) {
    throw new StorageError('blocked', undefined, { cause: error });
  }
  // All requests are issued synchronously in one transaction, so the snapshot is consistent.
  const requests = names.map((name) => requestToPromise(transaction.objectStore(name).getAll()));
  const rows = await Promise.all(requests);
  let unreadable = 0;
  const parse = <T,>(store: keyof typeof BACKUP_STORES, values: unknown[]): T[] =>
    values.flatMap((value) => {
      const parsed = parseStoredRecord(BACKUP_STORES[store].schema, value, BACKUP_STORES[store].label);
      if (parsed === null) unreadable += 1;
      return parsed === null ? [] : [parsed as T];
    });
  const entries = Object.entries(SNAPSHOT_STORES) as Array<[keyof LearningSnapshot, keyof typeof BACKUP_STORES]>;
  const snapshot = Object.fromEntries(entries.map(([field, store], index) => [field, parse(store, rows[index] ?? [])])) as unknown as LearningSnapshot;
  return {
    snapshot,
    recommendationStates: parse<RecommendationState>('recommendationStates', rows[entries.length] ?? []),
    trainingSessions: parse<TrainingSession>('trainingSessions', rows[entries.length + 1] ?? []),
    writingDrafts: parse<WritingDraft>('writingDrafts', rows[entries.length + 2] ?? []),
    writingTasks: parse<WritingTaskRecord>('writingTasks', rows[entries.length + 3] ?? []),
    unreadable,
  };
}

export function indexedDbLearningRepository(database: IDBDatabase): LearningRepository {
  return {
    recommendations: new IndexedDbKeyedStore(database, recommendationDefinition),
    training: new IndexedDbKeyedStore(database, trainingDefinition),
    loadSnapshot: () => loadLearningData(database),
  };
}

export function memoryLearningRepository(): LearningRepository {
  return { recommendations: new MemoryKeyedStore(recommendationDefinition), training: new MemoryKeyedStore(trainingDefinition), loadSnapshot: async () => null };
}

export const learningStorage = createFeatureStorage('Personal learning', indexedDbLearningRepository, memoryLearningRepository);
