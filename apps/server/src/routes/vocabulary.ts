import {
  containsWords,
  vocabularyEvaluationRequestSchema,
  vocabularyLookupRequestSchema,
  type VocabularyEvaluationResponse,
  type VocabularyLookupResponse,
} from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, parseInput } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { createAiJobLimiter } from './ai-job.js';

export interface VocabularyRoutesOptions {
  readonly ai: AiProviders;
  readonly timeoutMs: number;
  readonly maxConcurrent?: number;
}

/**
 * Contextual lookup of a selection, and evaluation of an open practice
 * answer. Both run only on an explicit learner action. Logs carry the kind
 * of request and timings only, never the text.
 */
export const vocabularyRoutes: FastifyPluginAsync<VocabularyRoutesOptions> = async (app, options) => {
  const limiter = createAiJobLimiter(options.maxConcurrent ?? 2);
  const provider = () => {
    if (!options.ai.vocabulary) throw AppError.providerUnavailable('Vocabulary analysis is not configured. Add GROQ_API_KEY to apps/server/.env.');
    return options.ai.vocabulary;
  };

  app.post('/vocabulary/lookups', async (request, reply): Promise<VocabularyLookupResponse | void> => {
    const vocabulary = provider();
    const body = parseInput(vocabularyLookupRequestSchema, request.body, 'Vocabulary lookup request');
    // The selection must come from the sentence, and the sentence from the paragraph (when one is sent).
    if (!containsWords(body.sentence, body.expression) || (body.paragraph.trim() !== '' && !containsWords(body.paragraph, body.sentence))) {
      throw new AppError('VALIDATION_ERROR', 'The selected words must come from the sentence, and the sentence from the text.', 400);
    }
    const startedAt = Date.now();
    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await vocabulary.lookup(body, signal);
        request.log.info({ model: result.model, kind: result.lookup.kind, explanationLanguage: body.explanationLanguage, elapsedMs: Date.now() - startedAt }, 'vocabulary lookup completed');
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Another lookup is still running. Wait for it to finish.', label: 'vocabulary lookup' },
    );
  });

  app.post('/vocabulary/evaluations', async (request, reply): Promise<VocabularyEvaluationResponse | void> => {
    const vocabulary = provider();
    const body = parseInput(vocabularyEvaluationRequestSchema, request.body, 'Vocabulary evaluation request');
    const startedAt = Date.now();
    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await vocabulary.evaluate(body, signal);
        request.log.info({ model: result.model, task: body.task, verdict: result.review.verdict, elapsedMs: Date.now() - startedAt }, 'vocabulary evaluation completed');
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Another evaluation is still running. Wait for it to finish.', label: 'vocabulary evaluation' },
    );
  });
};
