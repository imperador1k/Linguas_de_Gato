import {
  saveLookup,
  vocabularyEntrySchema,
  vocabularyKey,
  vocabularyPracticeSetSchema,
  type ModelVocabularyLookup,
  type SaveOutcome,
  type VocabularyEntry,
  type VocabularyPracticeSet,
  type VocabularySource,
} from '@ldg/shared';
import { STORES, VOCABULARY_BY_KEY } from '@/lib/storage/app-database';
import { createFeatureStorage } from '@/lib/storage/feature-storage';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/**
 * Vocabulary persistence:
 * - entries       one per expression (keyed by lemma), with senses and review state
 * - practiceSets  generated practice with answers, AI reviews and history
 */
export interface VocabularyRepository {
  readonly entries: KeyedStore<VocabularyEntry>;
  readonly practiceSets: KeyedStore<VocabularyPracticeSet>;
}

const definitions = {
  entries: { name: STORES.vocabularyEntries, schema: vocabularyEntrySchema, label: 'vocabulary entry', key: 'id', indexes: { [VOCABULARY_BY_KEY]: 'key' } } as const,
  practiceSets: { name: STORES.vocabularyPracticeSets, schema: vocabularyPracticeSetSchema, label: 'vocabulary practice set', key: 'id' } as const,
};

export function indexedDbVocabularyRepository(database: IDBDatabase): VocabularyRepository {
  return { entries: new IndexedDbKeyedStore(database, definitions.entries), practiceSets: new IndexedDbKeyedStore(database, definitions.practiceSets) };
}

export function memoryVocabularyRepository(): VocabularyRepository {
  return { entries: new MemoryKeyedStore(definitions.entries), practiceSets: new MemoryKeyedStore(definitions.practiceSets) };
}

export const vocabularyStorage = createFeatureStorage('Vocabulary', indexedDbVocabularyRepository, memoryVocabularyRepository);

/** Saves a lookup into the collection, merging with an existing entry for the same expression. */
export async function saveToCollection(
  repository: VocabularyRepository,
  lookup: ModelVocabularyLookup,
  context: { readonly sentence: string; readonly source: VocabularySource },
  now = Date.now(),
): Promise<{ entry: VocabularyEntry; outcome: SaveOutcome }> {
  const [existing] = await repository.entries.listBy(VOCABULARY_BY_KEY, vocabularyKey(lookup.lemma));
  const result = saveLookup(existing ?? null, lookup, context, now, { entryId: crypto.randomUUID(), senseId: crypto.randomUUID() });
  if (result.outcome !== 'already_saved') await repository.entries.put(result.entry);
  return result;
}

export async function findEntry(repository: VocabularyRepository, lemmaOrExpression: string): Promise<VocabularyEntry | null> {
  const [entry] = await repository.entries.listBy(VOCABULARY_BY_KEY, vocabularyKey(lemmaOrExpression));
  return entry ?? null;
}
