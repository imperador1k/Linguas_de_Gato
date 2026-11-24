import type { PersonalSenseInput } from '../contracts/vocabulary-personal.js';
import type { VocabularyEntry } from '../contracts/vocabulary.js';
import { addPersonalSense } from './vocabulary-personal.js';

/** Personal vocabulary fixtures shared by the V1 tests. */

export const V1_NOW = Date.UTC(2026, 10, 22, 12);
export const DAY_MS = 86_400_000;

export function personalInput(overrides: Partial<PersonalSenseInput> = {}): PersonalSenseInput {
  return { expression: 'eat', translations: ['comer'], partOfSpeech: 'verb', example: 'I usually eat breakfast at 8 AM.', alternatives: [], forms: ['eats', 'ate', 'eaten'], notes: '', ...overrides };
}

/** A personal entry with one or more meanings, ids "<id>" and "<id>-s<n>". */
export function personalEntry(id: string, ...inputs: Array<Partial<PersonalSenseInput>>): VocabularyEntry {
  let entry: VocabularyEntry | null = null;
  inputs.forEach((input, index) => {
    entry = addPersonalSense(entry, personalInput(input), V1_NOW, { entryId: id, senseId: `${id}-s${index + 1}` }).entry;
  });
  if (!entry) throw new Error('personalEntry needs at least one meaning');
  return entry;
}
