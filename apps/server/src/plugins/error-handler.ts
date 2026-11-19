import type { ApiErrorResponse, ErrorCode, ErrorDetail } from '@ldg/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, zodIssuesToDetails } from '../errors.js';

function envelope(code: ErrorCode, message: string, details?: ErrorDetail[]): ApiErrorResponse {
  return details && details.length > 0 ? { error: { code, message, details } } : { error: { code, message } };
}

/** Maps Fastify's own client errors (body too large, bad JSON, …) onto our codes. */
function fromFastifyStatus(statusCode: number): { code: ErrorCode; message: string } | null {
  switch (statusCode) {
    case 400:
      return { code: 'VALIDATION_ERROR', message: 'The request is malformed.' };
    case 404:
      return { code: 'NOT_FOUND', message: 'Resource not found.' };
    case 413:
      return { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
    case 415:
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' };
    case 429:
      return { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' };
    default:
      return null;
  }
}

export interface ErrorHandlingOptions {
  /** When true, unknown non-API GET routes fall back to the SPA's index.html. */
  readonly spaFallback: boolean;
}

/**
 * Centralised error handling. Must be registered on the root instance before
 * any routes so every encapsulated plugin inherits it.
 */
export function registerErrorHandling(app: FastifyInstance, options: ErrorHandlingOptions): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send(envelope(error.code, error.message, error.details));
    }

    if (error instanceof ZodError) {
      return reply.code(400).send(envelope('VALIDATION_ERROR', 'Request is invalid.', zodIssuesToDetails(error)));
    }

    if ('validation' in error && error.validation) {
      return reply.code(400).send(envelope('VALIDATION_ERROR', 'Request is invalid.'));
    }

    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const known = statusCode < 500 ? fromFastifyStatus(statusCode) : null;
    if (known) {
      request.log.info({ err: error }, 'client error');
      return reply.code(statusCode).send(envelope(known.code, known.message));
    }

    // Unknown failures are logged in full but never described to the client.
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(envelope('INTERNAL_ERROR', 'An unexpected error occurred.'));
  });

  app.setNotFoundHandler((request, reply) => {
    const isApiRequest = request.url === '/api' || request.url.startsWith('/api/');
    const wantsHtml = (request.headers.accept ?? '').includes('text/html');

    if (options.spaFallback && request.method === 'GET' && !isApiRequest && wantsHtml) {
      return reply.type('text/html').sendFile('index.html');
    }

    return reply.code(404).send(envelope('NOT_FOUND', 'Resource not found.'));
  });
}
