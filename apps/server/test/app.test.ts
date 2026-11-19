import { apiErrorResponseSchema, capabilitiesResponseSchema, healthResponseSchema } from '@ldg/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { AppError, parseInput } from '../src/errors.js';

const baseConfig: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  version: '0.0.0-test',
  clientDistDir: null,
  groqApiKey: null,
};

let app: FastifyInstance | undefined;

async function build(overrides: Partial<AppConfig> = {}, extend?: (instance: FastifyInstance) => void) {
  app = await buildApp({ ...baseConfig, ...overrides });
  extend?.(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('reports status and version', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.version).toBe('0.0.0-test');
  });

  it('sends security headers', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/api/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://www.youtube.com');
    // Only the official YouTube IFrame API origin is added to scripts; no inline scripts.
    expect(csp).toContain("script-src 'self' https://www.youtube.com");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('GET /api/capabilities', () => {
  it('reports transcription as unavailable and unconfigured without a key', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/api/capabilities' });

    expect(response.statusCode).toBe(200);
    const body = capabilitiesResponseSchema.parse(response.json());
    expect(body.targetLanguages).toEqual(['en']);
    expect(body.transcription).toMatchObject({ available: false, configured: false, provider: null });
    expect(body.feedback).toMatchObject({ available: false, configured: false });
  });

  it('reports a configured key without claiming the feature is available', async () => {
    const secret = 'gsk_test_secret_value';
    const server = await build({ groqApiKey: secret });
    const response = await server.inject({ method: 'GET', url: '/api/capabilities' });

    const body = capabilitiesResponseSchema.parse(response.json());
    expect(body.transcription).toMatchObject({ available: false, configured: true, provider: 'groq' });
    expect(response.body).not.toContain(secret);
  });
});

describe('error handling', () => {
  it('returns the error envelope for unknown API routes', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('maps AppError to its status and code', async () => {
    const server = await build({}, (instance) => {
      instance.get('/api/test/provider', async () => {
        throw AppError.providerUnavailable('Transcription is not configured.');
      });
    });
    const response = await server.inject({ method: 'GET', url: '/api/test/provider' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'Transcription is not configured.' },
    });
  });

  it('returns field-level details for invalid input', async () => {
    const schema = z.object({ text: z.string().min(1) });
    const server = await build({}, (instance) => {
      instance.post('/api/test/validate', async (request) => parseInput(schema, request.body, 'Body'));
    });
    const response = await server.inject({ method: 'POST', url: '/api/test/validate', payload: { text: '' } });

    expect(response.statusCode).toBe(400);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.[0]?.path).toBe('text');
  });

  it('rejects malformed JSON with a 400 envelope', async () => {
    const server = await build({}, (instance) => {
      instance.post('/api/test/echo', async (request) => request.body);
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized bodies with 413', async () => {
    const server = await build({}, (instance) => {
      instance.post('/api/test/echo', async () => ({ ok: true }));
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 10) }),
    });

    expect(response.statusCode).toBe(413);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides internal error details', async () => {
    const server = await build({}, (instance) => {
      instance.get('/api/test/crash', async () => {
        throw new Error('database password is hunter2');
      });
    });
    const response = await server.inject({ method: 'GET', url: '/api/test/crash' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    expect(response.body).not.toContain('hunter2');
  });
});
