import { z } from 'zod';
import {
  speakingCategorySchema,
  speakingExerciseFormatSchema,
  speakingLevelSchema,
  speakingSkillFocusSchema,
  targetDurationSchema,
  vocabularyItemSchema,
} from './speaking.js';
import { grammarGenerationRequestSchema, grammarSetSchema } from './grammar.js';
import { targetedPracticeSchema } from './learning.js';
import { writingGenerationRequestSchema, writingTaskSchema } from './writing.js';
import {
  READING_LIMITS,
  readingGenerationRequestSchema,
  readingGenerationResultSchema,
  readingQuestionSchema,
  readingQuestionsRequestSchema,
} from './reading.js';
import { VOCABULARY_LIMITS, vocabularyPracticeRequestSchema, vocabularyQuestionSchema } from './vocabulary.js';

/**
 * AI exercise generation (shared by learning modules).
 *
 * `POST /api/exercises/generate` takes a request discriminated by `kind`;
 * each kind has its own request, model-output and result schema, so every
 * module can represent its exercises precisely instead of squeezing them
 * into one generic shape. A future module (writing, grammar, reading,
 * vocabulary) adds its own entries to the two unions below and a generator
 * on the server.
 *
 * Generated content is practice material, not a certified CEFR assessment.
 */

export const GENERATION_LEVELS = ['B2', 'C1', 'C2'] as const;
export const generationLevelSchema = z.enum(GENERATION_LEVELS);
export type GenerationLevel = z.infer<typeof generationLevelSchema>;

const line = (max: number) => z.string().trim().min(1).max(max);

// --- Speaking -----------------------------------------------------------------

export const speakingGenerationRequestSchema = z
  .object({
    kind: z.literal('speaking'),
    level: speakingLevelSchema,
    category: speakingCategorySchema,
    /** The learner's own words: a topic or interest. Untrusted; used as a suggestion only. */
    interest: z.string().trim().max(300).nullable(),
    format: speakingExerciseFormatSchema,
    targetDurationSeconds: targetDurationSchema,
    skillFocus: speakingSkillFocusSchema.nullable(),
    /** Titles already shown in this session, so "Regenerate" gives something new. */
    avoidTitles: z.array(z.string().trim().max(120)).max(10),
    /** Personalized training (M6): one weakness and a few real examples. */
    targetedPractice: targetedPracticeSchema.nullable().optional(),
  })
  .strict();
export type SpeakingGenerationRequest = z.infer<typeof speakingGenerationRequestSchema>;

/** What the model must return for a speaking task. Deliberately no model answer. */
export const generatedSpeakingExerciseSchema = z
  .object({
    title: line(120),
    /** The central question or task, spoken to the learner. */
    centralPrompt: line(600),
    /** How to approach it (structure, what to include). */
    instructions: line(600),
    discussionPoints: z.array(line(200)).min(2).max(6),
    followUpQuestions: z.array(line(200)).max(5),
    vocabulary: z.array(vocabularyItemSchema).min(3).max(12),
    objectives: z.array(line(200)).min(1).max(4),
    level: speakingLevelSchema,
    format: speakingExerciseFormatSchema,
  })
  .strict();
export type GeneratedSpeakingExercise = z.infer<typeof generatedSpeakingExerciseSchema>;

// --- Listening --------------------------------------------------------------

export const LISTENING_QUESTION_TYPES = ['main_idea', 'detail', 'inference', 'speaker_intention', 'vocabulary_in_context'] as const;
export const listeningQuestionTypeSchema = z.enum(LISTENING_QUESTION_TYPES);
export type ListeningQuestionType = z.infer<typeof listeningQuestionTypeSchema>;

export const LISTENING_QUESTION_FORMATS = ['multiple_choice', 'short_answer'] as const;

export const LISTENING_GENERATION_LIMITS = {
  /** Roughly 25-30 minutes of speech; longer transcripts are trimmed by the client, which says so. */
  maxTranscriptChars: 24_000,
  minWords: 60,
  maxSegments: 800,
  maxSegmentChars: 1_200,
  minQuestions: 4,
  maxQuestions: 10,
} as const;

const segmentInputSchema = z
  .object({
    id: z.string().min(1).max(16),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string().max(LISTENING_GENERATION_LIMITS.maxSegmentChars),
  })
  .strict();

export const listeningGenerationRequestSchema = z
  .object({
    kind: z.literal('listening'),
    level: generationLevelSchema,
    questionCount: z.number().int().min(LISTENING_GENERATION_LIMITS.minQuestions).max(LISTENING_GENERATION_LIMITS.maxQuestions),
    types: z.array(listeningQuestionTypeSchema).min(1).max(LISTENING_QUESTION_TYPES.length),
    /** The saved transcript: the only factual source. Untrusted text. */
    segments: z.array(segmentInputSchema).min(1).max(LISTENING_GENERATION_LIMITS.maxSegments),
  })
  .strict()
  .superRefine((value, context) => {
    const text = value.segments.map((segment) => segment.text.trim()).join(' ');
    if (text.length > LISTENING_GENERATION_LIMITS.maxTranscriptChars) {
      context.addIssue({ code: 'custom', path: ['segments'], message: `The transcript is longer than ${LISTENING_GENERATION_LIMITS.maxTranscriptChars} characters.` });
    }
    if (text.split(/\s+/).filter(Boolean).length < LISTENING_GENERATION_LIMITS.minWords) {
      context.addIssue({ code: 'custom', path: ['segments'], message: `At least ${LISTENING_GENERATION_LIMITS.minWords} words of transcript are needed.` });
    }
    if (new Set(value.segments.map((segment) => segment.id)).size !== value.segments.length) {
      context.addIssue({ code: 'custom', path: ['segments'], message: 'Segment ids must be unique.' });
    }
    if (new Set(value.types).size !== value.types.length) {
      context.addIssue({ code: 'custom', path: ['types'], message: 'Question types must be unique.' });
    }
  });
export type ListeningGenerationRequest = z.infer<typeof listeningGenerationRequestSchema>;

/** One question as the model returns it; checked individually so one bad item doesn't sink the set. */
export const modelListeningQuestionSchema = z
  .object({
    type: listeningQuestionTypeSchema,
    format: z.enum(LISTENING_QUESTION_FORMATS),
    difficulty: generationLevelSchema,
    question: line(400),
    /** 3-4 options for multiple choice; empty for short answer. */
    options: z.array(line(200)).max(4),
    correctOptionIndex: z.number().int().min(0).max(3).nullable(),
    /** Accepted answers or criteria for short answer; empty for multiple choice. */
    acceptedAnswers: z.array(line(200)).max(5),
    explanation: line(600),
    /** Exact words from the transcript that support the answer. Verified on the server. */
    evidenceQuote: line(400),
    segmentIds: z.array(z.string().min(1).max(16)).max(6),
  })
  .strict();
export type ModelListeningQuestion = z.infer<typeof modelListeningQuestionSchema>;

const verifiedBase = {
  id: z.string().min(1).max(16),
  type: listeningQuestionTypeSchema,
  difficulty: generationLevelSchema,
  question: line(400),
  explanation: line(600),
  evidenceQuote: line(400),
  /** Segments the evidence actually spans (verified against the transcript). */
  segmentIds: z.array(z.string().min(1).max(16)).min(1).max(6),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
};

export const listeningQuestionSchema = z.discriminatedUnion('format', [
  z
    .object({
      ...verifiedBase,
      format: z.literal('multiple_choice'),
      options: z.array(line(200)).min(3).max(4),
      correctOptionIndex: z.number().int().min(0).max(3),
    })
    .strict(),
  z
    .object({
      ...verifiedBase,
      format: z.literal('short_answer'),
      acceptedAnswers: z.array(line(200)).min(1).max(5),
    })
    .strict(),
]);
export type ListeningQuestion = z.infer<typeof listeningQuestionSchema>;

// --- Request / response unions --------------------------------------------------

export const generationRequestSchema = z.discriminatedUnion('kind', [
  speakingGenerationRequestSchema,
  listeningGenerationRequestSchema,
  writingGenerationRequestSchema,
  grammarGenerationRequestSchema,
  readingGenerationRequestSchema,
  readingQuestionsRequestSchema,
  vocabularyPracticeRequestSchema,
]);
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export const generationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('speaking'), exercise: generatedSpeakingExerciseSchema }).strict(),
  z
    .object({
      kind: z.literal('listening'),
      questions: z.array(listeningQuestionSchema).min(1).max(LISTENING_GENERATION_LIMITS.maxQuestions),
      /** Model questions dropped because their evidence or structure didn't check out. */
      discarded: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('writing'), task: writingTaskSchema }).strict(),
  z
    .object({
      kind: z.literal('grammar'),
      set: grammarSetSchema,
      /** Model questions dropped as ambiguous, inconsistent or of an unrequested type. */
      discarded: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('reading'), text: readingGenerationResultSchema }).strict(),
  z
    .object({
      kind: z.literal('reading_questions'),
      questions: z.array(readingQuestionSchema).min(1).max(READING_LIMITS.maxQuestions),
      /** Questions dropped for unverifiable evidence, invalid references, copy-only answers or inconsistent structure. */
      discarded: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('vocabulary_practice'),
      questions: z.array(vocabularyQuestionSchema).min(1).max(VOCABULARY_LIMITS.maxQuestions),
      discarded: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type GenerationResult = z.infer<typeof generationResultSchema>;

export const generationResponseSchema = z
  .object({
    provider: z.literal('groq'),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
    result: generationResultSchema,
  })
  .strict();
export type GenerationResponse = z.infer<typeof generationResponseSchema>;

// --- Stored listening exercise set (IndexedDB) ------------------------------------

export const listeningAnswerSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('multiple_choice'), questionId: z.string().min(1).max(16), selectedIndex: z.number().int().min(0).max(3) }).strict(),
  z
    .object({
      format: z.literal('short_answer'),
      questionId: z.string().min(1).max(16),
      text: z.string().max(1_000),
      /** Short answers are self-assessed against the accepted answers after reveal. */
      selfAssessment: z.enum(['correct', 'partly', 'incorrect']).nullable(),
    })
    .strict(),
]);
export type ListeningAnswer = z.infer<typeof listeningAnswerSchema>;

export const LISTENING_SET_RECORD_VERSION = 1;

export const listeningExerciseSetSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(LISTENING_SET_RECORD_VERSION),
  sessionId: z.string().min(1).max(128),
  level: generationLevelSchema,
  types: z.array(listeningQuestionTypeSchema).min(1),
  questions: z.array(listeningQuestionSchema).min(1).max(LISTENING_GENERATION_LIMITS.maxQuestions),
  discarded: z.number().int().nonnegative(),
  /** Fingerprint of the transcript the set was generated from; a replaced transcript makes it stale. */
  transcriptFingerprint: z.string().min(1).max(32),
  /** True when only the beginning of a long transcript was used. */
  truncated: z.boolean(),
  model: z.string().min(1).max(100),
  answers: z.array(listeningAnswerSchema).max(LISTENING_GENERATION_LIMITS.maxQuestions),
  /** Set when the learner checks their answers; answers are locked afterwards. */
  submittedAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ListeningExerciseSet = z.infer<typeof listeningExerciseSetSchema>;
