import { grammarSetRecordSchema, type GrammarSetRecord } from '@ldg/shared';
import { STORES } from '@/lib/storage/app-database';
import { createFeatureStorage } from '@/lib/storage/feature-storage';
import { IndexedDbKeyedStore, MemoryKeyedStore, type KeyedStore } from '@/lib/storage/keyed-store';

/** Grammar persistence: generated sets with the current answers, second opinions and the history of checked rounds. */
export interface GrammarRepository {
  readonly sets: KeyedStore<GrammarSetRecord>;
}

const definition = { name: STORES.grammarSets, schema: grammarSetRecordSchema, label: 'grammar set', key: 'id' } as const;

export function indexedDbGrammarRepository(database: IDBDatabase): GrammarRepository {
  return { sets: new IndexedDbKeyedStore(database, definition) };
}

export function memoryGrammarRepository(): GrammarRepository {
  return { sets: new MemoryKeyedStore(definition) };
}

export const grammarStorage = createFeatureStorage('Grammar', indexedDbGrammarRepository, memoryGrammarRepository);
