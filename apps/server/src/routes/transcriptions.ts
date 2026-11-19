import type { TranscriptionResult } from '@ldg/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AppError } from '../errors.js';
import type { AiProviders } from '../modules/ai/providers.js';
import { receiveTranscriptionUpload } from '../modules/transcription/receive-upload.js';

export interface TranscriptionRoutesOptions {
  readonly ai: AiProviders;
  readonly maxUploadBytes: number;
  readonly timeoutMs: number;
  readonly tempRoot: string;
  /** One learner, one machine: a small cap stops runaway loops from burning the Groq quota. */
  readonly maxConcurrent?: number;
}

/** Thrown into the provider's signal when the browser goes away. */
class ClientDisconnectedError extends Error {
  override readonly name = 'ClientDisconnectedError';
}

/** The browser is gone: nobody can read a response, so close the socket without one. */
function abandon(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.destroy();
}

/** Multipart framing overhead on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const transcriptionRoutes: FastifyPluginAsync<TranscriptionRoutesOptions> = async (app, options) => {
  const maxConcurrent = options.maxConcurrent ?? 2;
  let active = 0;

  app.post(
    '/transcriptions',
    // The global 1 MB JSON limit stays; only this route accepts a large body.
    { bodyLimit: options.maxUploadBytes + MULTIPART_OVERHEAD_BYTES },
    async (request, reply): Promise<TranscriptionResult | void> => {
      const provider = options.ai.transcription;
      if (!provider) {
        throw AppError.providerUnavailable('Transcription is not configured. Add GROQ_API_KEY to apps/server/.env.');
      }
      if (active >= maxConcurrent) {
        throw new AppError('RATE_LIMITED', 'Another transcription is still running. Wait for it to finish.', 429);
      }

      active += 1;
      const disconnect = new AbortController();
      // `close` before the response is written means the browser cancelled or went away.
      const onClose = () => {
        if (!reply.raw.writableEnded) disconnect.abort(new ClientDisconnectedError('Client disconnected'));
      };
      reply.raw.once('close', onClose);

      let upload: Awaited<ReturnType<typeof receiveTranscriptionUpload>> | null = null;
      const startedAt = Date.now();
      try {
        upload = await receiveTranscriptionUpload(request, {
          maxBytes: options.maxUploadBytes,
          tempRoot: options.tempRoot,
        });
        if (disconnect.signal.aborted) return abandon(reply);

        const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(options.timeoutMs)]);
        const result = await provider.transcribe(
          {
            filePath: upload.filePath,
            fileName: upload.providerFileName,
            mimeType: upload.mimeType,
            model: upload.options.model,
            language: upload.options.language === 'auto' ? null : upload.options.language,
          },
          signal,
        );

        // Metadata only: never file names, audio or transcript text.
        request.log.info(
          {
            model: result.model,
            requestedLanguage: result.requestedLanguage,
            bytes: upload.sizeBytes,
            elapsedMs: Date.now() - startedAt,
            segments: result.segments.length,
            words: result.words.length,
          },
          'transcription completed',
        );
        return result;
      } catch (error) {
        if (disconnect.signal.aborted && (error instanceof ClientDisconnectedError || !(error instanceof AppError))) {
          request.log.info({ elapsedMs: Date.now() - startedAt }, 'transcription cancelled by the client');
          return abandon(reply);
        }
        throw error;
      } finally {
        reply.raw.off('close', onClose);
        active -= 1;
        await upload?.cleanup();
      }
    },
  );
};
