import { generationRequestSchema, type GenerationResponse } from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, parseInput } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { createAiJobLimiter } from './ai-job.js';

export interface ExerciseRoutesOptions {
  readonly ai: AiProviders;
  readonly timeoutMs: number;
  readonly maxConcurrent?: number;
}

/**
 * AI exercise generation for every learning module. One endpoint, a request
 * discriminated by `kind`; validation, size limits and output checks are
 * per module. Only called on an explicit learner action in the UI. JSON body
 * under the global 1 MB limit; request guards apply as to every
 * state-changing route.
 */
export const exerciseRoutes: FastifyPluginAsync<ExerciseRoutesOptions> = async (app, options) => {
  const limiter = createAiJobLimiter(options.maxConcurrent ?? 2);

  app.post('/exercises/generate', async (request, reply): Promise<GenerationResponse | void> => {
    const provider = options.ai.generation;
    if (!provider) {
      throw AppError.providerUnavailable('Exercise generation is not configured. Add GROQ_API_KEY to apps/server/.env.');
    }
    const body = parseInput(generationRequestSchema, request.body, 'Generation request');
    const startedAt = Date.now();

    return limiter.run(
      request,
      reply,
      async (signal) => {
        const response = await provider.generate(body, signal);
        // Metadata only: never the learner's interest text, the transcript or generated content.
        request.log.info(
          {
            kind: body.kind,
            model: response.model,
            ...(response.result.kind === 'listening'
              ? { segments: body.kind === 'listening' ? body.segments.length : 0, questions: response.result.questions.length, discarded: response.result.discarded }
              : {}),
            ...(response.result.kind === 'grammar' ? { questions: response.result.set.questions.length, discarded: response.result.discarded } : {}),
            elapsedMs: Date.now() - startedAt,
          },
          'exercise generation completed',
        );
        return response;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Other exercises are still being generated. Wait for them to finish.', label: 'exercise generation' },
    );
  });
};
