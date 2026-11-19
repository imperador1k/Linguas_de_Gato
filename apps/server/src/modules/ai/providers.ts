import type { AiProviderId, LanguageCode, Transcript } from '@ldg/shared';
import type { AppConfig } from '../../config/env.js';

/**
 * Provider abstraction for AI features. Routes depend on these interfaces,
 * never on a vendor SDK, so Groq can be replaced or complemented later.
 */

export interface TranscriptionRequest {
  readonly audio: Buffer;
  readonly fileName: string;
  readonly mimeType: string;
  readonly language: LanguageCode;
}

export interface TranscriptionProvider {
  readonly id: AiProviderId;
  readonly maxUploadBytes: number;
  transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<Transcript>;
}

export interface AiProviders {
  /** Which vendor has credentials configured, regardless of feature support. */
  readonly configuredProvider: AiProviderId | null;
  /** Null until an implementation exists and is configured (milestone M2). */
  readonly transcription: TranscriptionProvider | null;
}

/** Groq's documented upload limit for speech-to-text on the free tier. Re-verify in M2. */
export const DEFAULT_TRANSCRIPTION_UPLOAD_BYTES = 25 * 1024 ** 2;

export function createAiProviders(config: Pick<AppConfig, 'groqApiKey'>): AiProviders {
  return {
    configuredProvider: config.groqApiKey ? 'groq' : null,
    transcription: null,
  };
}
