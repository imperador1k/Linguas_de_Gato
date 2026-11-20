import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';
import { speakingCategorySchema } from './speaking.js';

/**
 * Reading Lab contracts (M5): generated and imported texts, comprehension
 * question sets grounded in the text, and reading progress.
 *
 * Levels are practice targets, never an official CEFR result.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const READING_LEVELS = ['B2', 'C1', 'C2'] as const;
export const readingLevelSchema = z.enum(READING_LEVELS);
export type ReadingLevel = z.infer<typeof readingLevelSchema>;

export const READING_TEXT_TYPES = ['article', 'opinion_piece', 'informative_article', 'report', 'narrative'] as const;
export const readingTextTypeSchema = z.enum(READING_TEXT_TYPES);
export type ReadingTextType = z.infer<typeof readingTextTypeSchema>;

export const readingCategorySchema = speakingCategorySchema;

export const READING_LIMITS = {
  minTargetWords: 150,
  maxTargetWords: 900,
  /** Imported texts: about 3,000 words; longer texts should be split by the learner. */
  maxTextChars: 20_000,
  minWords: 80,
  maxParagraphs: 60,
  maxParagraphChars: 4_000,
  maxTitleChars: 160,
  minQuestions: 4,
  maxQuestions: 10,
} as const;

/** Silent reading speed used for the estimate (words per minute). */
export const READING_WORDS_PER_MINUTE = 200;

// --- Generation: the text ----------------------------------------------------------

export const readingGenerationRequestSchema = z
  .object({
    kind: z.literal('reading'),
    level: readingLevelSchema,
    category: readingCategorySchema,
    /** The learner's own words. Untrusted; a topic suggestion only. */
    interest: z.string().trim().max(300).nullable(),
    textType: readingTextTypeSchema,
    targetWords: z.number().int().min(READING_LIMITS.minTargetWords).max(READING_LIMITS.maxTargetWords),
    /** Optional language focus, e.g. "hedging", "phrasal verbs about work". Untrusted. */
    languageFocus: z.string().trim().max(200).nullable(),
    avoidTitles: z.array(z.string().trim().max(160)).max(10),
  })
  .strict();
export type ReadingGenerationRequest = z.infer<typeof readingGenerationRequestSchema>;

export const readingVocabularySuggestionSchema = z.object({ expression: line(80), meaning: line(240) }).strict();
export type ReadingVocabularySuggestion = z.infer<typeof readingVocabularySuggestionSchema>;

export const generatedReadingSchema = z
  .object({
    title: line(READING_LIMITS.maxTitleChars),
    paragraphs: z.array(line(READING_LIMITS.maxParagraphChars)).min(3).max(20),
    objectives: z.array(line(240)).min(1).max(4),
    /** Expressions worth noticing; each must occur in the text (verified on the server). */
    vocabulary: z.array(readingVocabularySuggestionSchema).max(10),
    level: readingLevelSchema,
    textType: readingTextTypeSchema,
  })
  .strict();
export type GeneratedReading = z.infer<typeof generatedReadingSchema>;

/** What the server returns: the text plus a deterministic reading-time estimate. */
export const readingGenerationResultSchema = generatedReadingSchema
  .extend({ wordCount: z.number().int().positive(), estimatedMinutes: z.number().int().positive(), discardedVocabulary: z.number().int().nonnegative() })
  .strict();
export type ReadingGenerationResult = z.infer<typeof readingGenerationResultSchema>;

// --- Generation: comprehension questions ----------------------------------------------

export const READING_QUESTION_TYPES = ['main_idea', 'detail', 'inference', 'author_intention', 'argument_analysis', 'vocabulary_in_context', 'implication'] as const;
export const readingQuestionTypeSchema = z.enum(READING_QUESTION_TYPES);
export type ReadingQuestionType = z.infer<typeof readingQuestionTypeSchema>;

export const readingQuestionsRequestSchema = z
  .object({
    kind: z.literal('reading_questions'),
    level: readingLevelSchema,
    questionCount: z.number().int().min(READING_LIMITS.minQuestions).max(READING_LIMITS.maxQuestions),
    types: z.array(readingQuestionTypeSchema).min(1).max(READING_QUESTION_TYPES.length),
    title: z.string().trim().max(READING_LIMITS.maxTitleChars),
    /** The text: the only factual source. Untrusted. */
    paragraphs: z.array(z.string().max(READING_LIMITS.maxParagraphChars)).min(1).max(READING_LIMITS.maxParagraphs),
  })
  .strict()
  .superRefine((value, context) => {
    const text = value.paragraphs.join('\n\n');
    if (text.length > READING_LIMITS.maxTextChars) context.addIssue({ code: 'custom', path: ['paragraphs'], message: 'The text is too long.' });
    if (text.split(/\s+/).filter(Boolean).length < READING_LIMITS.minWords) {
      context.addIssue({ code: 'custom', path: ['paragraphs'], message: `At least ${READING_LIMITS.minWords} words of text are needed.` });
    }
    if (new Set(value.types).size !== value.types.length) context.addIssue({ code: 'custom', path: ['types'], message: 'Question types must be unique.' });
  });
export type ReadingQuestionsRequest = z.infer<typeof readingQuestionsRequestSchema>;

export const modelReadingQuestionSchema = z
  .object({
    type: readingQuestionTypeSchema,
    format: z.enum(['multiple_choice', 'short_answer']),
    question: line(400),
    options: z.array(line(240)).max(4),
    correctOptionIndex: z.number().int().min(0).max(3).nullable(),
    acceptedAnswers: z.array(line(240)).max(5),
    explanation: line(600),
    /** Exact words from the text that support the answer. Verified on the server. */
    evidenceQuote: line(500),
    /** 1-based paragraph numbers containing the evidence. */
    paragraphNumbers: z.array(z.number().int().min(1).max(READING_LIMITS.maxParagraphs)).max(4),
  })
  .strict();
export type ModelReadingQuestion = z.infer<typeof modelReadingQuestionSchema>;

const verifiedQuestionBase = {
  id: z.string().min(1).max(16),
  type: readingQuestionTypeSchema,
  question: line(400),
  explanation: line(600),
  evidenceQuote: line(500),
  /** 0-based index of the paragraph where the evidence starts (verified). */
  paragraphIndex: z.number().int().nonnegative(),
  /** Character offsets of the evidence in that paragraph, when it lies within one paragraph. */
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable(),
};

export const readingQuestionSchema = z.discriminatedUnion('format', [
  z.object({ ...verifiedQuestionBase, format: z.literal('multiple_choice'), options: z.array(line(240)).min(3).max(4), correctOptionIndex: z.number().int().min(0).max(3) }).strict(),
  z.object({ ...verifiedQuestionBase, format: z.literal('short_answer'), acceptedAnswers: z.array(line(240)).min(1).max(5) }).strict(),
]);
export type ReadingQuestion = z.infer<typeof readingQuestionSchema>;

// --- Stored records ---------------------------------------------------------------------

export const READING_RECORD_VERSION = 1;

export const readingTextRecordSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(READING_RECORD_VERSION),
  language: languageCodeSchema,
  source: z.enum(['generated', 'imported']),
  title: line(READING_LIMITS.maxTitleChars),
  paragraphs: z.array(z.string().min(1).max(READING_LIMITS.maxParagraphChars)).min(1).max(READING_LIMITS.maxParagraphs),
  wordCount: z.number().int().positive(),
  estimatedMinutes: z.number().int().positive(),
  /** Generated texts carry their settings; imported texts may set a level the learner chose. */
  level: readingLevelSchema.nullable(),
  textType: readingTextTypeSchema.nullable(),
  category: readingCategorySchema.nullable(),
  objectives: z.array(z.string().max(240)).max(4),
  vocabulary: z.array(readingVocabularySuggestionSchema).max(10),
  model: z.string().min(1).max(100).nullable(),
  /** Reading progress (the learner's attempt at the text). */
  progress: z
    .object({
      /** Furthest paragraph reached (0-based). */
      furthestParagraph: z.number().int().nonnegative(),
      completedAt: z.number().int().nonnegative().nullable(),
      lastOpenedAt: z.number().int().nonnegative(),
    })
    .strict(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ReadingTextRecord = z.infer<typeof readingTextRecordSchema>;

export const readingAnswerSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('multiple_choice'), questionId: z.string().min(1).max(16), selectedIndex: z.number().int().min(0).max(3) }).strict(),
  z
    .object({
      format: z.literal('short_answer'),
      questionId: z.string().min(1).max(16),
      text: z.string().max(1_000),
      selfAssessment: z.enum(['correct', 'partly', 'incorrect']).nullable(),
    })
    .strict(),
]);
export type ReadingAnswer = z.infer<typeof readingAnswerSchema>;

export const readingQuestionSetSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(READING_RECORD_VERSION),
  textId: z.string().min(1).max(128),
  level: readingLevelSchema,
  types: z.array(readingQuestionTypeSchema).min(1),
  questions: z.array(readingQuestionSchema).min(1).max(READING_LIMITS.maxQuestions),
  discarded: z.number().int().nonnegative(),
  model: z.string().min(1).max(100),
  answers: z.array(readingAnswerSchema).max(READING_LIMITS.maxQuestions),
  submittedAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ReadingQuestionSet = z.infer<typeof readingQuestionSetSchema>;
