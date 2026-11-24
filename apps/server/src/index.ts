import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    let version = '0.1.0';
    try {
      const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/server/package.json'), 'utf8')) as { version: string };
      version = pkg.version;
    } catch {
      try {
        const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
        version = pkg.version;
      } catch {
        // Fallback default version
      }
    }

    const config = loadConfig(process.env, {
      version,
      clientDistDir: null, // SPA client is served statically by Vercel CDN
    });

    const instance = await buildApp(config);
    await instance.ready();
    return instance;
  })();

  return appPromise;
}

/**
 * Serverless function handler bridging Vercel requests to Fastify.
 * Catches initialization errors so they appear in Vercel logs instead of failing silently.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (error) {
    console.error('[Vercel Serverless Error]:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal Server Error',
        },
      }),
    );
  }
}
