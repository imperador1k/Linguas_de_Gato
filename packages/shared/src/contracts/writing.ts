import { z } from 'zod';
import { targetedPracticeSchema } from './learning.js';
import { speakingCategorySchema } from './speaking.js';

/**
 * Writing Lab contracts (M4): generated writing tasks, drafts, submitted
 * attempts and evidence-based assessment.
 *
 * Levels are practice targets, never an official CEFR result. Assessment
 * output carries no scores.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const WRITING_LEVELS = ['B2', 'C1', 'C2'] as const;
export const writingLevelSchema = z.enum(WRITING_LEVELS);
export type WritingLevel = z.infer<typeof writingLevelSchema>;

/** Topic categories are shared with Speaking so learners see one vocabulary of themes. */
export const writingCategorySchema = speakingCategorySchema;
export type WritingCategory = z.infer<typeof writingCategorySchema>;

export const WRITING_FORMATS = [
  'argumentative_essay',
  'opinion_essay',
  'discursive_essay',
  'formal_email',
  'informal_email',
  'report',
  'proposal',
  'article',
  'review',
  'summary',
  'paraphrase',
  'reformulation',
] as const;
export const writingFormatSchema = z.enum(WRITING_FORMATS);
export type WritingFormat = z.infer<typeof writingFormatSchema>;

/** Formats that work on a text the task supplies (summarise it, paraphrase it, improve it). */
export const SOURCE_TEXT_FORMATS: ReadonlySet<WritingFormat> = new Set(['summary', 'paraphrase', 'reformulation']);

export const WRITING_REGISTERS = ['formal', 'neutral', 'informal'] as const;
export const writingRegisterSchema = z.enum(WRITING_REGISTERS);
export type WritingRegister = z.infer<typeof writingRegisterSchema>;

export const WRITING_LIMITS = {
  minTargetWords: 40,
  maxTargetWords: 600,
  /** The editor stops accepting text beyond this; generous for a 600-word task. */
  maxTextChars: 12_000,
  minWordsForAssessment: 30,
  maxSourceTextChars: 3_000,
  maxCorrections: 30,
} as const;

// --- Generation -------------------------------------------------------------------

export const writingGenerationRequestSchema = z
  .object({
    kind: z.literal('writing'),
    level: writingLevelSchema,
    format: writingFormatSchema,
    category: writingCategorySchema,
    /** The learner's own words. Untrusted; a topic suggestion only. */
    interest: z.string().trim().max(300).nullable(),
    targetWords: z.number().int().min(WRITING_LIMITS.minTargetWords).max(WRITING_LIMITS.maxTargetWords),
    register: writingRegisterSchema,
    /** A specific learning objective in the learner's words, e.g. "use concession clauses". */
    objective: z.string().trim().max(200).nullable(),
    avoidTitles: z.array(z.string().trim().max(120)).max(10),
    /** Personalized training (M6): one weakness and a few real examples. */
    targetedPractice: targetedPracticeSchema.nullable().optional(),
  })
  .strict();
export type WritingGenerationRequest = z.infer<typeof writingGenerationRequestSchema>;

export const wordCountRangeSchema = z
  .object({
    target: z.number().int().min(10).max(1_000),
    min: z.number().int().min(5).max(1_000),
    max: z.number().int().min(10).max(1_200),
  })
  .strict()
  .refine((range) => range.min <= range.target && range.target <= range.max, { message: 'The word range must contain the target.' });
export type WordCountRange = z.infer<typeof wordCountRangeSchema>;

/** A writing task. Deliberately no model answer. */
export const writingTaskSchema = z
  .object({
    title: line(120),
    instructions: line(800),
    /** The situation: who is writing, to whom, why. */
    context: line(800),
    /** Required for summary, paraphrase and reformulation; null otherwise. */
    sourceText: z.string().trim().min(1).max(WRITING_LIMITS.maxSourceTextChars).nullable(),
    wordCount: wordCountRangeSchema,
    requiredElements: z.array(line(200)).min(1).max(8),
    evaluationCriteria: z.array(line(200)).min(2).max(8),
    objectives: z.array(line(200)).min(1).max(5),
    languageFeatures: z.array(line(160)).max(8),
    level: writingLevelSchema,
    format: writingFormatSchema,
    register: writingRegisterSchema,
  })
  .strict();
export type WritingTask = z.infer<typeof writingTaskSchema>;

// --- Assessment -----------------------------------------------------------------

export const WRITING_ASSESSMENT_LEVELS = ['strong', 'developing', 'needs_attention'] as const;
export const writingAssessmentLevelSchema = z.enum(WRITING_ASSESSMENT_LEVELS);

export const WRITING_DIMENSIONS = [
  'grammar',
  'vocabulary',
  'naturalness',
  'coherence',
  'taskAchievement',
  'register',
  'sentenceVariety',
] as const;
export type WritingDimension = (typeof WRITING_DIMENSIONS)[number];

/**
 * `error`: the original is wrong (it breaks a rule or is not used by
 * proficient writers). `suggestion`: the original is acceptable; this is a
 * more precise, natural or varied option. The distinction is shown to the
 * learner and validated on the server.
 */
export const CORRECTION_KINDS = ['error', 'suggestion'] as const;
export const ERROR_CATEGORIES = [
  'grammar',
  'spelling',
  'punctuation',
  'word_choice',
  'collocation',
  'register',
  'cohesion',
  'sentence_structure',
] as const;
export const CORRECTION_PRIORITIES = ['high', 'medium', 'low'] as const;

/** The parts of a task an assessor needs (no criteria lists the model could parrot back). */
export const writingTaskInputSchema = z
  .object({
    title: line(120),
    instructions: line(800),
    context: line(800),
    sourceText: z.string().max(WRITING_LIMITS.maxSourceTextChars).nullable(),
    format: writingFormatSchema,
    register: writingRegisterSchema,
    level: writingLevelSchema,
    wordCount: wordCountRangeSchema,
    requiredElements: z.array(line(200)).max(8),
  })
  .strict();
export type WritingTaskInput = z.infer<typeof writingTaskInputSchema>;

export function toWritingTaskInput(task: WritingTask): WritingTaskInput {
  return {
    title: task.title,
    instructions: task.instructions,
    context: task.context,
    sourceText: task.sourceText,
    format: task.format,
    register: task.register,
    level: task.level,
    wordCount: task.wordCount,
    requiredElements: task.requiredElements,
  };
}

export const writingAssessmentRequestSchema = z
  .object({
    task: writingTaskInputSchema,
    /** The learner's text. Untrusted. */
    text: z.string().max(WRITING_LIMITS.maxTextChars),
  })
  .strict()
  .superRefine((value, context) => {
    if (countWords(value.text) < WRITING_LIMITS.minWordsForAssessment) {
      context.addIssue({ code: 'custom', path: ['text'], message: `Write at least ${WRITING_LIMITS.minWordsForAssessment} words before asking for feedback.` });
    }
  });
export type WritingAssessmentRequest = z.infer<typeof writingAssessmentRequestSchema>;

const dimensionSchema = z
  .object({
    level: writingAssessmentLevelSchema,
    summary: line(600),
    strengths: z.array(line(300)).max(4),
  })
  .strict();

export const modelWritingCorrectionSchema = z
  .object({
    kind: z.enum(CORRECTION_KINDS),
    category: z.enum(ERROR_CATEGORIES),
    /** Copied exactly from the learner's text; verified on the server. */
    original: line(400),
    correction: line(400),
    explanation: line(600),
    priority: z.enum(CORRECTION_PRIORITIES),
    advancedAlternative: z.string().trim().min(1).max(400).nullable(),
  })
  .strict();
export type ModelWritingCorrection = z.infer<typeof modelWritingCorrectionSchema>;

export const modelWritingAssessmentSchema = z
  .object({
    overview: line(900),
    grammar: dimensionSchema,
    vocabulary: dimensionSchema,
    naturalness: dimensionSchema,
    coherence: dimensionSchema,
    taskAchievement: dimensionSchema,
    register: dimensionSchema,
    sentenceVariety: dimensionSchema,
    requiredElements: z
      .array(z.object({ element: line(200), addressed: z.boolean(), comment: line(300) }).strict())
      .max(8),
    priorities: z.array(line(300)).min(1).max(4),
    /** Checked individually so one bad item doesn't sink the assessment. */
    corrections: z.array(z.unknown()).max(60),
  })
  .strict();
export type ModelWritingAssessment = z.infer<typeof modelWritingAssessmentSchema>;

export const writingCorrectionSchema = modelWritingCorrectionSchema
  .extend({
    id: z.string().min(1).max(16),
    /** Character offsets of `original` in the submitted text (verified). */
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();
export type WritingCorrection = z.infer<typeof writingCorrectionSchema>;

export const writingAssessmentSchema = modelWritingAssessmentSchema
  .omit({ corrections: true })
  .extend({
    corrections: z.array(writingCorrectionSchema).max(WRITING_LIMITS.maxCorrections),
    /** Corrections dropped: quote not found, no real change, or inconsistent classification. */
    discarded: z.number().int().nonnegative(),
  })
  .strict();
export type WritingAssessment = z.infer<typeof writingAssessmentSchema>;

export const writingAssessmentResponseSchema = z
  .object({ provider: z.literal('groq'), model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), assessment: writingAssessmentSchema })
  .strict();
export type WritingAssessmentResponse = z.infer<typeof writingAssessmentResponseSchema>;

// --- Optional improved version ------------------------------------------------------------

export const writingImprovementRequestSchema = z
  .object({
    task: writingTaskInputSchema,
    text: z.string().max(WRITING_LIMITS.maxTextChars),
    /** The verified corrections the learner saw, so the rewrite stays consistent with them. */
    corrections: z.array(z.object({ original: line(400), correction: line(400) }).strict()).max(WRITING_LIMITS.maxCorrections),
  })
  .strict()
  .superRefine((value, context) => {
    if (countWords(value.text) < WRITING_LIMITS.minWordsForAssessment) {
      context.addIssue({ code: 'custom', path: ['text'], message: 'The text is too short to improve.' });
    }
  });
export type WritingImprovementRequest = z.infer<typeof writingImprovementRequestSchema>;

export const modelWritingImprovementSchema = z
  .object({
    improvedText: z.string().trim().min(1).max(WRITING_LIMITS.maxTextChars * 1.5),
    /** What changed and why, briefly. */
    notes: z.array(line(300)).min(1).max(8),
  })
  .strict();

export const writingImprovementResponseSchema = z
  .object({
    provider: z.literal('groq'),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
    improvedText: z.string().min(1),
    notes: z.array(line(300)).min(1).max(8),
  })
  .strict();
export type WritingImprovementResponse = z.infer<typeof writingImprovementResponseSchema>;

// --- Stored records (IndexedDB) --------------------------------------------------------

export const WRITING_RECORD_VERSION = 1;

export const writingTaskRecordSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(WRITING_RECORD_VERSION),
  task: writingTaskSchema,
  category: writingCategorySchema,
  /** Present for AI-generated tasks; null if the learner wrote the task themselves. */
  model: z.string().min(1).max(100).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type WritingTaskRecord = z.infer<typeof writingTaskRecordSchema>;

/** One draft per task, keyed by task id: no duplicate copies of the same work. */
export const writingDraftSchema = z.object({
  taskId: z.string().min(1).max(128),
  version: z.literal(WRITING_RECORD_VERSION),
  text: z.string().max(WRITING_LIMITS.maxTextChars),
  /** Time spent with the optional timer running. */
  timerElapsedMs: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type WritingDraft = z.infer<typeof writingDraftSchema>;

export const writingAttemptSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(WRITING_RECORD_VERSION),
  taskId: z.string().min(1).max(128),
  /** The task as it was when submitted, so an attempt still makes sense if the task is edited or deleted. */
  task: writingTaskSchema,
  text: z.string().max(WRITING_LIMITS.maxTextChars),
  wordCount: z.number().int().nonnegative(),
  timerElapsedMs: z.number().int().nonnegative(),
  assessment: z.object({ model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), result: writingAssessmentSchema }).nullable(),
  improvement: z
    .object({ model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), improvedText: z.string().min(1), notes: z.array(z.string()) })
    .nullable(),
  submittedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type WritingAttempt = z.infer<typeof writingAttemptSchema>;

// --- Word counting (shared by editor, validation and assessment) ----------------------------

const WORD = /[\p{L}\p{N}]/u;

/**
 * Words as exam boards count them: whitespace-separated tokens that contain
 * a letter or digit. "well-known" and "don't" are one word each; dashes and
 * stray punctuation are not words.
 */
export function countWords(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/)) if (WORD.test(token)) count += 1;
  return count;
}

export type WordCountStatus = 'empty' | 'under' | 'within' | 'over';

export function wordCountStatus(words: number, range: Pick<WordCountRange, 'min' | 'max'>): WordCountStatus {
  if (words === 0) return 'empty';
  if (words < range.min) return 'under';
  if (words > range.max) return 'over';
  return 'within';
}
