import { z } from 'zod';
import { AppError } from '../../errors.js';

/**
 * HTTP error handling shared by every Groq call (transcription, chat), so a
 * failure means the same thing to the learner whichever feature hit it.
 */

const groqErrorSchema = z.object({ error: z.object({ message: z.string().optional() }).passthrough() }).passthrough();

const MAX_PROVIDER_DETAIL_LENGTH = 200;
/** Groq keys start with `gsk_`; never echo anything that looks like one. */
const KEY_LIKE = /gsk_[A-Za-z0-9]+/g;

export function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** The provider's own error message, shortened and with anything key-like removed. */
export function safeProviderDetail(message: string | undefined, apiKey: string): string | undefined {
  if (!message) return undefined;
  const redacted = message.split(apiKey).join('[redacted]').replace(KEY_LIKE, '[redacted]');
  return redacted.slice(0, MAX_PROVIDER_DETAIL_LENGTH);
}

async function providerDetail(response: Response, apiKey: string): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = groqErrorSchema.safeParse(body);
  return safeProviderDetail(parsed.success ? parsed.data.error.message : undefined, apiKey);
}

export interface GroqErrorMessages {
  /** 400/422: the provider couldn't process this specific input. */
  readonly badRequest: string;
  /** 413: the provider found the input too large. */
  readonly tooLarge: string;
}

/** Maps an HTTP failure to an error that is safe and useful to show the learner. */
export async function errorFromGroqResponse(response: Response, apiKey: string, messages: GroqErrorMessages): Promise<AppError> {
  const detail = await providerDetail(response, apiKey);
  const details = detail ? [{ path: 'provider', message: detail }] : undefined;

  switch (response.status) {
    case 400:
    case 422:
      return new AppError('PROVIDER_ERROR', messages.badRequest, 502, details);
    case 401:
    case 403:
      return new AppError('PROVIDER_UNAVAILABLE', 'Groq rejected the API key. Check GROQ_API_KEY in apps/server/.env.', 503);
    case 404:
      return new AppError('PROVIDER_ERROR', 'Groq did not recognise the requested model. Check the model setting.', 502, details);
    case 413:
      return new AppError('PAYLOAD_TOO_LARGE', messages.tooLarge, 413, details);
    case 429: {
      const wait = retryAfterSeconds(response);
      return new AppError(
        'RATE_LIMITED',
        wait === null
          ? "Groq's rate limit was reached. Wait a moment and try again."
          : `Groq's rate limit was reached. Try again in about ${wait} seconds.`,
        429,
      );
    }
    default:
      if (response.status >= 500) {
        return new AppError('PROVIDER_ERROR', 'Groq is having problems right now. Try again in a moment.', 502);
      }
      return new AppError('PROVIDER_ERROR', `Groq returned an unexpected error (HTTP ${response.status}).`, 502, details);
  }
}

function isTimeout(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'TimeoutError';
}

/**
 * For failures while a request is in flight: a timeout becomes a 504, any
 * other abort (the learner cancelled) propagates unchanged, and anything
 * else becomes `fallback()`.
 */
export function abortOr(signal: AbortSignal, timeoutMessage: string, fallback: () => AppError): unknown {
  if (!signal.aborted) return fallback();
  if (isTimeout(signal.reason)) return new AppError('PROVIDER_TIMEOUT', timeoutMessage, 504);
  return signal.reason;
}
