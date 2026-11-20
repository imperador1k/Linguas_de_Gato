import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';
import { timedWordSchema, transcriptionModelSchema } from './transcription.js';

/**
 * Speaking Lab (milestone M3): prompts, the assessment API contract, the raw
 * model output, the verified assessment, and the attempt record stored in
 * IndexedDB. One place for every limit, so client and server agree.
 */

export const SPEAKING_LIMITS = {
  /** Recording auto-stops here. */
  maxRecordingMs: 180_000,
  /** Shorter recordings rarely contain enough speech to assess. */
  minRecordingMs: 3_000,
  /** ~180 s of fast speech is ~550 words (~3,300 characters); generous headroom. */
  maxTranscriptChars: 8_000,
  /** Fewer words than this can't support evidence-based feedback. */
  minWords: 20,
  maxSegments: 200,
  maxSegmentChars: 1_000,
  maxTitleChars: 120,
  maxInstructionsChars: 600,
  maxPoints: 6,
  maxPointChars: 200,
} as const;

export const SPEAKING_CATEGORIES = ['technology', 'work', 'culture', 'education', 'science', 'society', 'everyday'] as const;
export const speakingCategorySchema = z.enum(SPEAKING_CATEGORIES);
export type SpeakingCategory = z.infer<typeof speakingCategorySchema>;

/** C2 is used by AI-generated topics; the curated library covers B2 and C1. */
export const SPEAKING_LEVELS = ['B2', 'C1', 'C2'] as const;
export const speakingLevelSchema = z.enum(SPEAKING_LEVELS);
export type SpeakingLevel = z.infer<typeof speakingLevelSchema>;

export const SPEAKING_MODES = ['free', 'guided'] as const;
export const speakingModeSchema = z.enum(SPEAKING_MODES);
export type SpeakingMode = z.infer<typeof speakingModeSchema>;

export const TARGET_DURATIONS_SECONDS = [30, 60, 120, 180] as const;
export const targetDurationSchema = z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(180)]);
export type TargetDurationSeconds = z.infer<typeof targetDurationSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);

export const speakingPromptSchema = z
  .object({
    source: z.enum(['library', 'custom']),
    promptId: z.string().max(64).nullable(),
    title: text(SPEAKING_LIMITS.maxTitleChars),
    instructions: text(SPEAKING_LIMITS.maxInstructionsChars),
    points: z.array(text(SPEAKING_LIMITS.maxPointChars)).max(SPEAKING_LIMITS.maxPoints),
    category: speakingCategorySchema,
    level: speakingLevelSchema.nullable(),
  })
  .strict();
export type SpeakingPrompt = z.infer<typeof speakingPromptSchema>;

/** A transcript segment after the learner's review. `recognizedText` is what Whisper heard. */
export const reviewedSegmentSchema = z
  .object({
    id: z.string().min(1).max(16),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    recognizedText: z.string().max(SPEAKING_LIMITS.maxSegmentChars),
    text: z.string().max(SPEAKING_LIMITS.maxSegmentChars),
  })
  .strict();
export type ReviewedSegment = z.infer<typeof reviewedSegmentSchema>;

export function transcriptFromSegments(segments: readonly Pick<ReviewedSegment, 'text'>[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
}

/** Body of `POST /api/speaking/assessments` (JSON; the global 1 MB limit applies). */
export const assessmentRequestSchema = z
  .object({
    prompt: speakingPromptSchema,
    mode: speakingModeSchema,
    targetDurationSeconds: targetDurationSchema,
    recordingDurationMs: z.number().int().nonnegative().max(SPEAKING_LIMITS.maxRecordingMs + 5_000),
    segments: z
      .array(reviewedSegmentSchema.pick({ id: true, startMs: true, endMs: true, text: true }).strict())
      .min(1)
      .max(SPEAKING_LIMITS.maxSegments),
  })
  .strict()
  .superRefine((value, context) => {
    const transcript = transcriptFromSegments(value.segments);
    if (transcript.length > SPEAKING_LIMITS.maxTranscriptChars) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: `The transcript is longer than ${SPEAKING_LIMITS.maxTranscriptChars} characters.`,
      });
    }
    const words = transcript.split(/\s+/).filter(Boolean).length;
    if (words < SPEAKING_LIMITS.minWords) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: `At least ${SPEAKING_LIMITS.minWords} words are needed for meaningful feedback.`,
      });
    }
    if (new Set(value.segments.map((segment) => segment.id)).size !== value.segments.length) {
      context.addIssue({ code: 'custom', path: ['segments'], message: 'Segment ids must be unique.' });
    }
  });
export type AssessmentRequest = z.infer<typeof assessmentRequestSchema>;

// --- Assessment -----------------------------------------------------------

/** Qualitative only: no scores, no CEFR labels the evidence can't support. */
export const ASSESSMENT_LEVELS = ['strong', 'developing', 'needs_attention'] as const;
export const assessmentLevelSchema = z.enum(ASSESSMENT_LEVELS);
export type AssessmentLevel = z.infer<typeof assessmentLevelSchema>;

export const ISSUE_CATEGORIES = ['grammar', 'vocabulary', 'coherence', 'naturalness', 'task'] as const;
export const issueCategorySchema = z.enum(ISSUE_CATEGORIES);
export type IssueCategory = z.infer<typeof issueCategorySchema>;

export const EXERCISE_TYPES = ['correct_the_error', 'natural_collocation', 'reformulate', 'linking', 'develop_argument'] as const;
export const exerciseTypeSchema = z.enum(EXERCISE_TYPES);
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;

const feedbackText = (max = 600) => z.string().trim().min(1).max(max);

const dimensionSchema = z
  .object({
    level: assessmentLevelSchema,
    summary: feedbackText(),
    strengths: z.array(feedbackText(300)).max(5),
  })
  .strict();
export type AssessmentDimension = z.infer<typeof dimensionSchema>;

const taskAchievementSchema = z
  .object({
    level: assessmentLevelSchema,
    summary: feedbackText(),
    addressedPoints: z.array(feedbackText(300)).max(8),
    missedPoints: z.array(feedbackText(300)).max(8),
  })
  .strict();

const modelIssueSchema = z
  .object({
    category: issueCategorySchema,
    /** e.g. "verb tense", "article", "collocation", "register", "linking". */
    subcategory: feedbackText(60),
    segmentId: z.string().min(1).max(16),
    /** Exact words from the transcript. Verified on the server. */
    original: feedbackText(300),
    correction: feedbackText(300),
    explanation: feedbackText(),
    /** Only when a more sophisticated phrasing is genuinely more natural. */
    advancedAlternative: z.string().trim().max(300).nullable(),
    severity: z.enum(['major', 'minor']),
  })
  .strict();

const modelPatternSchema = z
  .object({
    pattern: feedbackText(200),
    explanation: feedbackText(),
    segmentIds: z.array(z.string().min(1).max(16)).min(1).max(10),
  })
  .strict();

const modelExerciseSchema = z
  .object({
    type: exerciseTypeSchema,
    focus: feedbackText(120),
    instruction: feedbackText(300),
    /** The learner's own words the exercise starts from. Verified on the server. */
    sourceQuote: feedbackText(300),
    sourceSegmentId: z.string().min(1).max(16),
    modelAnswer: feedbackText(600),
  })
  .strict();

/** What the model must return (before evidence verification). */
export const modelAssessmentSchema = z
  .object({
    overview: feedbackText(800),
    taskAchievement: taskAchievementSchema,
    grammar: dimensionSchema,
    vocabulary: dimensionSchema,
    coherence: dimensionSchema,
    naturalness: dimensionSchema,
    issues: z.array(modelIssueSchema).max(25),
    recurringPatterns: z.array(modelPatternSchema).max(6),
    exercises: z.array(modelExerciseSchema).max(6),
  })
  .strict();
export type ModelAssessment = z.infer<typeof modelAssessmentSchema>;

/** Verified issue: its quote was found in the transcript, and it carries that segment's timing. */
export const assessmentIssueSchema = modelIssueSchema.extend({ startMs: z.number().int().nonnegative() }).strict();
export type AssessmentIssue = z.infer<typeof assessmentIssueSchema>;

export const assessmentExerciseSchema = modelExerciseSchema
  .extend({ id: z.string().min(1).max(16), startMs: z.number().int().nonnegative() })
  .strict();
export type AssessmentExercise = z.infer<typeof assessmentExerciseSchema>;

export const speakingAssessmentSchema = modelAssessmentSchema
  .extend({
    issues: z.array(assessmentIssueSchema).max(25),
    exercises: z.array(assessmentExerciseSchema).max(6),
    /** Model claims whose quotes weren't found in the transcript (dropped, never shown as fact). */
    discarded: z.object({ issues: z.number().int().nonnegative(), exercises: z.number().int().nonnegative() }).strict(),
  })
  .strict();
export type SpeakingAssessment = z.infer<typeof speakingAssessmentSchema>;

export const assessmentResponseSchema = z
  .object({
    provider: z.literal('groq'),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
    assessment: speakingAssessmentSchema,
  })
  .strict();
export type AssessmentResponse = z.infer<typeof assessmentResponseSchema>;

// --- Fluency (deterministic, computed in the browser from timestamps) -------

export const pauseEventSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type PauseEvent = z.infer<typeof pauseEventSchema>;

export const fluencyMetricsSchema = z.object({
  wordCount: z.number().int().nonnegative(),
  speakingTimeMs: z.number().int().nonnegative(),
  recordingDurationMs: z.number().int().nonnegative(),
  /** Null when there is too little timed speech to estimate. */
  wordsPerMinute: z.number().nonnegative().nullable(),
  timingSource: z.enum(['words', 'segments', 'none']),
  pauses: z.object({
    thresholdMs: z.number().int().positive(),
    longThresholdMs: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    longCount: z.number().int().nonnegative(),
    totalMs: z.number().int().nonnegative(),
    longestMs: z.number().int().nonnegative(),
    longest: z.array(pauseEventSchema).max(5),
  }),
  repetitions: z.object({ count: z.number().int().nonnegative(), examples: z.array(z.string()).max(5) }),
  fillers: z.object({
    count: z.number().int().nonnegative(),
    items: z.array(z.object({ text: z.string(), count: z.number().int().positive() })).max(12),
  }),
});
export type FluencyMetrics = z.infer<typeof fluencyMetricsSchema>;

// --- Stored attempt (IndexedDB) ---------------------------------------------

export const SPEAKING_RECORD_VERSION = 1;

export const exerciseResponseSchema = z.object({
  exerciseId: z.string().min(1).max(16),
  answer: z.string().max(2_000),
  revealed: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;

export const speakingAttemptSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.literal(SPEAKING_RECORD_VERSION),
  language: languageCodeSchema,
  prompt: speakingPromptSchema,
  mode: speakingModeSchema,
  targetDurationSeconds: targetDurationSchema,
  recordingDurationMs: z.number().int().nonnegative(),
  transcript: z.object({
    segments: z.array(reviewedSegmentSchema).max(SPEAKING_LIMITS.maxSegments),
    /** Whisper's word timings (acoustic; unaffected by the learner's text corrections). */
    words: z.array(timedWordSchema),
    model: transcriptionModelSchema,
    detectedLanguage: z.string().max(64).nullable(),
  }),
  fluency: fluencyMetricsSchema,
  assessment: z
    .object({ model: z.string().min(1).max(100), createdAt: z.number().int().nonnegative(), result: speakingAssessmentSchema })
    .nullable(),
  exerciseResponses: z.array(exerciseResponseSchema).max(12),
  recording: z.object({ stored: z.boolean(), mimeType: z.string().max(100) }),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SpeakingAttempt = z.infer<typeof speakingAttemptSchema>;

// --- AI-generated topics ---------------------------------------------------

export const SPEAKING_EXERCISE_FORMATS = ['free', 'guided', 'debate', 'critical_thinking'] as const;
export const speakingExerciseFormatSchema = z.enum(SPEAKING_EXERCISE_FORMATS);
export type SpeakingExerciseFormat = z.infer<typeof speakingExerciseFormatSchema>;

export const SPEAKING_SKILL_FOCUSES = [
  'lexical_range',
  'grammatical_range',
  'coherence',
  'argumentation',
  'register_and_tone',
  'hedging_and_nuance',
] as const;
export const speakingSkillFocusSchema = z.enum(SPEAKING_SKILL_FOCUSES);
export type SpeakingSkillFocus = z.infer<typeof speakingSkillFocusSchema>;

export const vocabularyItemSchema = z
  .object({
    expression: z.string().trim().min(1).max(80),
    meaning: z.string().trim().min(1).max(200),
    example: z.string().trim().min(1).max(240),
  })
  .strict();
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

/** What a generated topic keeps beyond the prompt itself. */
export const generatedSpeakingDetailsSchema = z
  .object({
    level: speakingLevelSchema,
    format: speakingExerciseFormatSchema,
    skillFocus: speakingSkillFocusSchema.nullable(),
    targetDurationSeconds: targetDurationSchema,
    /** How to approach the task (the central question lives in `prompt.instructions`). */
    guidance: z.string().trim().min(1).max(600),
    followUpQuestions: z.array(z.string().trim().min(1).max(200)).max(5),
    vocabulary: z.array(vocabularyItemSchema).max(12),
    objectives: z.array(z.string().trim().min(1).max(200)).max(4),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type GeneratedSpeakingDetails = z.infer<typeof generatedSpeakingDetailsSchema>;

/** A learner-created or AI-generated topic, kept for reuse. */
export const customTopicSchema = z.object({
  id: z.string().min(1).max(128),
  prompt: speakingPromptSchema,
  createdAt: z.number().int().nonnegative(),
  /** Present for topics made with "Generate with AI" (optional: older topics stay valid). */
  generated: generatedSpeakingDetailsSchema.optional(),
});
export type CustomTopicDraft = Pick<z.infer<typeof customTopicSchema>, 'prompt' | 'generated'>;
export type CustomTopic = z.infer<typeof customTopicSchema>;
