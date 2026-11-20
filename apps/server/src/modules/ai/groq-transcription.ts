import { openAsBlob } from 'node:fs';
import {
  transcriptionResultSchema,
  type TimedWord,
  type TranscriptionModel,
  type TranscriptionResult,
  type TranscriptSegment,
} from '@ldg/shared';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import { abortOr, errorFromGroqResponse, type GroqErrorMessages } from './groq-http.js';
import type { TranscriptionProvider, TranscriptionRequest } from './providers.js';

export { safeProviderDetail } from './groq-http.js';

/**
 * Groq speech-to-text over its OpenAI-compatible REST endpoint
 * (https://console.groq.com/docs/speech-to-text).
 *
 * Direct HTTP instead of the `groq-sdk` package, deliberately:
 * - the upload streams from the temp file (`fs.openAsBlob`), never fully in memory;
 * - the SDK retries 408/409/429/5xx twice by default, which would silently
 *   re-upload up to 100 MB while the learner waits; failures here are reported
 *   once, clearly, and the learner decides whether to retry;
 * - abort and timeout semantics stay explicit;
 * - the SDK's response type doesn't model word timestamps, so we validate the
 *   response with our own schema either way.
 */

/** Provider response (`response_format=verbose_json`). Lenient on optional fields, strict on types. */
const groqWordSchema = z.object({ word: z.string(), start: z.number(), end: z.number() });
const groqSegmentSchema = z.object({
  id: z.number().int().optional(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  avg_logprob: z.number().optional().nullable(),
  no_speech_prob: z.number().optional().nullable(),
});
export const groqVerboseTranscriptionSchema = z.object({
  text: z.string(),
  language: z.string().optional().nullable(),
  duration: z.number().optional().nullable(),
  segments: z.array(groqSegmentSchema).optional().nullable(),
  words: z.array(groqWordSchema).optional().nullable(),
});
export type GroqVerboseTranscription = z.infer<typeof groqVerboseTranscriptionSchema>;

const MESSAGES: GroqErrorMessages = {
  badRequest: "Groq couldn't process this file. It may be damaged, too short, or contain no audio track.",
  tooLarge: 'Groq rejected the file as too large for your plan.',
};
const TIMEOUT_MESSAGE = 'Transcription took too long and was stopped. Try a shorter file.';

function toMs(seconds: number): number | null {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : null;
}

/** Maps the provider's shape onto ours: milliseconds, trimmed text, sorted, no malformed entries. */
export function normalizeGroqTranscription(
  raw: GroqVerboseTranscription,
  request: { model: TranscriptionModel; language: 'en' | null },
): TranscriptionResult {
  const segments: TranscriptSegment[] = [];
  for (const segment of raw.segments ?? []) {
    const startMs = toMs(segment.start);
    const endMs = toMs(segment.end);
    const text = segment.text.trim();
    if (startMs === null || endMs === null || text === '') continue;
    const noSpeech = segment.no_speech_prob;
    segments.push({
      id: '',
      startMs,
      endMs: Math.max(endMs, startMs),
      text,
      avgLogprob: typeof segment.avg_logprob === 'number' && Number.isFinite(segment.avg_logprob) ? segment.avg_logprob : null,
      noSpeechProb: typeof noSpeech === 'number' && noSpeech >= 0 && noSpeech <= 1 ? noSpeech : null,
    });
  }
  segments.sort((a, b) => a.startMs - b.startMs);
  segments.forEach((segment, index) => {
    segment.id = String(index + 1);
  });

  const words: TimedWord[] = [];
  for (const word of raw.words ?? []) {
    const startMs = toMs(word.start);
    const endMs = toMs(word.end);
    const text = word.word.trim();
    // A word that ends before it starts is unusable for timing; drop it rather than guess.
    if (startMs === null || endMs === null || endMs < startMs || text === '') continue;
    words.push({ text, startMs, endMs });
  }
  words.sort((a, b) => a.startMs - b.startMs);

  const language = raw.language?.trim().slice(0, 64);
  const duration = raw.duration;

  // Final guard: never hand anything to the client that doesn't match the contract.
  return transcriptionResultSchema.parse({
    provider: 'groq',
    model: request.model,
    requestedLanguage: request.language,
    detectedLanguage: language ? language : null,
    durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : null,
    text: raw.text.trim(),
    segments,
    words,
  });
}

export interface GroqTranscriptionOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly maxUploadBytes: number;
  readonly fetch: typeof fetch;
}

export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'groq' as const;
  readonly maxUploadBytes: number;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: GroqTranscriptionOptions) {
    // A private field keeps the key out of accidental serialisation (logs, JSON.stringify).
    this.#apiKey = options.apiKey;
    this.#endpoint = `${options.baseUrl}/audio/transcriptions`;
    this.#fetch = options.fetch;
    this.maxUploadBytes = options.maxUploadBytes;
  }

  async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<TranscriptionResult> {
    const form = new FormData();
    // Text fields first, file last (mirrors the documented parameter set).
    form.append('model', request.model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    if (request.language) form.append('language', request.language);
    form.append('file', await openAsBlob(request.filePath, { type: request.mimeType }), request.fileName);

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json' },
        body: form,
        signal,
      });
    } catch {
      throw abortOr(signal, TIMEOUT_MESSAGE, () => new AppError('PROVIDER_UNAVAILABLE', "Couldn't reach Groq. Check your internet connection.", 503));
    }

    if (!response.ok) throw await errorFromGroqResponse(response, this.#apiKey, MESSAGES);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw abortOr(signal, TIMEOUT_MESSAGE, () => new AppError('PROVIDER_ERROR', 'Groq returned a response that is not valid JSON.', 502));
    }

    const parsed = groqVerboseTranscriptionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('PROVIDER_ERROR', 'Groq returned a transcript in an unexpected format.', 502);
    }
    try {
      return normalizeGroqTranscription(parsed.data, request);
    } catch {
      throw new AppError('PROVIDER_ERROR', 'Groq returned a transcript in an unexpected format.', 502);
    }
  }
}
