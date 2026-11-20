import { LANGUAGE_CODES, type CapabilitiesResponse, type HealthResponse } from '@ldg/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AiProviders } from '../modules/ai/providers.js';

export interface SystemRoutesOptions {
  readonly version: string;
  readonly ai: AiProviders;
  readonly maxUploadBytes: number;
}

export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (app, options) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: options.version,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/capabilities', async (): Promise<CapabilitiesResponse> => {
    const { ai } = options;
    const configured = ai.configuredProvider !== null;

    return {
      targetLanguages: [...LANGUAGE_CODES],
      transcription: {
        available: ai.transcription !== null,
        configured,
        provider: ai.transcription?.id ?? ai.configuredProvider,
        maxUploadBytes: options.maxUploadBytes,
      },
      // Speaking feedback (M3). Writing feedback will report through the same flag when it exists.
      feedback: {
        available: ai.assessment !== null,
        configured,
        provider: ai.assessment?.id ?? ai.configuredProvider,
      },
      exerciseGeneration: {
        available: ai.generation !== null,
        configured,
        provider: ai.generation?.id ?? ai.configuredProvider,
      },
    };
  });
};
