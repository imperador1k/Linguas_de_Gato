import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../errors.js';
import { abortOr, errorFromGroqResponse, type GroqErrorMessages } from './groq-http.js';

/**
 * One structured-output call to Groq Chat Completions
 * (https://console.groq.com/docs/structured-outputs), shared by every chat
 * feature (speaking feedback, exercise generation) so model, response-format
 * and reasoning settings, error mapping and output parsing behave the same.
 *
 * Returns the parsed JSON value only; each feature validates it with its own
 * Zod schema. System prompts never leave the server.
 */

/** Documented on 2026-11-19 as supporting `strict: true`. */
export const STRICT_SCHEMA_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'meta-models/muse-spark-open']);

export type ChatResponseFormatSetting = AppConfig['assessment']['responseFormat'];
export type ChatReasoningEffort = AppConfig['assessment']['reasoningEffort'];

export function resolveResponseFormat(model: string, setting: ChatResponseFormatSetting): 'json_schema' | 'json_object' {
  if (setting !== 'auto') return setting;
  return STRICT_SCHEMA_MODELS.has(model) ? 'json_schema' : 'json_object';
}

/** `reasoning_effort` and `include_reasoning` are documented for GPT-OSS models only. */
function isGptOss(model: string): boolean {
  return model.startsWith('openai/gpt-oss-');
}

export interface ChatFeatureMessages extends GroqErrorMessages {
  readonly timeout: string;
  readonly invalidOutput: string;
  readonly truncated: string;
}

export interface StructuredChatRequest {
  /** `json_schema.name`: letters, digits, underscores. */
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
  readonly systemPrompt: string;
  /** Appended to the system prompt in JSON Object Mode, where no schema is sent. */
  readonly jsonObjectInstructions: string;
  readonly userMessage: string;
  readonly maxCompletionTokens: number;
  readonly messages: ChatFeatureMessages;
}

export interface GroqChatOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly responseFormat: ChatResponseFormatSetting;
  readonly reasoningEffort: ChatReasoningEffort;
  readonly fetch: typeof fetch;
}

const chatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
});

export class GroqChatClient {
  readonly model: string;
  readonly responseFormat: 'json_schema' | 'json_object';
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #reasoningEffort: ChatReasoningEffort;

  constructor(options: GroqChatOptions) {
    this.#apiKey = options.apiKey;
    this.#endpoint = `${options.baseUrl}/chat/completions`;
    this.#fetch = options.fetch;
    this.#reasoningEffort = options.reasoningEffort;
    this.model = options.model;
    this.responseFormat = resolveResponseFormat(options.model, options.responseFormat);
  }

  buildBody(request: StructuredChatRequest): Record<string, unknown> {
    const strict = this.responseFormat === 'json_schema';
    return {
      model: this.model,
      messages: [
        { role: 'system', content: strict ? request.systemPrompt : request.systemPrompt + request.jsonObjectInstructions },
        { role: 'user', content: request.userMessage },
      ],
      response_format: strict
        ? { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } }
        : { type: 'json_object' },
      max_completion_tokens: request.maxCompletionTokens,
      ...(isGptOss(this.model) ? { reasoning_effort: this.#reasoningEffort, include_reasoning: false } : {}),
    };
  }

  /** Rejects with `AppError` for provider failures, or with the abort reason when cancelled. */
  async completeJson(request: StructuredChatRequest, signal: AbortSignal): Promise<unknown> {
    const { messages } = request;
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(this.buildBody(request)),
        signal,
      });
    } catch {
      throw abortOr(signal, messages.timeout, () => new AppError('PROVIDER_UNAVAILABLE', "Couldn't reach Groq. Check your internet connection.", 503));
    }

    if (!response.ok) throw await errorFromGroqResponse(response, this.#apiKey, messages);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw abortOr(signal, messages.timeout, () => new AppError('PROVIDER_ERROR', 'Groq returned a response that is not valid JSON.', 502));
    }

    const chat = chatResponseSchema.safeParse(body);
    const choice = chat.success ? chat.data.choices[0] : undefined;
    if (!choice) throw new AppError('PROVIDER_ERROR', messages.invalidOutput, 502);
    if (choice.finish_reason === 'length') throw new AppError('PROVIDER_ERROR', messages.truncated, 502);

    try {
      return JSON.parse(choice.message.content ?? '');
    } catch {
      throw new AppError('PROVIDER_ERROR', messages.invalidOutput, 502);
    }
  }
}
