import { readingQuestionSetSchema, readingTextRecordSchema, type ReadingQuestionSet, type ReadingTextRecord } from '@ldg/shared';
import { READING_QUESTIONS_BY_TEXT, STORES } from '@/lib/storage/app-database';
import { createFeatureStorage } from '@/lib/storage/feature-storage';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/**
 * Reading persistence:
 * - texts         generated or imported texts with reading progress
 * - questionSets  comprehension sets per text, with answers
 */
export interface ReadingRepository {
  readonly texts: KeyedStore<ReadingTextRecord>;
  readonly questionSets: KeyedStore<ReadingQuestionSet>;
}

const definitions = {
  texts: { name: STORES.readingTexts, schema: readingTextRecordSchema, label: 'reading text', key: 'id' } as const,
  questionSets: { name: STORES.readingQuestionSets, schema: readingQuestionSetSchema, label: 'reading question set', key: 'id', indexes: { [READING_QUESTIONS_BY_TEXT]: 'textId' } } as const,
};

export function indexedDbReadingRepository(database: IDBDatabase): ReadingRepository {
  return { texts: new IndexedDbKeyedStore(database, definitions.texts), questionSets: new IndexedDbKeyedStore(database, definitions.questionSets) };
}

export function memoryReadingRepository(): ReadingRepository {
  return { texts: new MemoryKeyedStore(definitions.texts), questionSets: new MemoryKeyedStore(definitions.questionSets) };
}

export const readingStorage = createFeatureStorage('Reading', indexedDbReadingRepository, memoryReadingRepository);

export async function listQuestionSets(repository: ReadingRepository, textId: string): Promise<ReadingQuestionSet[]> {
  return (await repository.questionSets.listBy(READING_QUESTIONS_BY_TEXT, textId)).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Deletes a text and its comprehension sets. Saved vocabulary is kept: each
 * sense stores its own context sentence and the text's title.
 */
export async function deleteReadingText(repository: ReadingRepository, textId: string): Promise<void> {
  for (const set of await repository.questionSets.listBy(READING_QUESTIONS_BY_TEXT, textId)) await repository.questionSets.delete(set.id);
  await repository.texts.delete(textId);
}
