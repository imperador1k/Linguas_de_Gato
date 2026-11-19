import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;

/** The single error envelope returned by every API endpoint. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * Header the web client sends on every state-changing API call. A custom
 * header makes cross-origin requests non-"simple", so browsers must ask
 * permission first (CORS preflight), which this server never grants.
 */
export const CLIENT_HEADER = 'x-ldg-client';
export const CLIENT_HEADER_VALUE = 'web';
