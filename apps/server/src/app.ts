import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import { createAiProviders } from './modules/ai/providers.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import { systemRoutes } from './routes/system.js';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

const YOUTUBE_FRAME_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
// The official IFrame Player API: https://www.youtube.com/iframe_api loads its
// widget script from the same origin. Needed to sync transcripts with playback.
const YOUTUBE_SCRIPT_ORIGINS = ['https://www.youtube.com'];

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...YOUTUBE_SCRIPT_ORIGINS],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://i.ytimg.com'],
        fontSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameSrc: YOUTUBE_FRAME_ORIGINS,
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // The YouTube embed rejects requests without a Referer (player error 153).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  registerErrorHandling(app, { spaFallback: config.clientDistDir !== null });

  const ai = createAiProviders(config);
  await app.register(systemRoutes, { prefix: '/api', version: config.version, ai });

  if (config.clientDistDir) {
    await app.register(fastifyStatic, {
      root: config.clientDistDir,
      wildcard: false,
      index: ['index.html'],
    });
  }

  return app;
}
