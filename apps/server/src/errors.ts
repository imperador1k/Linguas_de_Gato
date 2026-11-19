import type { ErrorCode, ErrorDetail } from '@ldg/shared';
import { ZodError, type ZodType } from 'zod';

/** An error whose code, status and message are safe to return to the client. */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }

  static validation(message: string, details?: ErrorDetail[]): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, details);
  }

  static providerUnavailable(message: string): AppError {
    return new AppError('PROVIDER_UNAVAILABLE', message, 503);
  }
}

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

/** Parses untrusted input or throws a 400 `AppError` with field-level details. */
export function parseInput<T>(schema: ZodType<T>, input: unknown, label = 'Request'): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw AppError.validation(`${label} is invalid.`, zodIssuesToDetails(result.error));
  }
  return result.data;
}
