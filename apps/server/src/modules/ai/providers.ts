import type {
  AiProviderId,
  AssessmentRequest,
  AssessmentResponse,
  GenerationRequest,
  GenerationResponse,
  TranscriptionModel,
  TranscriptionResult,
} from '@ldg/shared';
import type { AppConfig } from '../../config/env.js';
import { GroqExerciseGenerator } from './exercise-generation/groq-exercise-generator.js';
import { GroqAssessmentProvider } from './groq-assessment.js';
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

export interface SpeakingAssessmentProvider {
  readonly id: AiProviderId;
  readonly model: string;
  /**
   * Returns evidence-verified feedback. Same rejection contract as
   * `TranscriptionProvider.transcribe`.
   */
  assess(request: AssessmentRequest, signal: AbortSignal): Promise<AssessmentResponse>;
}

export interface ExerciseGenerationProvider {
  readonly id: AiProviderId;
  readonly model: string;
  /**
   * Returns validated (and, where the module requires it, evidence-verified)
   * exercises. Same rejection contract as `TranscriptionProvider.transcribe`.
   */
  generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResponse>;
}

export interface AiProviders {
  /** Which vendor has credentials configured, regardless of feature support. */
  readonly configuredProvider: AiProviderId | null;
  /** Null when no provider is configured. */
  readonly transcription: TranscriptionProvider | null;
  readonly assessment: SpeakingAssessmentProvider | null;
  readonly generation: ExerciseGenerationProvider | null;
}

export interface AiProviderDependencies {
  /** Injected in tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export function createAiProviders(
  config: Pick<AppConfig, 'groqApiKey' | 'groqBaseUrl' | 'transcription' | 'assessment'>,
  dependencies: AiProviderDependencies = {},
): AiProviders {
  if (!config.groqApiKey) return { configuredProvider: null, transcription: null, assessment: null, generation: null };
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const chat = {
    apiKey: config.groqApiKey,
    baseUrl: config.groqBaseUrl,
    model: config.assessment.model,
    responseFormat: config.assessment.responseFormat,
    reasoningEffort: config.assessment.reasoningEffort,
    fetch: fetchImpl,
  };

  return {
    configuredProvider: 'groq',
    transcription: new GroqTranscriptionProvider({
      apiKey: config.groqApiKey,
      baseUrl: config.groqBaseUrl,
      maxUploadBytes: config.transcription.maxUploadBytes,
      fetch: fetchImpl,
    }),
    assessment: new GroqAssessmentProvider(chat),
    // Same chat model and settings as feedback: one GROQ_CHAT_MODEL to manage.
    generation: new GroqExerciseGenerator(chat),
  };
}
