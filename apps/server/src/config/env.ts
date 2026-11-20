import { DEFAULT_TRANSCRIPTION_MAX_BYTES, MAX_CONFIGURABLE_TRANSCRIPTION_BYTES } from '@ldg/shared';
import { z } from 'zod';

const MB = 1024 ** 2;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Verified on 2026-11-19: available on Groq, supports strict Structured Outputs and reasoning_effort. */
export const DEFAULT_CHAT_MODEL = 'openai/gpt-oss-120b';

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.coerce.number().pipe(schema).optional());

/**
 * The Groq API base URL. Overridable for tests and local stubs, but the API
 * key must never travel over plain HTTP to another machine: only https, or
 * http on a loopback address, is accepted.
 */
const groqBaseUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname));
    }, 'must use https (http is allowed only for 127.0.0.1/localhost)')
    .default('https://api.groq.com/openai/v1'),
);

const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GROQ_API_KEY: optionalSecret,
  GROQ_API_BASE_URL: groqBaseUrl,
  /** Upload limit in MB. 25 matches Groq's free tier; raise only if your Groq plan allows larger files. */
  TRANSCRIPTION_MAX_UPLOAD_MB: optionalNumber(
    z
      .number()
      .positive()
      .max(MAX_CONFIGURABLE_TRANSCRIPTION_BYTES / MB, `must be at most ${MAX_CONFIGURABLE_TRANSCRIPTION_BYTES / MB}`),
  ),
  /** Upper bound for one provider request, upload included. */
  TRANSCRIPTION_TIMEOUT_SECONDS: optionalNumber(z.number().int().min(10).max(1800)),
  /** Groq chat model for speaking feedback. */
  GROQ_CHAT_MODEL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/:-]{1,100}$/, 'must be a model id such as openai/gpt-oss-120b')
      .default(DEFAULT_CHAT_MODEL),
  ),
  /**
   * `auto` uses strict JSON Schema (Structured Outputs) for models documented
   * to support it, and JSON Object Mode otherwise. Both are validated with Zod.
   */
  GROQ_CHAT_RESPONSE_FORMAT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(['auto', 'json_schema', 'json_object']).default('auto'),
  ),
  /** Sent only to GPT-OSS models, the ones documented to accept it. */
  GROQ_REASONING_EFFORT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(['low', 'medium', 'high']).default('medium'),
  ),
  ASSESSMENT_TIMEOUT_SECONDS: optionalNumber(z.number().int().min(10).max(600)),
});

export const DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS = 300;
export const DEFAULT_ASSESSMENT_TIMEOUT_SECONDS = 120;

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly version: string;
  /** Absolute path to the built client; when set, the server also serves the SPA. */
  readonly clientDistDir: string | null;
  readonly groqApiKey: string | null;
  readonly groqBaseUrl: string;
  readonly transcription: {
    readonly maxUploadBytes: number;
    readonly timeoutMs: number;
  };
  readonly assessment: {
    readonly model: string;
    readonly responseFormat: 'auto' | 'json_schema' | 'json_object';
    readonly reasoningEffort: 'low' | 'medium' | 'high';
    readonly timeoutMs: number;
  };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Validates environment variables. Error messages name the offending
 * variables but never echo their values, so secrets cannot leak into logs.
 */
export function loadConfig(
  source: NodeJS.ProcessEnv,
  runtime: { version: string; clientDistDir: string | null },
): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration — ${problems}`);
  }

  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    version: runtime.version,
    clientDistDir: runtime.clientDistDir,
    groqApiKey: env.GROQ_API_KEY ?? null,
    groqBaseUrl: env.GROQ_API_BASE_URL.replace(/\/+$/, ''),
    transcription: {
      maxUploadBytes:
        env.TRANSCRIPTION_MAX_UPLOAD_MB === undefined
          ? DEFAULT_TRANSCRIPTION_MAX_BYTES
          : Math.floor(env.TRANSCRIPTION_MAX_UPLOAD_MB * MB),
      timeoutMs: (env.TRANSCRIPTION_TIMEOUT_SECONDS ?? DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS) * 1000,
    },
    assessment: {
      model: env.GROQ_CHAT_MODEL,
      responseFormat: env.GROQ_CHAT_RESPONSE_FORMAT,
      reasoningEffort: env.GROQ_REASONING_EFFORT,
      timeoutMs: (env.ASSESSMENT_TIMEOUT_SECONDS ?? DEFAULT_ASSESSMENT_TIMEOUT_SECONDS) * 1000,
    },
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
