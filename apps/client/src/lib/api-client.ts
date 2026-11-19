import { apiErrorResponseSchema, type ErrorCode, type ErrorDetail } from '@ldg/shared';
import type { ZodType } from 'zod';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

/**
 * Typed GET against the local API. Every response is validated against its
 * shared Zod contract, so a server/client mismatch fails loudly here.
 */
export async function apiGet<T>(path: `/api/${string}`, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the local server.', 0);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, response.status, details);
    }
    throw new ApiError('INTERNAL_ERROR', `The server responded with status ${response.status}.`, response.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('INVALID_RESPONSE', 'The server sent an unexpected response.', response.status);
  }
  return parsed.data;
}
