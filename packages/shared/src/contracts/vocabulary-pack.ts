import { z } from 'zod';
import { CEFR_LEVELS, languageCodeSchema } from '../domain/languages.js';
import { EXPRESSION_KINDS, VOCABULARY_REGISTERS } from './vocabulary.js';

/**
 * Static vocabulary packs (Vocabulary Trainer). A pack is versioned,
 * read-only reference content shipped with the app and loaded on demand; it
 * is never copied into the learner's database. What the learner does with it
 * (rounds, review schedule) lives in the existing vocabulary stores.
 *
 * Content model:
 * - An entry is one lemma in one part of speech ("book" the verb and "book"
 *   the noun are separate entries). Inflected forms are listed, never guessed.
 * - A sense is one meaning, with Portuguese (Portugal) translations, an
 *   English definition and context examples. Not every sense supports every
 *   exercise mode; the trainer only uses what is there.
 * - CEFR is optional metadata with a source and certainty; exercise
 *   difficulty is a separate, per-entry (and per-example) value.
 * - Provenance and licence are part of the pack, not an afterthought.
 */

export const VOCABULARY_PACK_FORMAT = 'linguas-de-gato-vocabulary-pack';
export const VOCABULARY_PACK_SCHEMA_VERSION = 1;
/** Marks the one place a word is missing in a context sentence. */
export const GAP_MARKER = '___';

export const PACK_LIMITS = {
  maxEntries: 50_000,
  maxSensesPerEntry: 8,
  maxContextsPerSense: 6,
  maxWordChars: 60,
  maxSentenceChars: 300,
  maxDefinitionChars: 300,
} as const;

/** Translation languages a pack may provide; extend as packs add them. */
export const TRANSLATION_LANGUAGES = ['pt-PT'] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'determiner', 'interjection', 'phrase'] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export const VOCABULARY_TOPICS = ['everyday', 'food', 'technology', 'travel', 'work', 'health', 'education', 'nature', 'home', 'emotions', 'money'] as const;
export type VocabularyTopic = (typeof VOCABULARY_TOPICS)[number];

/**
 * Trainer modes. `spelling` is Portuguese → English recall and `recognition`
 * English → Portuguese. `audio` is reserved: no pack provides recordings yet
 * and the trainer does not offer it.
 */
export const TRAINER_MODES = ['spelling', 'recognition', 'context', 'definition', 'audio'] as const;
export type TrainerMode = (typeof TRAINER_MODES)[number];
export const AVAILABLE_TRAINER_MODES = ['spelling', 'recognition', 'context', 'definition'] as const satisfies readonly TrainerMode[];
export type AvailableTrainerMode = (typeof AVAILABLE_TRAINER_MODES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const word = text(PACK_LIMITS.maxWordChars);
const difficulty = z.number().int().min(1).max(5);
const id = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[a-z0-9][a-z0-9:._-]*$/, 'Use lower-case letters, digits and : . _ -');

export const packSourceSchema = z
  .object({
    id: id(32),
    name: text(120),
    url: z.string().url().max(300).nullable(),
    licence: text(120),
  })
  .strict();

export const contextExampleSchema = z
  .object({
    id: id(24),
    /** One sentence with exactly one gap marker. */
    sentence: text(PACK_LIMITS.maxSentenceChars),
    /** The form this sentence needs (may be inflected: "booked", "children"). */
    answer: word,
    /** Other answers that are genuinely correct in this sentence. Nothing is accepted unless listed. */
    accepted: z.array(word).max(6).default([]),
    /** A semantic hint shown with the sentence; defaults to the sense's definition. */
    clue: text(PACK_LIMITS.maxDefinitionChars).nullable().default(null),
    difficulty: difficulty.nullable().default(null),
  })
  .strict();
export type ContextExample = z.infer<typeof contextExampleSchema>;

export const packSenseSchema = z
  .object({
    id: id(16),
    /** Portuguese (Portugal) translations, most natural first. */
    translations: z.object({ 'pt-PT': z.array(text(80)).min(1).max(6).optional() }).strict(),
    /** An English definition of this sense. */
    definition: text(PACK_LIMITS.maxDefinitionChars).nullable().default(null),
    /** Words that are also correct for the spelling and definition prompts of this sense (true synonyms only). */
    accepted: z.array(word).max(6).default([]),
    register: z.enum(VOCABULARY_REGISTERS),
    contexts: z.array(contextExampleSchema).max(PACK_LIMITS.maxContextsPerSense).default([]),
    /** Reserved for recorded pronunciations (Audio mode, later milestone). */
    audio: z.object({ file: text(200), licence: text(120), speaker: text(120).nullable() }).strict().nullable().default(null),
  })
  .strict();
export type PackSense = z.infer<typeof packSenseSchema>;

export const packEntrySchema = z
  .object({
    /** Stable across pack versions, e.g. "en:book:verb". */
    id: id(48),
    lemma: word,
    partOfSpeech: z.enum(PARTS_OF_SPEECH),
    kind: z.enum(EXPRESSION_KINDS),
    /** Inflected forms of the lemma, by label (e.g. past, plural). Used to recognise "right word, wrong form". */
    forms: z.record(text(24), word).default({}),
    /** Other correct spellings of the lemma (e.g. British/American). */
    variants: z.array(word).max(6).default([]),
    topics: z.array(z.enum(VOCABULARY_TOPICS)).min(1).max(4),
    cefr: z
      .object({ level: z.enum(CEFR_LEVELS), source: id(32), certainty: z.enum(['listed', 'estimated']) })
      .strict()
      .nullable()
      .default(null),
    frequency: z.object({ rank: z.number().int().positive(), source: id(32) }).strict().nullable().default(null),
    /** Exercise difficulty (1 easiest, 5 hardest), independent of CEFR. */
    difficulty,
    senses: z.array(packSenseSchema).min(1).max(PACK_LIMITS.maxSensesPerEntry),
  })
  .strict();
export type PackEntry = z.infer<typeof packEntrySchema>;

function countGaps(sentence: string): number {
  return sentence.split(GAP_MARKER).length - 1;
}

export const vocabularyPackSchema = z
  .object({
    format: z.literal(VOCABULARY_PACK_FORMAT),
    schemaVersion: z.literal(VOCABULARY_PACK_SCHEMA_VERSION),
    id: id(32),
    /** Content version of this pack, e.g. "1.0.0". */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    language: languageCodeSchema,
    title: text(80),
    description: text(300),
    /** Demonstration content, written for development; not a curated production list. */
    demo: z.boolean(),
    licence: z.object({ name: text(120), url: z.string().url().max(300).nullable(), attribution: text(300) }).strict(),
    sources: z.array(packSourceSchema).min(1).max(20),
    entries: z.array(packEntrySchema).min(1).max(PACK_LIMITS.maxEntries),
  })
  .strict()
  .superRefine((pack, context) => {
    const sourceIds = new Set(pack.sources.map((source) => source.id));
    const entryIds = new Set<string>();
    const contextIds = new Set<string>();
    pack.entries.forEach((entry, entryIndex) => {
      const path = ['entries', entryIndex];
      if (entryIds.has(entry.id)) context.addIssue({ code: 'custom', path: [...path, 'id'], message: `Duplicate entry id "${entry.id}".` });
      entryIds.add(entry.id);
      if (entry.cefr && !sourceIds.has(entry.cefr.source)) context.addIssue({ code: 'custom', path: [...path, 'cefr', 'source'], message: `Unknown source "${entry.cefr.source}".` });
      if (entry.frequency && !sourceIds.has(entry.frequency.source)) context.addIssue({ code: 'custom', path: [...path, 'frequency', 'source'], message: `Unknown source "${entry.frequency.source}".` });
      const senseIds = new Set<string>();
      entry.senses.forEach((sense, senseIndex) => {
        if (senseIds.has(sense.id)) context.addIssue({ code: 'custom', path: [...path, 'senses', senseIndex, 'id'], message: `Duplicate sense id "${sense.id}".` });
        senseIds.add(sense.id);
        sense.contexts.forEach((example, exampleIndex) => {
          const examplePath = [...path, 'senses', senseIndex, 'contexts', exampleIndex];
          if (contextIds.has(example.id)) context.addIssue({ code: 'custom', path: [...examplePath, 'id'], message: `Duplicate context id "${example.id}".` });
          contextIds.add(example.id);
          const gaps = countGaps(example.sentence);
          if (gaps !== 1) context.addIssue({ code: 'custom', path: [...examplePath, 'sentence'], message: `A context sentence needs exactly one ${GAP_MARKER} (found ${gaps}).` });
          if (example.answer.includes(GAP_MARKER)) context.addIssue({ code: 'custom', path: [...examplePath, 'answer'], message: 'The answer cannot contain the gap marker.' });
        });
      });
    });
  });
export type VocabularyPack = z.infer<typeof vocabularyPackSchema>;

/** The catalogue of available packs (small, loaded first); each pack itself is loaded only when opened. */
export const vocabularyPackIndexSchema = z
  .object({
    format: z.literal('linguas-de-gato-vocabulary-index'),
    schemaVersion: z.literal(1),
    packs: z
      .array(
        z
          .object({
            id: id(32),
            version: z.string().regex(/^\d+\.\d+\.\d+$/),
            language: languageCodeSchema,
            title: text(80),
            description: text(300),
            demo: z.boolean(),
            entryCount: z.number().int().nonnegative(),
            /** Path relative to the content root, e.g. "en/demo-everyday.json". */
            path: z.string().regex(/^[a-z0-9/_-]+\.json$/),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type VocabularyPackIndex = z.infer<typeof vocabularyPackIndexSchema>;
export type VocabularyPackSummary = VocabularyPackIndex['packs'][number];
