import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, apiErrorResponseSchema } from '@ldg/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { STALE_UPLOAD_AGE_MS, UPLOAD_DIR_PREFIX, sweepStaleUploads } from '../src/modules/transcription/temp-uploads.js';

const baseConfig: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  version: '0.0.0-test',
  clientDistDir: null,
  groqApiKey: 'gsk_security_test',
  groqBaseUrl: 'https://api.groq.test/openai/v1',
  transcription: { maxUploadBytes: 1024 * 1024, timeoutMs: 30_000 },
};

let app: FastifyInstance | undefined;
let tempRoot: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'ldg-security-'));
  fetchMock.mockReset();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(tempRoot, { recursive: true, force: true });
});

async function build(overrides: Partial<AppConfig> = {}) {
  app = await buildApp({ ...baseConfig, ...overrides }, { fetch: fetchMock, tempRoot });
  await app.ready();
  return app;
}

/** A form a hostile web page could submit: multipart, no custom headers. */
const formBody = {
  payload: '--b\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n--b--\r\n',
  contentType: 'multipart/form-data; boundary=b',
};

describe('request guards on state-changing API routes', () => {
  it('blocks a cross-site form post (CSRF) before reading the upload', async () => {
    const server = await build();
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: { 'content-type': formBody.contentType, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('blocks requests without the client header, even from old browsers without Sec-Fetch-Site', async () => {
    const server = await build();
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: { 'content-type': formBody.contentType },
    });
    expect(response.statusCode).toBe(403);
  });

  it('blocks same-site requests from another local port or subdomain', async () => {
    const server = await build();
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: { 'content-type': formBody.contentType, 'sec-fetch-site': 'same-site', [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    expect(response.statusCode).toBe(403);
  });

  it('blocks DNS-rebinding requests that carry a foreign Host header', async () => {
    const server = await build();
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: {
        host: 'rebind.attacker.example:3001',
        'content-type': formBody.contentType,
        'sec-fetch-site': 'same-origin',
        [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it.each(['127.0.0.1:3001', 'localhost:5173', '[::1]:3001'])('lets the app through on loopback host %s', async (host) => {
    const server = await build();
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: { host, 'content-type': formBody.contentType, 'sec-fetch-site': 'same-origin', [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    // Past the guard: the (too short) file is rejected by validation, not by the guard.
    expect(response.statusCode).not.toBe(403);
  });

  it('skips the Host check when the learner deliberately binds to the network', async () => {
    const server = await build({ host: '0.0.0.0' });
    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: formBody.payload,
      headers: { host: '192.168.1.20:3001', 'content-type': formBody.contentType, [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    expect(response.statusCode).not.toBe(403);
  });

  it('leaves read-only requests alone', async () => {
    const server = await build();
    const response = await server.inject({ method: 'GET', url: '/api/capabilities', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(response.statusCode).toBe(200);
  });
});

describe('sweepStaleUploads', () => {
  it('removes only old directories with our prefix', async () => {
    const now = Date.now();
    const old = join(tempRoot, `${UPLOAD_DIR_PREFIX}old`);
    const fresh = join(tempRoot, `${UPLOAD_DIR_PREFIX}fresh`);
    const unrelated = join(tempRoot, 'someone-elses-dir');
    for (const dir of [old, fresh, unrelated]) {
      await mkdir(dir);
      await writeFile(join(dir, 'upload.wav'), 'x');
    }
    const past = new Date(now - STALE_UPLOAD_AGE_MS - 60_000);
    await utimes(old, past, past);
    await utimes(unrelated, past, past);

    expect(await sweepStaleUploads(tempRoot, now)).toBe(1);
    expect((await readdir(tempRoot)).sort()).toEqual([`${UPLOAD_DIR_PREFIX}fresh`, 'someone-elses-dir']);
  });

  it('never throws, even for a missing temp root', async () => {
    expect(await sweepStaleUploads(join(tempRoot, 'does-not-exist'))).toBe(0);
  });

  it('runs when the app starts', async () => {
    const old = join(tempRoot, `${UPLOAD_DIR_PREFIX}crashed`);
    await mkdir(old);
    const past = new Date(Date.now() - STALE_UPLOAD_AGE_MS - 60_000);
    await utimes(old, past, past);
    await build();
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
