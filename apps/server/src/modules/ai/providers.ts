import type { AiProviderId, TranscriptionModel, TranscriptionResult } from '@ldg/shared';
import type { AppConfig } from '../../config/env.js';
import { GroqTranscriptionProvider } from './groq-transcription.js';

/**
 * Provider abstraction for AI features. Routes depend on these interfaces,
 * never on a vendor API, so Groq can be replaced or complemented later.
 */

export interface TranscriptionRequest {
  /** Server-side temporary file; the caller owns and deletes it. */
  readonly filePath: string;
  /** Name sent to the provider (its extension tells the provider the format). */
  readonly fileName: string;
  readonly mimeType: string;
  readonly model: TranscriptionModel;
  /** ISO-639-1 code, or null to let the model detect the language. */
  readonly language: 'en' | null;
}

export interface TranscriptionProvider {
  readonly id: AiProviderId;
  readonly maxUploadBytes: number;
  /**
   * Rejects with `AppError` for provider failures. If `signal` aborts for a
   * reason other than a timeout, rejects with that reason unchanged.
   */
  transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<TranscriptionResult>;
}

export interface AiProviders {
  /** Which vendor has credentials configured, regardless of feature support. */
  readonly configuredProvider: AiProviderId | null;
  /** Null when no provider is configured. */
  readonly transcription: TranscriptionProvider | null;
}

export interface AiProviderDependencies {
  /** Injected in tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export function createAiProviders(
  config: Pick<AppConfig, 'groqApiKey' | 'groqBaseUrl' | 'transcription'>,
  dependencies: AiProviderDependencies = {},
): AiProviders {
  if (!config.groqApiKey) return { configuredProvider: null, transcription: null };

  return {
    configuredProvider: 'groq',
    transcription: new GroqTranscriptionProvider({
      apiKey: config.groqApiKey,
      baseUrl: config.groqBaseUrl,
      maxUploadBytes: config.transcription.maxUploadBytes,
      fetch: dependencies.fetch ?? globalThis.fetch,
    }),
  };
}
