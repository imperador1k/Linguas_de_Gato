import { generationResultSchema, type GenerationRequest, type GenerationResponse } from '@ldg/shared';
import { GroqChatClient, type GroqChatOptions } from '../groq-chat.js';
import type { ExerciseGenerationProvider } from '../providers.js';
import type { ExerciseGenerator, GeneratorRegistry } from './generator.js';
import { listeningGenerator } from './listening-generator.js';
import { speakingGenerator } from './speaking-generator.js';

/**
 * Exercise generation over Groq Chat Completions. Dispatches each request to
 * its module's generator; shares the chat model, response-format and
 * reasoning settings with speaking feedback (one GROQ_CHAT_MODEL to manage).
 * Kept separate from assessment: generation creates material, assessment
 * judges the learner.
 */

export const DEFAULT_GENERATORS: GeneratorRegistry = {
  speaking: speakingGenerator,
  listening: listeningGenerator,
};

export interface GroqExerciseGeneratorOptions extends GroqChatOptions {
  readonly generators?: GeneratorRegistry;
  readonly now?: () => number;
}

export class GroqExerciseGenerator implements ExerciseGenerationProvider {
  readonly id = 'groq' as const;
  readonly #chat: GroqChatClient;
  readonly #generators: GeneratorRegistry;
  readonly #now: () => number;

  constructor(options: GroqExerciseGeneratorOptions) {
    this.#chat = new GroqChatClient(options);
    this.#generators = options.generators ?? DEFAULT_GENERATORS;
    this.#now = options.now ?? Date.now;
  }

  get model(): string {
    return this.#chat.model;
  }

  #generatorFor<K extends GenerationRequest['kind']>(kind: K): ExerciseGenerator<K> {
    return this.#generators[kind] as ExerciseGenerator<K>;
  }

  #chatRequest(request: GenerationRequest) {
    const generator = this.#generatorFor(request.kind) as ExerciseGenerator<GenerationRequest['kind']>;
    return {
      schemaName: generator.schemaName,
      schema: generator.jsonSchema,
      systemPrompt: generator.systemPrompt,
      jsonObjectInstructions: generator.jsonObjectInstructions,
      userMessage: (generator.buildUserMessage as (value: GenerationRequest) => string)(request),
      maxCompletionTokens: generator.maxCompletionTokens,
      messages: generator.messages,
    };
  }

  buildRequestBody(request: GenerationRequest): Record<string, unknown> {
    return this.#chat.buildBody(this.#chatRequest(request));
  }

  async generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResponse> {
    const output = await this.#chat.completeJson(this.#chatRequest(request), signal);
    const generator = this.#generatorFor(request.kind) as ExerciseGenerator<GenerationRequest['kind']>;
    const result = (generator.interpret as (value: unknown, req: GenerationRequest) => GenerationResponse['result'])(output, request);
    return { provider: 'groq', model: this.model, createdAt: this.#now(), result: generationResultSchema.parse(result) };
  }
}
