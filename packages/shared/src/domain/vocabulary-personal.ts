import { PARTS_OF_SPEECH } from '../contracts/vocabulary-pack.js';
import type { PersonalSenseInput } from '../contracts/vocabulary-personal.js';
import { VOCABULARY_RECORD_VERSION, type ExpressionKind, type VocabularyEntry, type VocabularySense } from '../contracts/vocabulary.js';
import { normalizeTyped } from './vocabulary-answers.js';
import { initialReviewState, vocabularyKey } from './vocabulary.js';

/*
 * The learner's own vocabulary (V1): adding a word by hand, editing what a
 * saved sense accepts, and keeping meanings apart without duplicates.
 *
 * Identity: an entry per English expression (as before, keyed by its
 * dictionary form) holds one sense per meaning. A sense has its own id, its
 * own accepted answers and its own learning evidence, so "book" (noun,
 * "livro") and "book" (verb, "reservar") are two senses of one entry that
 * never share a learning state.
 */

export const MAX_SENSES_PER_ENTRY = 10;

/** Splits a typed list ("comer, almoçar; jantar") into distinct, trimmed items, keeping their order. */
export function parseAnswerList(text: string, max: number): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const value = raw.replace(/\s+/g, ' ').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    items.push(value.slice(0, 80));
    if (items.length >= max) break;
  }
  return items;
}

export function expressionKindFor(expression: string): ExpressionKind {
  return expression.trim().split(/\s+/).length > 1 ? 'expression' : 'word';
}

/**
 * The Portuguese translations a sense accepts. Library senses saved before V1
 * kept them only in `portugueseExplanation`, which was written as the pack's
 * translations joined with ", "; that is read back here.
 */
export function translationsOf(sense: Pick<VocabularySense, 'translations' | 'source' | 'portugueseExplanation'>): string[] {
  if (sense.translations) return sense.translations;
  if (sense.source.kind === 'library' && sense.portugueseExplanation) return parseAnswerList(sense.portugueseExplanation, 6);
  return [];
}

/** Translations compared for duplicates: case, accents, punctuation and a leading article do not matter. */
const translationKey = (value: string) =>
  normalizeTyped(value, 'pt')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/^(o|a|os|as|um|uma|uns|umas) /, '');

const compatiblePartOfSpeech = (a: string, b: string) => a === '' || b === '' || a.toLowerCase() === b.toLowerCase();

export type DuplicateCheck =
  | { readonly kind: 'new_entry' }
  /** The word is saved; this meaning is new and becomes another sense. */
  | { readonly kind: 'new_sense'; readonly entry: VocabularyEntry }
  /** The same meaning is already saved: same word, compatible part of speech, a shared translation. */
  | { readonly kind: 'duplicate'; readonly entry: VocabularyEntry; readonly sense: VocabularySense }
  | { readonly kind: 'full'; readonly entry: VocabularyEntry };

export function checkDuplicate(existing: VocabularyEntry | null, input: Pick<PersonalSenseInput, 'translations' | 'partOfSpeech'>, ignoreSenseId?: string): DuplicateCheck {
  if (!existing) return { kind: 'new_entry' };
  const wanted = new Set(input.translations.map(translationKey));
  const same = existing.senses.find(
    (sense) => sense.id !== ignoreSenseId && compatiblePartOfSpeech(sense.partOfSpeech, input.partOfSpeech) && translationsOf(sense).some((translation) => wanted.has(translationKey(translation))),
  );
  if (same) return { kind: 'duplicate', entry: existing, sense: same };
  if (existing.senses.length >= MAX_SENSES_PER_ENTRY) return { kind: 'full', entry: existing };
  return { kind: 'new_sense', entry: existing };
}

/** The personal answer fields of a sense, from the form. Empty notes are left out rather than stored. */
function personalFields(input: PersonalSenseInput): Pick<VocabularySense, 'translations' | 'alternatives' | 'forms'> & { notes?: string } {
  const lemma = input.expression.trim().toLowerCase();
  return {
    translations: input.translations,
    alternatives: input.alternatives.filter((value) => value.toLowerCase() !== lemma),
    forms: input.forms.filter((value) => value.toLowerCase() !== lemma),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

function meaningOf(input: PersonalSenseInput): string {
  return input.translations.join(', ').slice(0, 400);
}

export function senseFromInput(input: PersonalSenseInput, now: number, id: string): VocabularySense {
  return {
    id,
    contextualMeaning: meaningOf(input),
    dictionaryMeaning: meaningOf(input),
    partOfSpeech: input.partOfSpeech,
    context: input.example,
    source: { kind: 'manual' },
    examples: input.example ? [input.example] : [],
    collocations: [],
    synonyms: [],
    antonyms: [],
    register: 'neutral',
    patterns: [],
    cefrEstimate: null,
    portugueseExplanation: null,
    addedAt: now,
    ...personalFields(input),
  };
}

export type PersonalSaveOutcome = 'created' | 'added_sense' | 'already_saved' | 'full';

/**
 * Adds a word typed by the learner: a new expression creates an entry; a new
 * meaning of a saved expression becomes another sense; the same meaning
 * again changes nothing (and says which sense it is).
 */
export function addPersonalSense(
  existing: VocabularyEntry | null,
  input: PersonalSenseInput,
  now: number,
  ids: { readonly entryId: string; readonly senseId: string },
): { entry: VocabularyEntry; outcome: PersonalSaveOutcome; senseId: string } {
  const check = checkDuplicate(existing, input);
  if (check.kind === 'duplicate') return { entry: check.entry, outcome: 'already_saved', senseId: check.sense.id };
  if (check.kind === 'full') return { entry: check.entry, outcome: 'full', senseId: '' };
  const sense = senseFromInput(input, now, ids.senseId);
  if (check.kind === 'new_sense') {
    const entry = check.entry;
    // Same rule as Reading saves: a new meaning brings the expression back to the self-rated review.
    return { outcome: 'added_sense', senseId: sense.id, entry: { ...entry, senses: [...entry.senses, sense], review: { ...entry.review, dueAt: Math.min(entry.review.dueAt, now) }, updatedAt: now } };
  }
  const expression = input.expression.trim();
  return {
    outcome: 'created',
    senseId: sense.id,
    entry: {
      id: ids.entryId,
      version: VOCABULARY_RECORD_VERSION,
      language: 'en',
      expression,
      lemma: expression,
      key: vocabularyKey(expression),
      kind: expressionKindFor(expression),
      senses: [sense],
      review: initialReviewState(now),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** The values the edit form starts from. */
export function inputFromSense(entry: VocabularyEntry, sense: VocabularySense): PersonalSenseInput {
  return {
    expression: entry.lemma,
    translations: translationsOf(sense),
    // Reading lookups write free text ("phrasal verb"); only a known value fills the select.
    partOfSpeech: PARTS_OF_SPEECH.find((value) => value === sense.partOfSpeech.toLowerCase()) ?? '',
    example: sense.source.kind === 'manual' ? sense.context : '',
    alternatives: sense.alternatives ?? (sense.source.kind === 'library' ? sense.synonyms : []),
    forms: sense.forms ?? [],
    notes: sense.notes ?? '',
  };
}

/** Whether saving the edit changes the expression's dictionary form (and so its collection key). */
export function changesExpression(entry: VocabularyEntry, input: Pick<PersonalSenseInput, 'expression'>): boolean {
  return vocabularyKey(input.expression) !== entry.key;
}

/**
 * Applies the edit form to one sense. A sense the learner added by hand takes
 * every field; a sense saved from Reading or the library keeps its original
 * sentence, meanings and provenance, and takes the answer data (translations,
 * accepted alternatives, forms), its part of speech and notes. Learning
 * evidence is kept: it is still the same meaning. A changed English word
 * updates the entry's dictionary form; the caller checks that no other entry
 * already uses it.
 */
export function editPersonalSense(entry: VocabularyEntry, senseId: string, input: PersonalSenseInput, now: number): VocabularyEntry {
  const senses = entry.senses.map((sense) => {
    if (sense.id !== senseId) return sense;
    const { notes: _notes, ...rest } = sense;
    const fields = personalFields(input);
    if (sense.source.kind === 'manual') {
      return { ...rest, contextualMeaning: meaningOf(input), dictionaryMeaning: meaningOf(input), partOfSpeech: input.partOfSpeech, context: input.example, examples: input.example ? [input.example] : [], ...fields };
    }
    return { ...rest, partOfSpeech: input.partOfSpeech || sense.partOfSpeech, ...fields };
  });
  const expression = input.expression.trim();
  if (!changesExpression(entry, input)) return { ...entry, senses, updatedAt: now };
  // The text as met in Reading ("took off") stays when only the dictionary form ("take off") changes.
  const keepsWrittenForm = vocabularyKey(entry.expression) !== entry.key;
  return { ...entry, senses, lemma: expression, key: vocabularyKey(expression), expression: keepsWrittenForm ? entry.expression : expression, kind: entry.kind === 'word' || entry.kind === 'expression' ? expressionKindFor(expression) : entry.kind, updatedAt: now };
}
