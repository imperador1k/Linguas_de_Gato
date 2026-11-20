import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';

/**
 * Vocabulary Lab contracts (M5): contextual lookups, the personal collection
 * (one entry per expression, with one or more contextual senses), a simple
 * review schedule, and practice sets with deterministic scoring for objective
 * questions and a separate AI evaluation for open answers.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const VOCABULARY_LIMITS = {
  maxExpressionChars: 80,
  maxExpressionWords: 8,
  maxSentenceChars: 600,
  maxParagraphChars: 4_000,
  maxPracticeItems: 20,
  minQuestions: 4,
  maxQuestions: 12,
  maxAnswerChars: 400,
} as const;

export const EXPRESSION_KINDS = ['word', 'phrasal_verb', 'idiom', 'collocation', 'expression'] as const;
export const expressionKindSchema = z.enum(EXPRESSION_KINDS);
export type ExpressionKind = z.infer<typeof expressionKindSchema>;

export const VOCABULARY_REGISTERS = ['formal', 'neutral', 'informal'] as const;
/** An AI estimate, always labelled as such in the UI. */
export const CEFR_ESTIMATES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const cefrEstimateSchema = z.enum(CEFR_ESTIMATES);

export const EXPLANATION_LANGUAGES = ['en', 'pt'] as const;
export const explanationLanguageSchema = z.enum(EXPLANATION_LANGUAGES);
export type ExplanationLanguage = z.infer<typeof explanationLanguageSchema>;

// --- Lookup -----------------------------------------------------------------------------

export const vocabularyLookupRequestSchema = z
  .object({
    /** What the learner selected. Must occur in `sentence`. */
    expression: line(VOCABULARY_LIMITS.maxExpressionChars),
    /** The sentence it was selected from. */
    sentence: line(VOCABULARY_LIMITS.maxSentenceChars),
    /** The surrounding paragraph, for wider context. */
    paragraph: z.string().max(VOCABULARY_LIMITS.maxParagraphChars),
    /** Add a short Portuguese explanation; definitions and examples stay in English. */
    explanationLanguage: explanationLanguageSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expression.split(/\s+/).filter(Boolean).length > VOCABULARY_LIMITS.maxExpressionWords) {
      context.addIssue({ code: 'custom', path: ['expression'], message: `Select at most ${VOCABULARY_LIMITS.maxExpressionWords} words.` });
    }
  });
export type VocabularyLookupRequest = z.infer<typeof vocabularyLookupRequestSchema>;

export const modelVocabularyLookupSchema = z
  .object({
    /** The expression as it should be learned (may extend the selection to the full phrase, e.g. a particle). */
    expression: line(VOCABULARY_LIMITS.maxExpressionChars),
    /** Dictionary form, e.g. "take off" for "took off". */
    lemma: line(VOCABULARY_LIMITS.maxExpressionChars),
    kind: expressionKindSchema,
    partOfSpeech: line(40),
    /** The meaning in THIS sentence. */
    contextualMeaning: line(400),
    /** A general dictionary-style definition of this sense. */
    dictionaryMeaning: line(400),
    /** Exact words from the sentence where the expression occurs. Verified. */
    contextEvidence: line(VOCABULARY_LIMITS.maxSentenceChars),
    collocations: z.array(line(80)).max(8),
    synonyms: z.array(line(80)).max(8),
    antonyms: z.array(line(80)).max(6),
    register: z.enum(VOCABULARY_REGISTERS),
    examples: z.array(line(300)).min(2).max(4),
    patterns: z.array(line(120)).max(5),
    cefrEstimate: cefrEstimateSchema,
    portugueseExplanation: z.string().trim().min(1).max(600).nullable(),
  })
  .strict();
export type ModelVocabularyLookup = z.infer<typeof modelVocabularyLookupSchema>;

export const vocabularyLookupResponseSchema = z
  .object({ provider: z.literal('groq'), model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), lookup: modelVocabularyLookupSchema })
  .strict();
export type VocabularyLookupResponse = z.infer<typeof vocabularyLookupResponseSchema>;

// --- Collection -----------------------------------------------------------------------------

export const vocabularySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reading'), textId: z.string().min(1).max(128), title: z.string().max(160), paragraphIndex: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('manual') }).strict(),
]);
export type VocabularySource = z.infer<typeof vocabularySourceSchema>;

export const vocabularySenseSchema = z
  .object({
    id: z.string().min(1).max(64),
    contextualMeaning: line(400),
    dictionaryMeaning: line(400),
    partOfSpeech: line(40),
    /** The sentence where the learner met this sense. */
    context: z.string().max(VOCABULARY_LIMITS.maxSentenceChars),
    source: vocabularySourceSchema,
    examples: z.array(line(300)).max(4),
    collocations: z.array(line(80)).max(8),
    synonyms: z.array(line(80)).max(8),
    antonyms: z.array(line(80)).max(6),
    register: z.enum(VOCABULARY_REGISTERS),
    patterns: z.array(line(120)).max(5),
    cefrEstimate: cefrEstimateSchema,
    portugueseExplanation: z.string().max(600).nullable(),
    addedAt: z.number().int().nonnegative(),
  })
  .strict();
export type VocabularySense = z.infer<typeof vocabularySenseSchema>;

export const REVIEW_STATUSES = ['new', 'learning', 'known'] as const;
export const REVIEW_RATINGS = ['again', 'good', 'easy'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const reviewStateSchema = z
  .object({
    status: z.enum(REVIEW_STATUSES),
    /** Index into the fixed interval ladder. */
    step: z.number().int().min(0).max(10),
    dueAt: z.number().int().nonnegative(),
    lastReviewedAt: z.number().int().nonnegative().nullable(),
    /** The most recent ratings, newest last (kept short). */
    history: z.array(z.object({ at: z.number().int().nonnegative(), rating: z.enum(REVIEW_RATINGS) }).strict()).max(20),
  })
  .strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const VOCABULARY_RECORD_VERSION = 1;

export const vocabularyEntrySchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(VOCABULARY_RECORD_VERSION),
  language: languageCodeSchema,
  expression: line(VOCABULARY_LIMITS.maxExpressionChars),
  lemma: line(VOCABULARY_LIMITS.maxExpressionChars),
  /** Lower-cased, normalised lemma: one entry per expression. */
  key: z.string().min(1).max(VOCABULARY_LIMITS.maxExpressionChars),
  kind: expressionKindSchema,
  senses: z.array(vocabularySenseSchema).min(1).max(10),
  review: reviewStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type VocabularyEntry = z.infer<typeof vocabularyEntrySchema>;

// --- Practice generation -----------------------------------------------------------------------

export const VOCABULARY_QUESTION_TYPES = ['gap_fill', 'meaning_choice', 'collocation', 'matching', 'sentence_completion', 'paraphrase', 'own_sentence'] as const;
export const vocabularyQuestionTypeSchema = z.enum(VOCABULARY_QUESTION_TYPES);
export type VocabularyQuestionType = z.infer<typeof vocabularyQuestionTypeSchema>;

/** Scored deterministically against the key. */
export const OBJECTIVE_VOCABULARY_TYPES: ReadonlySet<VocabularyQuestionType> = new Set(['gap_fill', 'meaning_choice', 'collocation', 'matching']);

export const practiceItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    expression: line(VOCABULARY_LIMITS.maxExpressionChars),
    meaning: line(400),
    context: z.string().max(VOCABULARY_LIMITS.maxSentenceChars),
  })
  .strict();
export type PracticeItem = z.infer<typeof practiceItemSchema>;

export const vocabularyPracticeRequestSchema = z
  .object({
    kind: z.literal('vocabulary_practice'),
    types: z.array(vocabularyQuestionTypeSchema).min(1).max(VOCABULARY_QUESTION_TYPES.length),
    questionCount: z.number().int().min(VOCABULARY_LIMITS.minQuestions).max(VOCABULARY_LIMITS.maxQuestions),
    /** The learner's saved expressions (untrusted text). */
    items: z.array(practiceItemSchema).min(1).max(VOCABULARY_LIMITS.maxPracticeItems),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.types).size !== value.types.length) context.addIssue({ code: 'custom', path: ['types'], message: 'Question types must be unique.' });
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Item ids must be unique.' });
    if (value.types.includes('matching') && value.items.length < 3) context.addIssue({ code: 'custom', path: ['types'], message: 'Matching needs at least three expressions.' });
  });
export type VocabularyPracticeRequest = z.infer<typeof vocabularyPracticeRequestSchema>;

export const modelVocabularyQuestionSchema = z
  .object({
    type: vocabularyQuestionTypeSchema,
    /** The item the question practises (for matching: the first of the pairs). */
    itemId: z.string().min(1).max(128),
    /** Instruction or sentence; gaps are written as ___. */
    prompt: line(500),
    options: z.array(line(240)).max(4),
    correctOptionIndex: z.number().int().min(0).max(3).nullable(),
    acceptedAnswers: z.array(line(240)).max(5),
    /** Matching: expression → meaning pairs. */
    pairs: z.array(z.object({ itemId: z.string().min(1).max(128), expression: line(80), meaning: line(240) }).strict()).max(6),
    explanation: line(500),
  })
  .strict();
export type ModelVocabularyQuestion = z.infer<typeof modelVocabularyQuestionSchema>;

const questionBase = { id: z.string().min(1).max(16), itemId: z.string().min(1).max(128), prompt: line(500), explanation: line(500) };

export const vocabularyQuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...questionBase, type: z.literal('gap_fill'), acceptedAnswers: z.array(line(240)).min(1).max(5) }).strict(),
  z.object({ ...questionBase, type: z.literal('meaning_choice'), options: z.array(line(240)).min(3).max(4), correctOptionIndex: z.number().int().min(0).max(3) }).strict(),
  z.object({ ...questionBase, type: z.literal('collocation'), options: z.array(line(240)).min(3).max(4), correctOptionIndex: z.number().int().min(0).max(3) }).strict(),
  z
    .object({ ...questionBase, type: z.literal('matching'), pairs: z.array(z.object({ itemId: z.string().min(1).max(128), expression: line(80), meaning: line(240) }).strict()).min(3).max(6) })
    .strict(),
  z.object({ ...questionBase, type: z.literal('sentence_completion'), acceptedAnswers: z.array(line(240)).min(1).max(5) }).strict(),
  z.object({ ...questionBase, type: z.literal('paraphrase'), acceptedAnswers: z.array(line(240)).min(1).max(5) }).strict(),
  z.object({ ...questionBase, type: z.literal('own_sentence') }).strict(),
]);
export type VocabularyQuestion = z.infer<typeof vocabularyQuestionSchema>;

// --- Open-answer evaluation ----------------------------------------------------------------------

export const vocabularyEvaluationRequestSchema = z
  .object({
    expression: line(VOCABULARY_LIMITS.maxExpressionChars),
    meaning: line(400),
    task: z.enum(['sentence_completion', 'paraphrase', 'own_sentence']),
    prompt: line(500),
    /** Model answers for completion and paraphrase (empty for own sentences). */
    exampleAnswers: z.array(line(240)).max(5),
    /** The learner's answer. Untrusted. */
    answer: line(VOCABULARY_LIMITS.maxAnswerChars),
  })
  .strict();
export type VocabularyEvaluationRequest = z.infer<typeof vocabularyEvaluationRequestSchema>;

export const VOCABULARY_VERDICTS = ['correct', 'partly', 'incorrect'] as const;

export const vocabularyReviewSchema = z
  .object({
    verdict: z.enum(VOCABULARY_VERDICTS),
    /** Whether the expression is used with the intended meaning. */
    usesExpressionCorrectly: z.boolean(),
    feedback: line(600),
    improvedAnswer: z.string().trim().min(1).max(400).nullable(),
  })
  .strict();
export type VocabularyAnswerReview = z.infer<typeof vocabularyReviewSchema>;

export const vocabularyEvaluationResponseSchema = z
  .object({ provider: z.literal('groq'), model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), review: vocabularyReviewSchema })
  .strict();
export type VocabularyEvaluationResponse = z.infer<typeof vocabularyEvaluationResponseSchema>;

// --- Stored practice sets --------------------------------------------------------------------------

export const vocabularyAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), questionId: z.string().min(1).max(16), selectedIndex: z.number().int().min(0).max(3) }).strict(),
  z.object({ kind: z.literal('text'), questionId: z.string().min(1).max(16), text: z.string().max(VOCABULARY_LIMITS.maxAnswerChars) }).strict(),
  /** Matching: for each pair (by position), the index of the meaning the learner chose. */
  z.object({ kind: z.literal('matching'), questionId: z.string().min(1).max(16), choices: z.array(z.number().int().min(-1).max(5)).max(6) }).strict(),
]);
export type VocabularyAnswer = z.infer<typeof vocabularyAnswerSchema>;

export const storedVocabularyReviewSchema = vocabularyReviewSchema
  .extend({ questionId: z.string().min(1).max(16), answer: z.string().max(VOCABULARY_LIMITS.maxAnswerChars), model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative() })
  .strict();
export type StoredVocabularyReview = z.infer<typeof storedVocabularyReviewSchema>;

export const vocabularyPracticeSetSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(VOCABULARY_RECORD_VERSION),
  /** The entries practised, for display and cleanup. */
  entryIds: z.array(z.string().min(1).max(128)).min(1).max(VOCABULARY_LIMITS.maxPracticeItems),
  types: z.array(vocabularyQuestionTypeSchema).min(1),
  questions: z.array(vocabularyQuestionSchema).min(1).max(VOCABULARY_LIMITS.maxQuestions),
  /** Matching meanings are shown shuffled; this is the display order per matching question. */
  shuffles: z.record(z.string(), z.array(z.number().int().min(0).max(5))),
  discarded: z.number().int().nonnegative(),
  model: z.string().min(1).max(100),
  answers: z.array(vocabularyAnswerSchema).max(VOCABULARY_LIMITS.maxQuestions),
  reviews: z.array(storedVocabularyReviewSchema).max(VOCABULARY_LIMITS.maxQuestions),
  checkedAt: z.number().int().nonnegative().nullable(),
  history: z.array(z.object({ checkedAt: z.number().int().nonnegative(), correct: z.number().int().nonnegative(), objectiveTotal: z.number().int().nonnegative() }).strict()).max(100),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type VocabularyPracticeSet = z.infer<typeof vocabularyPracticeSetSchema>;
