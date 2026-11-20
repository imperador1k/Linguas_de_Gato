import { assessmentRequestSchema, transcriptFromSegments, type AssessmentResponse } from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, parseInput } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { createAiJobLimiter } from './ai-job.js';

export interface SpeakingRoutesOptions {
  readonly ai: AiProviders;
  readonly timeoutMs: number;
  readonly maxConcurrent?: number;
}

/**
 * Speaking feedback. JSON body under the global 1 MB limit, validated with
 * the shared schema (transcript length and word-count limits included).
 * Request guards (CSRF, DNS rebinding) apply as to every state-changing route.
 */
export const speakingRoutes: FastifyPluginAsync<SpeakingRoutesOptions> = async (app, options) => {
  const limiter = createAiJobLimiter(options.maxConcurrent ?? 2);

  app.post('/speaking/assessments', async (request, reply): Promise<AssessmentResponse | void> => {
    const provider = options.ai.assessment;
    if (!provider) {
      throw AppError.providerUnavailable('Speaking feedback is not configured. Add GROQ_API_KEY to apps/server/.env.');
    }
    const body = parseInput(assessmentRequestSchema, request.body, 'Assessment request');
    const startedAt = Date.now();

    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await provider.assess(body, signal);
        // Metadata only: never the transcript or the feedback text.
        request.log.info(
          {
            model: result.model,
            words: transcriptFromSegments(body.segments).split(/\s+/).length,
            segments: body.segments.length,
            issues: result.assessment.issues.length,
            discardedIssues: result.assessment.discarded.issues,
            discardedExercises: result.assessment.discarded.exercises,
            elapsedMs: Date.now() - startedAt,
          },
          'speaking assessment completed',
        );
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Another assessment is still running. Wait for it to finish.', label: 'speaking assessment' },
    );
  });
};
