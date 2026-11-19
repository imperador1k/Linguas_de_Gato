import { CLIENT_HEADER, CLIENT_HEADER_VALUE, apiErrorResponseSchema, type ErrorCode, type ErrorDetail } from '@ldg/shared';
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

export interface UploadCallbacks {
  readonly signal?: AbortSignal;
  /** Real byte counts from the browser; not called when the total is unknown. */
  readonly onUploadProgress?: (loaded: number, total: number) => void;
  /** The request body has been fully sent; the server is now working. */
  readonly onUploadComplete?: () => void;
}

/**
 * Multipart POST with genuine upload progress. Uses XMLHttpRequest because
 * fetch() cannot report upload progress in browsers. Rejects with ApiError,
 * or with an AbortError DOMException when cancelled through `signal`.
 */
export function apiUpload<T>(
  path: `/api/${string}`,
  form: FormData,
  schema: ZodType<T>,
  { signal, onUploadProgress, onUploadComplete }: UploadCallbacks = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    signal?.addEventListener('abort', onAbortSignal, { once: true });
    const settle = () => signal?.removeEventListener('abort', onAbortSignal);

    xhr.open('POST', path);
    xhr.setRequestHeader('Accept', 'application/json');
    // Required by the server's CSRF guard; other sites can't send it without a CORS preflight.
    xhr.setRequestHeader(CLIENT_HEADER, CLIENT_HEADER_VALUE);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress?.(event.loaded, event.total);
    };
    xhr.upload.onload = () => onUploadComplete?.();

    xhr.onload = () => {
      settle();
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const parsed = apiErrorResponseSchema.safeParse(body);
        if (parsed.success) {
          const { code, message, details } = parsed.data.error;
          reject(new ApiError(code, message, xhr.status, details));
        } else {
          reject(new ApiError('INTERNAL_ERROR', `The server responded with status ${xhr.status}.`, xhr.status));
        }
        return;
      }
      const parsed = schema.safeParse(body);
      if (parsed.success) resolve(parsed.data);
      else reject(new ApiError('INVALID_RESPONSE', 'The server sent an unexpected response.', xhr.status));
    };
    xhr.onerror = () => {
      settle();
      reject(new ApiError('NETWORK_ERROR', 'Could not reach the local server.', 0));
    };
    xhr.onabort = () => {
      settle();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };

    xhr.send(form);
  });
}
