import {
  countWords,
  writingAssessmentRequestSchema,
  writingImprovementRequestSchema,
  type WritingAssessmentResponse,
  type WritingImprovementResponse,
} from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, parseInput } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { createAiJobLimiter } from './ai-job.js';

export interface WritingRoutesOptions {
  readonly ai: AiProviders;
  readonly timeoutMs: number;
  readonly maxConcurrent?: number;
}

/**
 * Writing feedback: the assessment, and the optional improved version
 * requested afterwards. JSON under the global 1 MB limit; request guards
 * apply as to every state-changing route. Logs carry counts only, never the
 * learner's text.
 */
export const writingRoutes: FastifyPluginAsync<WritingRoutesOptions> = async (app, options) => {
  const limiter = createAiJobLimiter(options.maxConcurrent ?? 2);
  const provider = () => {
    if (!options.ai.writing) throw AppError.providerUnavailable('Writing feedback is not configured. Add GROQ_API_KEY to apps/server/.env.');
    return options.ai.writing;
  };

  app.post('/writing/assessments', async (request, reply): Promise<WritingAssessmentResponse | void> => {
    const writing = provider();
    const body = parseInput(writingAssessmentRequestSchema, request.body, 'Writing assessment request');
    const startedAt = Date.now();
    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await writing.assess(body, signal);
        request.log.info(
          {
            model: result.model,
            format: body.task.format,
            words: countWords(body.text),
            corrections: result.assessment.corrections.length,
            discarded: result.assessment.discarded,
            elapsedMs: Date.now() - startedAt,
          },
          'writing assessment completed',
        );
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Other feedback is still being prepared. Wait for it to finish.', label: 'writing assessment' },
    );
  });

  app.post('/writing/improvements', async (request, reply): Promise<WritingImprovementResponse | void> => {
    const writing = provider();
    const body = parseInput(writingImprovementRequestSchema, request.body, 'Writing improvement request');
    const startedAt = Date.now();
    return limiter.run(
      request,
      reply,
      async (signal) => {
        const result = await writing.improve(body, signal);
        request.log.info({ model: result.model, words: countWords(body.text), elapsedMs: Date.now() - startedAt }, 'writing improvement completed');
        return result;
      },
      { timeoutMs: options.timeoutMs, busyMessage: 'Other feedback is still being prepared. Wait for it to finish.', label: 'writing improvement' },
    );
  });
};
