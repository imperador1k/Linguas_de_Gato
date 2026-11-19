import { z } from 'zod';

/**
 * Contract for `POST /api/transcriptions` (milestone M2).
 *
 * Request: `multipart/form-data` with text fields `model` and `language`
 * placed BEFORE the `file` part (the server parses the stream in order).
 * Response: a provider-neutral `TranscriptionResult`.
 */

export const TRANSCRIPTION_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'] as const;
export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo' satisfies (typeof TRANSCRIPTION_MODELS)[number];

export const transcriptionModelSchema = z.enum(TRANSCRIPTION_MODELS);
export type TranscriptionModel = z.infer<typeof transcriptionModelSchema>;

/** Learner-facing description of each model; the IDs stay an implementation detail. */
export const TRANSCRIPTION_MODEL_INFO: Readonly<
  Record<TranscriptionModel, { readonly label: string; readonly description: string }>
> = {
  'whisper-large-v3-turbo': { label: 'Fast', description: 'Whisper Large v3 Turbo. Quick and accurate for clear speech.' },
  'whisper-large-v3': {
    label: 'Higher accuracy',
    description: 'Whisper Large v3. Slower, better with accents, noise and specialist vocabulary.',
  },
};

/** `auto` omits the language so the model detects it. */
export const TRANSCRIPTION_LANGUAGES = ['en', 'auto'] as const;
export const transcriptionLanguageSchema = z.enum(TRANSCRIPTION_LANGUAGES);
export type TranscriptionLanguage = z.infer<typeof transcriptionLanguageSchema>;

export const transcriptionOptionsSchema = z
  .object({
    model: transcriptionModelSchema.default(DEFAULT_TRANSCRIPTION_MODEL),
    language: transcriptionLanguageSchema.default('en'),
  })
  .strict();
export type TranscriptionOptions = z.infer<typeof transcriptionOptionsSchema>;

const millisecondsSchema = z.number().int().nonnegative();

export const timedWordSchema = z.object({
  text: z.string().min(1),
  startMs: millisecondsSchema,
  endMs: millisecondsSchema,
});
export type TimedWord = z.infer<typeof timedWordSchema>;

export const transcriptSegmentSchema = z.object({
  id: z.string().min(1),
  startMs: millisecondsSchema,
  endMs: millisecondsSchema,
  text: z.string(),
  /** Mean token log-probability; lower means less confident. Null when not reported. */
  avgLogprob: z.number().nullable(),
  /** Probability the segment contains no speech. Null when not reported. */
  noSpeechProb: z.number().min(0).max(1).nullable(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptionResultSchema = z.object({
  provider: z.literal('groq'),
  model: transcriptionModelSchema,
  /** The language we asked for, or null for automatic detection. */
  requestedLanguage: z.literal('en').nullable(),
  /** As reported by the provider (e.g. "English"); null when absent. */
  detectedLanguage: z.string().min(1).max(64).nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  text: z.string(),
  segments: z.array(transcriptSegmentSchema),
  /** Empty when the provider didn't return word timestamps. */
  words: z.array(timedWordSchema),
});
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;
