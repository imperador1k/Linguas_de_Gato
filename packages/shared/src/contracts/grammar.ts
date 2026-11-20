import { z } from 'zod';
import { targetedPracticeSchema } from './learning.js';

/**
 * Grammar Lab contracts (M4). Generated sets are validated question by
 * question; objective questions are scored deterministically against
 * answer keys. An optional AI "second opinion" on open answers is a separate,
 * explicitly requested evaluation that never changes the deterministic score.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const GRAMMAR_LEVELS = ['B2', 'C1', 'C2'] as const;
export const grammarLevelSchema = z.enum(GRAMMAR_LEVELS);
export type GrammarLevel = z.infer<typeof grammarLevelSchema>;

export const GRAMMAR_TOPICS = [
  'conditionals',
  'inversion',
  'passive_voice',
  'modal_verbs',
  'relative_clauses',
  'participle_clauses',
  'reported_speech',
  'articles_and_prepositions',
  'cleft_sentences',
  'linking_devices',
  'collocations_and_phrasal_verbs',
  'advanced_structures',
] as const;
export const grammarTopicSchema = z.enum(GRAMMAR_TOPICS);
export type GrammarTopic = z.infer<typeof grammarTopicSchema>;

export const GRAMMAR_QUESTION_TYPES = ['multiple_choice', 'gap_fill', 'error_correction', 'transformation', 'word_order', 'sentence_completion'] as const;
export const grammarQuestionTypeSchema = z.enum(GRAMMAR_QUESTION_TYPES);
export type GrammarQuestionType = z.infer<typeof grammarQuestionTypeSchema>;

/** Types whose answers can be legitimately phrased in ways an answer key can't list: a second opinion may be requested. */
export const OPEN_GRAMMAR_TYPES: ReadonlySet<GrammarQuestionType> = new Set(['error_correction', 'transformation', 'sentence_completion']);

/** The gap marker in prompts. */
export const GAP = '___';

export const GRAMMAR_LIMITS = { minQuestions: 4, maxQuestions: 12, maxAnswerChars: 400 } as const;

// --- Generation -----------------------------------------------------------------------

export const grammarGenerationRequestSchema = z
  .object({
    kind: z.literal('grammar'),
    level: grammarLevelSchema,
    topic: grammarTopicSchema,
    types: z.array(grammarQuestionTypeSchema).min(1).max(GRAMMAR_QUESTION_TYPES.length),
    questionCount: z.number().int().min(GRAMMAR_LIMITS.minQuestions).max(GRAMMAR_LIMITS.maxQuestions),
    /** Optional narrower focus in the learner's words, e.g. "mixed conditionals about regrets". Untrusted. */
    focus: z.string().trim().max(200).nullable(),
    avoidTitles: z.array(z.string().trim().max(120)).max(10),
    /** Personalized training (M6): one weakness and a few real examples. */
    targetedPractice: targetedPracticeSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.types).size !== value.types.length) context.addIssue({ code: 'custom', path: ['types'], message: 'Question types must be unique.' });
  });
export type GrammarGenerationRequest = z.infer<typeof grammarGenerationRequestSchema>;

/** One question as the model returns it (flat, for strict Structured Outputs); verified individually. */
export const modelGrammarQuestionSchema = z
  .object({
    type: grammarQuestionTypeSchema,
    /** The sentence the learner works on; gaps are written as ___. */
    prompt: line(400),
    /** Transformation: the original sentence to keep the meaning of. */
    sourceSentence: z.string().trim().min(1).max(400).nullable(),
    /** Transformation: the word that must be used, unchanged. */
    keyword: z.string().trim().min(1).max(30).nullable(),
    /** Word order: the words to arrange (any order). */
    words: z.array(line(40)).max(16),
    options: z.array(line(160)).max(4),
    correctOptionIndex: z.number().int().min(0).max(3).nullable(),
    /** Every acceptable answer (gap content, full sentence for error correction and word order). */
    acceptedAnswers: z.array(line(300)).max(6),
    explanation: line(600),
    rule: line(400),
    /** Multiple choice: why each option is right or wrong, aligned with `options`. */
    distractorExplanations: z.array(z.string().trim().max(300)).max(4),
  })
  .strict();
export type ModelGrammarQuestion = z.infer<typeof modelGrammarQuestionSchema>;

export const modelGrammarSetSchema = z
  .object({
    title: line(120),
    instructions: line(400),
    questions: z.array(z.unknown()).max(30),
  })
  .strict();

const base = {
  id: z.string().min(1).max(16),
  prompt: line(400),
  explanation: line(600),
  rule: line(400),
};

export const grammarQuestionSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('multiple_choice'),
      options: z.array(line(160)).min(3).max(4),
      correctOptionIndex: z.number().int().min(0).max(3),
      distractorExplanations: z.array(z.string().max(300)).min(3).max(4),
    })
    .strict(),
  z.object({ ...base, type: z.literal('gap_fill'), acceptedAnswers: z.array(line(300)).min(1).max(6) }).strict(),
  z.object({ ...base, type: z.literal('error_correction'), acceptedAnswers: z.array(line(300)).min(1).max(6) }).strict(),
  z
    .object({
      ...base,
      type: z.literal('transformation'),
      sourceSentence: line(400),
      keyword: line(30),
      acceptedAnswers: z.array(line(300)).min(1).max(6),
    })
    .strict(),
  z.object({ ...base, type: z.literal('word_order'), words: z.array(line(40)).min(3).max(16), acceptedAnswers: z.array(line(300)).min(1).max(6) }).strict(),
  z.object({ ...base, type: z.literal('sentence_completion'), acceptedAnswers: z.array(line(300)).min(1).max(6) }).strict(),
]);
export type GrammarQuestion = z.infer<typeof grammarQuestionSchema>;

export const grammarSetSchema = z
  .object({
    title: line(120),
    instructions: line(400),
    level: grammarLevelSchema,
    topic: grammarTopicSchema,
    questions: z.array(grammarQuestionSchema).min(1).max(GRAMMAR_LIMITS.maxQuestions),
  })
  .strict();
export type GrammarSet = z.infer<typeof grammarSetSchema>;

// --- Second-opinion evaluation (open answers only) -----------------------------------------

export const GRAMMAR_VERDICTS = ['correct', 'acceptable', 'incorrect'] as const;

export const grammarEvaluationRequestSchema = z
  .object({
    level: grammarLevelSchema,
    topic: grammarTopicSchema,
    question: z
      .object({
        type: z.enum(['error_correction', 'transformation', 'sentence_completion']),
        prompt: line(400),
        sourceSentence: z.string().max(400).nullable(),
        keyword: z.string().max(30).nullable(),
        acceptedAnswers: z.array(line(300)).min(1).max(6),
        rule: line(400),
      })
      .strict(),
    /** The learner's answer. Untrusted. */
    answer: line(GRAMMAR_LIMITS.maxAnswerChars),
  })
  .strict();
export type GrammarEvaluationRequest = z.infer<typeof grammarEvaluationRequestSchema>;

export const grammarReviewSchema = z
  .object({
    verdict: z.enum(GRAMMAR_VERDICTS),
    explanation: line(600),
    /** A corrected version of the learner's own answer, when it is not correct. */
    correctedAnswer: z.string().trim().min(1).max(400).nullable(),
  })
  .strict();
export type GrammarReview = z.infer<typeof grammarReviewSchema>;

export const grammarEvaluationResponseSchema = z
  .object({ provider: z.literal('groq'), model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), review: grammarReviewSchema })
  .strict();
export type GrammarEvaluationResponse = z.infer<typeof grammarEvaluationResponseSchema>;

// --- Stored set, answers and history (IndexedDB) ---------------------------------------------

export const grammarAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), questionId: z.string().min(1).max(16), selectedIndex: z.number().int().min(0).max(3) }).strict(),
  z.object({ kind: z.literal('text'), questionId: z.string().min(1).max(16), text: z.string().max(GRAMMAR_LIMITS.maxAnswerChars) }).strict(),
]);
export type GrammarAnswer = z.infer<typeof grammarAnswerSchema>;

export const storedGrammarReviewSchema = grammarReviewSchema
  .extend({
    questionId: z.string().min(1).max(16),
    /** The answer that was reviewed; a changed answer invalidates the review. */
    answer: z.string().max(GRAMMAR_LIMITS.maxAnswerChars),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type StoredGrammarReview = z.infer<typeof storedGrammarReviewSchema>;

export const grammarCheckResultSchema = z
  .object({ checkedAt: z.number().int().nonnegative(), correct: z.number().int().nonnegative(), total: z.number().int().positive() })
  .strict();
export type GrammarCheckResult = z.infer<typeof grammarCheckResultSchema>;

export const GRAMMAR_RECORD_VERSION = 1;

export const grammarSetRecordSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(GRAMMAR_RECORD_VERSION),
  set: grammarSetSchema,
  types: z.array(grammarQuestionTypeSchema).min(1),
  discarded: z.number().int().nonnegative(),
  model: z.string().min(1).max(100),
  answers: z.array(grammarAnswerSchema).max(GRAMMAR_LIMITS.maxQuestions),
  /** Set when the current round is checked; answers are locked until "Try again". */
  checkedAt: z.number().int().nonnegative().nullable(),
  reviews: z.array(storedGrammarReviewSchema).max(GRAMMAR_LIMITS.maxQuestions),
  /** One entry per checked round, oldest first (deterministic scores only). */
  history: z.array(grammarCheckResultSchema).max(100),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type GrammarSetRecord = z.infer<typeof grammarSetRecordSchema>;
