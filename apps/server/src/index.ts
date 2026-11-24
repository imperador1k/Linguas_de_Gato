import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

let appInstance: FastifyInstance | null = null;

/**
 * Lazy initialization of the Fastify application for Vercel Serverless Functions.
 * Reuses the cached instance across warm lambda invocations.
 */
async function getApp(): Promise<FastifyInstance> {
  if (appInstance) return appInstance;

  const serverRoot = resolve(import.meta.dirname, '..');
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf8')) as { version: string };
    version = pkg.version;
  } catch {
    // Fallback if package.json cannot be read directly
  }

  const config = loadConfig(process.env, {
    version,
    clientDistDir: null, // SPA client is served statically by Vercel CDN
  });

  appInstance = await buildApp(config);
  await appInstance.ready();
  return appInstance;
}

/**
 * Vercel Serverless Function entry point for Fastify.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
