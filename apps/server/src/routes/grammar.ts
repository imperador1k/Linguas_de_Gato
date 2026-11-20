import { grammarEvaluationRequestSchema, type GrammarEvaluationResponse } from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, parseInput } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { createAiJobLimiter } from './ai-job.js';

export interface GrammarRoutesOptions {
  readonly ai: AiProviders;
  readonly timeoutMs: number;
  readonly maxConcurrent?: number;
}

/**
 * Second opinion on an open grammar answer (transformation, error
 * correction, completion) that didn't match the key. Requested explicitly;
 * scoring stays deterministic on the client.
 */
export const grammarRoutes: FastifyPluginAsync<GrammarRoutesOptions> = async (app, options) => {
  const limiter = createAiJobLimiter(options.maxConcurrent ?? 2);

  app.post('/grammar/evaluations', async (request, reply): Promise<GrammarEvaluationResponse | void> => {
    const grammar = options.ai.grammar;
    if (!grammar) throw AppError.providerUnavailable('Answer review is not configured. Add GROQ_API_KEY to apps/server/.env.');
    const body = parseInput(grammarEvaluationRequestSchema, request.body, 'Grammar evaluation request');
    const startedAt = Date.now();
    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await grammar.evaluate(body, signal);
        request.log.info({ model: result.model, type: body.question.type, verdict: result.review.verdict, elapsedMs: Date.now() - startedAt }, 'grammar evaluation completed');
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Another review is still running. Wait for it to finish.', label: 'grammar evaluation' },
    );
  });
};
