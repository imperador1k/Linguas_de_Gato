import { tmpdir } from 'node:os';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { isLoopbackHost, type AppConfig } from './config/env.js';
import { createAiProviders, type AiProviderDependencies } from './modules/ai/providers.js';
import { sweepStaleUploads } from './modules/transcription/temp-uploads.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import { registerRequestGuards } from './plugins/request-guards.js';
import { exerciseRoutes } from './routes/exercises.js';
import { speakingRoutes } from './routes/speaking.js';
import { systemRoutes } from './routes/system.js';
import { transcriptionRoutes } from './routes/transcriptions.js';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

const YOUTUBE_FRAME_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
// The official IFrame Player API: https://www.youtube.com/iframe_api loads its
// widget script from the same origin. Needed to sync transcripts with playback.
const YOUTUBE_SCRIPT_ORIGINS = ['https://www.youtube.com'];

export interface AppDependencies extends AiProviderDependencies {
  /** Where per-request upload directories are created. Defaults to the OS temp dir. */
  readonly tempRoot?: string;
}

export async function buildApp(config: AppConfig, dependencies: AppDependencies = {}): Promise<FastifyInstance> {
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
  // CSRF and DNS-rebinding protection for state-changing API calls (see the plugin for details).
  registerRequestGuards(app, { enforceLoopbackHost: isLoopbackHost(config.host) });

  // Multipart parsing is only used by the transcription route; limits are enforced per request there too.
  await app.register(multipart, {
    limits: { fileSize: config.transcription.maxUploadBytes, files: 1, fields: 2, parts: 4, fieldSize: 64, headerPairs: 50 },
    throwFileSizeLimit: true,
  });

  const tempRoot = dependencies.tempRoot ?? tmpdir();
  // Uploads orphaned by a crash or forced kill; normal requests clean up after themselves.
  const swept = await sweepStaleUploads(tempRoot);
  if (swept > 0) app.log.info({ swept }, 'removed stale upload directories');

  const ai = createAiProviders(config, dependencies);
  await app.register(systemRoutes, {
    prefix: '/api',
    version: config.version,
    ai,
    maxUploadBytes: config.transcription.maxUploadBytes,
  });
  await app.register(transcriptionRoutes, {
    prefix: '/api',
    ai,
    maxUploadBytes: config.transcription.maxUploadBytes,
    timeoutMs: config.transcription.timeoutMs,
    tempRoot,
  });
  await app.register(speakingRoutes, { prefix: '/api', ai, timeoutMs: config.assessment.timeoutMs });
  // Same chat model and timeout as feedback: both are one structured chat call.
  await app.register(exerciseRoutes, { prefix: '/api', ai, timeoutMs: config.assessment.timeoutMs });

  if (config.clientDistDir) {
    await app.register(fastifyStatic, {
      root: config.clientDistDir,
      wildcard: false,
      index: ['index.html'],
    });
  }

  return app;
}
