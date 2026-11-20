import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';

/**
 * Runs one AI provider call for a JSON route: aborts it when the client
 * disconnects or the timeout passes, and caps concurrent calls (one learner,
 * one machine: a small cap stops runaway loops from burning the Groq quota).
 * Shared by speaking feedback and exercise generation.
 */

class ClientDisconnectedError extends Error {
  override readonly name = 'ClientDisconnectedError';
}

export interface AiJobLimiter {
  run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    job: (signal: AbortSignal) => Promise<T>,
    options: { readonly timeoutMs: number; readonly busyMessage: string; readonly label: string },
  ): Promise<T | undefined>;
}

export function createAiJobLimiter(maxConcurrent: number): AiJobLimiter {
  let active = 0;
  return {
    async run(request, reply, job, options) {
      if (active >= maxConcurrent) throw new AppError('RATE_LIMITED', options.busyMessage, 429);

      active += 1;
      const disconnect = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) disconnect.abort(new ClientDisconnectedError('Client disconnected'));
      };
      reply.raw.once('close', onClose);
      const startedAt = Date.now();

      try {
        return await job(AbortSignal.any([disconnect.signal, AbortSignal.timeout(options.timeoutMs)]));
      } catch (error) {
        if (disconnect.signal.aborted && (error instanceof ClientDisconnectedError || !(error instanceof AppError))) {
          request.log.info({ elapsedMs: Date.now() - startedAt }, `${options.label} cancelled by the client`);
          reply.hijack();
          reply.raw.destroy();
          return undefined;
        }
        throw error;
      } finally {
        reply.raw.off('close', onClose);
        active -= 1;
      }
    },
  };
}
