import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';

/** Contract for the planned `POST /api/transcriptions` endpoint (milestone M2). */

export const timedTextSchema = z.object({
  id: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});

export type TimedText = z.infer<typeof timedTextSchema>;

export const transcriptSchema = z.object({
  language: languageCodeSchema,
  durationSeconds: z.number().nonnegative(),
  text: z.string(),
  segments: z.array(timedTextSchema),
  sentences: z.array(timedTextSchema),
});

export type Transcript = z.infer<typeof transcriptSchema>;
