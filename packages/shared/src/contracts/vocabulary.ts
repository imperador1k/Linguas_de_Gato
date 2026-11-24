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
  /** AI-generated practice. */
  maxQuestions: 12,
  /** A stored set: AI practice (up to 12) or a local trainer round (up to 20). */
  maxRoundQuestions: 20,
  maxAnswerChars: 400,
  /** Personal data on a sense: Portuguese translations, accepted English answers, other forms. */
  maxTranslations: 6,
  maxAlternatives: 6,
  maxForms: 12,
  maxNoteChars: 600,
  /** Attempts kept per sense and facet (older ones are dropped; the schedule keeps their effect). */
  maxFacetAttempts: 30,
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
  /** A sense added from a static vocabulary pack by training it (Vocabulary Trainer). */
  z
    .object({
      kind: z.literal('library'),
      packId: z.string().min(1).max(32),
      packVersion: z.string().min(1).max(20),
      entryId: z.string().min(1).max(48),
      senseId: z.string().min(1).max(16),
    })
    .strict(),
]);
export type VocabularySource = z.infer<typeof vocabularySourceSchema>;

// --- Learning evidence ------------------------------------------------------------------------

/**
 * The separately learnable aspects of one sense. Each has its own evidence and
 * its own schedule: recognising "eat" (EN → PT) says nothing about recalling it
 * (PT → EN), and neither says the learner can produce "ate" in a sentence.
 */
export const VOCABULARY_FACETS = ['recognition', 'recall', 'context'] as const;
export const vocabularyFacetSchema = z.enum(VOCABULARY_FACETS);
export type VocabularyFacet = z.infer<typeof vocabularyFacetSchema>;

/** What one answer showed. `skipped` is a deliberate "I don't know". */
export const FACET_OUTCOMES = ['correct', 'almost', 'wrong_form', 'incorrect', 'skipped'] as const;
export type FacetOutcome = (typeof FACET_OUTCOMES)[number];

export const facetAttemptSchema = z
  .object({
    at: z.number().int().nonnegative(),
    outcome: z.enum(FACET_OUTCOMES),
    /** Hints taken before answering; a hinted answer is weaker evidence. */
    hints: z.number().int().min(0).max(20),
    /** The form the exercise expected (the lemma, or the inflected form a sentence needed). */
    expected: z.string().trim().min(1).max(80),
    /** The trainer round (practice set) this answer came from. */
    roundId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export type FacetAttempt = z.infer<typeof facetAttemptSchema>;

/**
 * Evidence and schedule for one sense × facet: the recent attempts (the
 * evidence, newest last) and the place on the review ladder they led to.
 */
export const facetKnowledgeSchema = z
  .object({
    /** Index into the review ladder (`REVIEW_LADDER_DAYS`). */
    step: z.number().int().min(0).max(10),
    dueAt: z.number().int().nonnegative(),
    attempts: z.array(facetAttemptSchema).max(VOCABULARY_LIMITS.maxFacetAttempts),
  })
  .strict();
export type FacetKnowledge = z.infer<typeof facetKnowledgeSchema>;

export const senseKnowledgeSchema = z
  .object({ recognition: facetKnowledgeSchema.optional(), recall: facetKnowledgeSchema.optional(), context: facetKnowledgeSchema.optional() })
  .strict();
export type SenseKnowledge = z.infer<typeof senseKnowledgeSchema>;

const term = (max: number) => z.string().trim().min(1).max(max);

export const vocabularySenseSchema = z
  .object({
    id: z.string().min(1).max(64),
    contextualMeaning: line(400),
    dictionaryMeaning: line(400),
    /** Empty when the learner did not say (manual entries). */
    partOfSpeech: z.string().trim().max(40),
    /** The sentence where the learner met this sense. */
    context: z.string().max(VOCABULARY_LIMITS.maxSentenceChars),
    source: vocabularySourceSchema,
    examples: z.array(line(300)).max(4),
    collocations: z.array(line(80)).max(8),
    synonyms: z.array(line(80)).max(8),
    antonyms: z.array(line(80)).max(6),
    register: z.enum(VOCABULARY_REGISTERS),
    patterns: z.array(line(120)).max(5),
    /** The AI's estimate (lookups); null when there is none (library senses carry `cefr` instead). */
    cefrEstimate: cefrEstimateSchema.nullable(),
    /** Curated CEFR metadata from a vocabulary pack, with its source. Absent for lookups. */
    cefr: z.object({ level: cefrEstimateSchema, source: z.string().min(1).max(120), certainty: z.enum(['listed', 'estimated']) }).strict().nullable().optional(),
    portugueseExplanation: z.string().max(600).nullable(),
    addedAt: z.number().int().nonnegative(),
    /*
     * Personal training data (V1). All optional, so records saved before keep
     * validating unchanged. Accepted answers are explicit and belong to this
     * sense only: nothing else is ever accepted.
     */
    /** Portuguese (Portugal) translations of this sense: the first is the main one, the rest are also accepted. */
    translations: z.array(term(80)).max(VOCABULARY_LIMITS.maxTranslations).optional(),
    /** Other English answers accepted for this sense when recalling it (true equivalents, chosen by the learner). */
    alternatives: z.array(term(80)).max(VOCABULARY_LIMITS.maxAlternatives).optional(),
    /** Other grammatical forms of the word in this sense ("eats", "ate", "eaten"). Never guessed. */
    forms: z.array(term(80)).max(VOCABULARY_LIMITS.maxForms).optional(),
    notes: z.string().trim().max(VOCABULARY_LIMITS.maxNoteChars).optional(),
    /** What the learner has demonstrated for this sense, per facet. Absent until first trained. */
    knowledge: senseKnowledgeSchema.optional(),
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
    /**
     * The most recent ratings, newest last (kept short). `via: 'trainer'` marks a
     * schedule change made by a checked trainer round: the round itself is the
     * evidence, so these are not counted again as reviews.
     */
    history: z.array(z.object({ at: z.number().int().nonnegative(), rating: z.enum(REVIEW_RATINGS), via: z.literal('trainer').optional() }).strict()).max(20),
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

/**
 * Questions built locally from a vocabulary pack or the learner's own
 * collection (Vocabulary Trainer). They are never requested from the AI: the
 * generation request and the model schema keep using
 * `VOCABULARY_QUESTION_TYPES` only.
 * - `spelling`: Portuguese → English recall (the stored name predates V1; the UI calls it "Portuguese → English").
 * - `recognition`: English → Portuguese.
 * - `context`: complete a sentence with the form it needs.
 * - `definition`: English definition → the word (packs only).
 */
export const LOCAL_VOCABULARY_QUESTION_TYPES = ['spelling', 'context', 'definition', 'recognition'] as const;
export type LocalVocabularyQuestionType = (typeof LOCAL_VOCABULARY_QUESTION_TYPES)[number];
/** Every type a stored practice set may contain. */
export const storedVocabularyQuestionTypeSchema = z.enum([...VOCABULARY_QUESTION_TYPES, ...LOCAL_VOCABULARY_QUESTION_TYPES]);
export type StoredVocabularyQuestionType = z.infer<typeof storedVocabularyQuestionTypeSchema>;
/** `model` of a practice set built in the browser, without AI. */
export const LOCAL_PRACTICE_MODEL = 'local';

/** Scored deterministically against the key. */
export const OBJECTIVE_VOCABULARY_TYPES: ReadonlySet<StoredVocabularyQuestionType> = new Set(['gap_fill', 'meaning_choice', 'collocation', 'matching', ...LOCAL_VOCABULARY_QUESTION_TYPES]);

export function isLocalQuestionType(type: StoredVocabularyQuestionType): type is LocalVocabularyQuestionType {
  return (LOCAL_VOCABULARY_QUESTION_TYPES as readonly string[]).includes(type);
}

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

/** Which pack sense a local question practises (rounds built from a vocabulary pack). */
export const packQuestionRefSchema = z
  .object({
    packId: z.string().min(1).max(32),
    packVersion: z.string().min(1).max(20),
    entryId: z.string().min(1).max(48),
    senseId: z.string().min(1).max(16),
    contextId: z.string().min(1).max(24).nullable(),
  })
  .strict();
/** Which collection sense a local question practises (rounds built from the learner's own vocabulary). */
export const collectionQuestionRefSchema = z
  .object({
    kind: z.literal('collection'),
    entryId: z.string().min(1).max(128),
    senseId: z.string().min(1).max(64),
    contextId: z.string().min(1).max(24).nullable(),
  })
  .strict();
export type PackQuestionRef = z.infer<typeof packQuestionRefSchema>;
export type CollectionQuestionRef = z.infer<typeof collectionQuestionRefSchema>;

export function isCollectionRef(ref: PackQuestionRef | CollectionQuestionRef): ref is CollectionQuestionRef {
  return 'kind' in ref && ref.kind === 'collection';
}

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
  ...localQuestionSchemas(),
]);
export type VocabularyQuestion = z.infer<typeof vocabularyQuestionSchema>;
export type LocalVocabularyQuestion = Extract<VocabularyQuestion, { type: LocalVocabularyQuestionType }>;

function localQuestionSchemas() {
  const term = z.string().trim().min(1).max(80);
  const local = {
    ...questionBase,
    /**
     * `itemId` for local questions: the pack reference "packId/entryId/senseId",
     * or "collection/entryId/senseId" for the learner's own vocabulary.
     */
    language: languageCodeSchema,
    lemma: term,
    /** The answer the prompt asks for (the lemma, the inflected form a sentence needs, or a translation). */
    answer: term,
    /** Other answers that are genuinely correct. Nothing else is accepted. */
    accepted: z.array(term).max(12),
    /** Other forms of the same word, recognised as "right word, wrong form". */
    forms: z.array(term).max(16),
    /** Records before V1 have no `kind` and always point at a pack. */
    ref: z.union([collectionQuestionRefSchema, packQuestionRefSchema]),
    /** The sense's part of speech, shown with the prompt to tell meanings apart (V1; optional). */
    partOfSpeech: z.string().trim().max(40).optional(),
  };
  return [
    /** Prompt: the Portuguese translation(s). Answer: the English lemma. */
    z.object({ ...local, type: z.literal('spelling') }).strict(),
    /** Prompt: a sentence with one gap; `clue` is the semantic hint. */
    z.object({ ...local, type: z.literal('context'), clue: z.string().max(300).nullable() }).strict(),
    /** Prompt: an English definition. */
    z.object({ ...local, type: z.literal('definition') }).strict(),
    /** Prompt: the English word (and an example, when there is one). Answer: a Portuguese translation. */
    z.object({ ...local, type: z.literal('recognition'), example: z.string().max(VOCABULARY_LIMITS.maxSentenceChars).nullable() }).strict(),
  ] as const;
}

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

/** Hints a trainer question can give: the number of letters, the first letter, one more letter. */
export const TRAINER_HINTS = ['length', 'first_letter', 'letter'] as const;
export type TrainerHint = (typeof TRAINER_HINTS)[number];

export const vocabularyAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), questionId: z.string().min(1).max(16), selectedIndex: z.number().int().min(0).max(3) }).strict(),
  z.object({ kind: z.literal('text'), questionId: z.string().min(1).max(16), text: z.string().max(VOCABULARY_LIMITS.maxAnswerChars) }).strict(),
  /** Matching: for each pair (by position), the index of the meaning the learner chose. */
  z.object({ kind: z.literal('matching'), questionId: z.string().min(1).max(16), choices: z.array(z.number().int().min(-1).max(5)).max(6) }).strict(),
  /** A typed answer to a local trainer question, with the hints the learner asked for before answering. */
  z
    .object({
      kind: z.literal('typed'),
      questionId: z.string().min(1).max(16),
      text: z.string().max(VOCABULARY_LIMITS.maxAnswerChars),
      hints: z.array(z.enum(TRAINER_HINTS)).max(20),
      answeredAt: z.number().int().nonnegative(),
    })
    .strict(),
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
  entryIds: z.array(z.string().min(1).max(200)).min(1).max(VOCABULARY_LIMITS.maxRoundQuestions),
  types: z.array(storedVocabularyQuestionTypeSchema).min(1),
  // Trainer rounds go up to 20 questions (the round sizes offered); AI sets stay at 12 by their own request schema.
  questions: z.array(vocabularyQuestionSchema).min(1).max(VOCABULARY_LIMITS.maxRoundQuestions),
  /** Matching meanings are shown shuffled; this is the display order per matching question. */
  shuffles: z.record(z.string(), z.array(z.number().int().min(0).max(5))),
  discarded: z.number().int().nonnegative(),
  model: z.string().min(1).max(100),
  answers: z.array(vocabularyAnswerSchema).max(VOCABULARY_LIMITS.maxRoundQuestions),
  reviews: z.array(storedVocabularyReviewSchema).max(VOCABULARY_LIMITS.maxQuestions),
  checkedAt: z.number().int().nonnegative().nullable(),
  history: z.array(z.object({ checkedAt: z.number().int().nonnegative(), correct: z.number().int().nonnegative(), objectiveTotal: z.number().int().nonnegative() }).strict()).max(100),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type VocabularyPracticeSet = z.infer<typeof vocabularyPracticeSetSchema>;
