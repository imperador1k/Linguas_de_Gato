import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const aiProviderIdSchema = z.enum(['groq']);

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

/**
 * `configured` means credentials are present on the server; `available`
 * means the feature is implemented *and* configured. The UI must only offer
 * a feature when `available` is true.
 */
const aiFeatureSchema = z.object({
  available: z.boolean(),
  configured: z.boolean(),
  provider: aiProviderIdSchema.nullable(),
});

export const capabilitiesResponseSchema = z.object({
  targetLanguages: z.array(languageCodeSchema),
  transcription: aiFeatureSchema.extend({
    maxUploadBytes: z.number().int().positive(),
  }),
  feedback: aiFeatureSchema,
  /** AI exercise generation (speaking tasks, listening questions). */
  exerciseGeneration: aiFeatureSchema,
});

export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;
