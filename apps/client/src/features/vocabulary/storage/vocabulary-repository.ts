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
import { StorageError, parseStoredRecord, requestToPromise, runInTransaction } from '@/lib/storage/indexed-db';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/**
 * Vocabulary persistence:
 * - entries       one per expression (keyed by lemma), with senses and review state
 * - practiceSets  generated practice with answers, AI reviews and history
 */
export interface VocabularyRepository {
  readonly entries: KeyedStore<VocabularyEntry>;
  readonly practiceSets: KeyedStore<VocabularyPracticeSet>;
  /**
   * Checks a trainer round atomically: writes the changed collection entries
   * and the checked set in one transaction, but only if the stored set is
   * still unchecked. Returns false (and writes nothing) when it was already
   * checked, e.g. by another tab, so a retried or doubled completion can never
   * apply the same review ratings twice.
   */
  commitRound(entries: readonly VocabularyEntry[], checkedSet: VocabularyPracticeSet): Promise<boolean>;
}

const definitions = {
  entries: { name: STORES.vocabularyEntries, schema: vocabularyEntrySchema, label: 'vocabulary entry', key: 'id', indexes: { [VOCABULARY_BY_KEY]: 'key' } } as const,
  practiceSets: { name: STORES.vocabularyPracticeSets, schema: vocabularyPracticeSetSchema, label: 'vocabulary practice set', key: 'id' } as const,
};

/** Validates everything before any write, so an invalid record can't leave a half-written round. */
function validateRound(entries: readonly VocabularyEntry[], checkedSet: VocabularyPracticeSet) {
  return { entryRows: entries.map((entry) => vocabularyEntrySchema.parse(entry)), setRow: vocabularyPracticeSetSchema.parse(checkedSet) };
}

export function indexedDbVocabularyRepository(database: IDBDatabase): VocabularyRepository {
  return {
    entries: new IndexedDbKeyedStore(database, definitions.entries),
    practiceSets: new IndexedDbKeyedStore(database, definitions.practiceSets),
    async commitRound(entries, checkedSet) {
      const { entryRows, setRow } = validateRound(entries, checkedSet);
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction([STORES.vocabularyEntries, STORES.vocabularyPracticeSets], 'readwrite');
      } catch (error) {
        // InvalidStateError: the connection was closed (e.g. a newer tab upgraded the schema).
        throw new StorageError('blocked', undefined, { cause: error });
      }
      return runInTransaction(transaction, async () => {
        const sets = transaction.objectStore(STORES.vocabularyPracticeSets);
        const stored = parseStoredRecord(vocabularyPracticeSetSchema, await requestToPromise(sets.get(setRow.id)), definitions.practiceSets.label);
        if (stored === null || stored.checkedAt !== null) return false;
        const store = transaction.objectStore(STORES.vocabularyEntries);
        for (const row of entryRows) store.put(row);
        sets.put(setRow);
        return true;
      });
    },
  };
}

export function memoryVocabularyRepository(): VocabularyRepository {
  const entries = new MemoryKeyedStore(definitions.entries);
  const practiceSets = new MemoryKeyedStore(definitions.practiceSets);
  return {
    entries,
    practiceSets,
    async commitRound(changed, checkedSet) {
      const { entryRows, setRow } = validateRound(changed, checkedSet);
      const stored = await practiceSets.get(setRow.id);
      if (stored === null || stored.checkedAt !== null) return false;
      // Already validated, and memory writes don't fail midway.
      for (const row of entryRows) await entries.put(row);
      await practiceSets.put(setRow);
      return true;
    },
  };
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
