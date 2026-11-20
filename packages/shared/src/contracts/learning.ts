import { z } from 'zod';

/**
 * Personal Learning Engine contracts (M6). Analytics are derived on demand
 * from module records; only the learner's decisions are stored:
 * recommendation status and a log of targeted training they generated.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

/**
 * A bounded learning profile sent with a targeted generation request: one
 * category and at most five real examples. The full history never leaves
 * the browser.
 */
export const targetedPracticeSchema = z
  .object({
    focus: line(80),
    description: line(240),
    /** Real mistakes (optional, at the learner's choice), clipped. */
    examples: z
      .array(z.object({ original: z.string().trim().max(200), corrected: z.string().trim().max(200) }).strict())
      .max(5),
  })
  .strict();
export type TargetedPractice = z.infer<typeof targetedPracticeSchema>;

export const LEARNING_RECORD_VERSION = 1;

export const recommendationStateSchema = z
  .object({
    /** The recommendation's deterministic id. */
    id: z.string().min(1).max(160),
    version: z.literal(LEARNING_RECORD_VERSION),
    status: z.enum(['dismissed', 'completed']),
    /** The newest evidence when the learner acted; newer evidence brings the recommendation back. */
    evidenceAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RecommendationState = z.infer<typeof recommendationStateSchema>;

export const TRAINING_MODULES = ['grammar', 'writing', 'speaking'] as const;
export const trainingModuleSchema = z.enum(TRAINING_MODULES);
export type TrainingModule = z.infer<typeof trainingModuleSchema>;

export const trainingSessionSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.literal(LEARNING_RECORD_VERSION),
    category: z.string().min(1).max(60),
    module: trainingModuleSchema,
    level: z.enum(['B2', 'C1', 'C2']),
    /** The record created in the module's own store (grammar set, writing task, speaking topic). */
    recordId: z.string().min(1).max(128),
    title: z.string().min(1).max(160),
    includedExamples: z.number().int().min(0).max(5),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type TrainingSession = z.infer<typeof trainingSessionSchema>;
