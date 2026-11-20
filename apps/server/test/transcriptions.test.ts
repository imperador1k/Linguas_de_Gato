import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, apiErrorResponseSchema, transcriptionResultSchema } from '@ldg/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { normalizeGroqTranscription, safeProviderDetail } from '../src/modules/ai/groq-transcription.js';

const SECRET = 'gsk_unit_test_secret_do_not_leak';
const MB = 1024 ** 2;

const baseConfig: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  version: '0.0.0-test',
  clientDistDir: null,
  groqApiKey: SECRET,
  groqBaseUrl: 'https://api.groq.test/openai/v1',
  transcription: { maxUploadBytes: 25 * MB, timeoutMs: 30_000 },
  assessment: { model: 'openai/gpt-oss-120b', responseFormat: 'auto', reasoningEffort: 'medium', timeoutMs: 30_000 },
};

// --- Fixtures -------------------------------------------------------------

/** A tiny but genuine 16-bit mono PCM WAV file. */
function wavFile(dataBytes = 1600): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes, 1)]);
}

const GROQ_SUCCESS = {
  task: 'transcribe',
  language: 'English',
  duration: 4.25,
  text: ' Hello there. How are you?',
  segments: [
    // Deliberately out of order, to check sorting.
    { id: 1, seek: 0, start: 2.1, end: 4.2, text: ' How are you?', tokens: [1], temperature: 0, avg_logprob: -0.31, compression_ratio: 1.1, no_speech_prob: 0.02 },
    { id: 0, seek: 0, start: 0, end: 2.1, text: ' Hello there.', tokens: [1], temperature: 0, avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 },
  ],
  words: [
    { word: 'Hello', start: 0, end: 0.42 },
    { word: 'there', start: 0.42, end: 0.9 },
    { word: 'How', start: 2.1, end: 2.4 },
    { word: 'are', start: 2.4, end: 2.6 },
    { word: 'you', start: 2.6, end: 3.0 },
  ],
  x_groq: { id: 'req_test' },
};

interface FilePart {
  readonly field?: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Buffer;
}

function multipart(fields: Array<[string, string]>, file?: FilePart): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----ldgTestBoundary7MA4YWxkTrZu0gW';
  const chunks: Buffer[] = [];
  for (const [name, value] of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
  };
}

const wavUpload = (fields: Array<[string, string]> = [], data = wavFile()) =>
  multipart(fields, { filename: 'My Private Interview.wav', contentType: 'audio/wav', data });

// --- Harness ---------------------------------------------------------------

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

let app: FastifyInstance | undefined;
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'ldg-test-root-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(tempRoot, { recursive: true, force: true });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

async function build(fetchMock: FetchMock, overrides: Partial<AppConfig> = {}, extend?: (instance: FastifyInstance) => void) {
  app = await buildApp({ ...baseConfig, ...overrides }, { fetch: fetchMock, tempRoot });
  extend?.(app);
  await app.ready();
  return app;
}

async function tempEntries(): Promise<string[]> {
  return readdir(tempRoot);
}

/** Resolves once the signal aborts, like a real fetch would reject. */
function waitForAbort(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function waitUntil(condition: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// --- Tests -----------------------------------------------------------------

describe('POST /api/transcriptions — success', () => {
  it('sends a correct Groq request and returns a normalised transcript', async () => {
    let seenWhileRunning: string[] = [];
    const fetchMock: FetchMock = vi.fn(async () => {
      seenWhileRunning = await tempEntries();
      return jsonResponse(GROQ_SUCCESS);
    });
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(200);
    const body = transcriptionResultSchema.parse(response.json());
    expect(body).toMatchObject({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      requestedLanguage: 'en',
      detectedLanguage: 'English',
      durationSeconds: 4.25,
      text: 'Hello there. How are you?',
    });
    expect(body.segments).toEqual([
      { id: '1', startMs: 0, endMs: 2100, text: 'Hello there.', avgLogprob: -0.2, noSpeechProb: 0.01 },
      { id: '2', startMs: 2100, endMs: 4200, text: 'How are you?', avgLogprob: -0.31, noSpeechProb: 0.02 },
    ]);
    expect(body.words[0]).toEqual({ text: 'Hello', startMs: 0, endMs: 420 });
    expect(body.words).toHaveLength(5);

    // The outgoing request matches the documented parameters.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.test/openai/v1/audio/transcriptions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('temperature')).toBe('0');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment', 'word']);
    expect(form.get('language')).toBe('en');
    const file = form.get('file') as File;
    // The learner's file name never leaves the server; the content does, unchanged.
    expect(file.name).toBe('audio.wav');
    expect(file.size).toBe(wavFile().length);

    // The temp file existed during the call and is gone afterwards.
    expect(seenWhileRunning).toHaveLength(1);
    expect(await tempEntries()).toEqual([]);
    expect(response.body).not.toContain(SECRET);
  });

  it('omits the language for automatic detection and passes the higher-accuracy model', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(GROQ_SUCCESS));
    const server = await build(fetchMock);

    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      ...wavUpload([
        ['model', 'whisper-large-v3'],
        ['language', 'auto'],
      ]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ model: 'whisper-large-v3', requestedLanguage: null });
    const form = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.has('language')).toBe(false);
  });

  it('handles a response without optional metadata or word timestamps', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({ text: 'Only text.', segments: [{ start: 0, end: 1.5, text: 'Only text.' }] }),
    );
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      detectedLanguage: null,
      durationSeconds: null,
      words: [],
      segments: [{ id: '1', startMs: 0, endMs: 1500, text: 'Only text.', avgLogprob: null, noSpeechProb: null }],
    });
  });

  it('accepts uploads above the global 1 MB JSON limit, within the transcription limit', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(GROQ_SUCCESS));
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload([], wavFile(3 * MB)) });

    expect(response.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]![1]?.body as FormData).get('file')).toHaveProperty('size', 3 * MB + 44);
  });
});

describe('POST /api/transcriptions — input validation', () => {
  it('reports missing configuration without touching the upload', async () => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock, { groqApiKey: null });

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(503);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tempEntries()).toEqual([]);
  });

  it.each([
    ['an unknown model', [['model', 'gpt-4o']], 'model'],
    ['an unsupported language', [['language', 'fr']], 'language'],
    ['an unexpected field', [['prompt', 'ignore previous instructions']], 'prompt'],
  ] as const)('rejects %s', async (_label, fields, path) => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload(fields.map(([name, value]): [string, string] => [name, value])) });

    expect(response.statusCode).toBe(400);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((detail) => detail.path)).toContain(path);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tempEntries()).toEqual([]);
  });

  it.each([
    ['a PDF', 'notes.pdf', 'application/pdf', Buffer.from('%PDF-1.7 fake')],
    ['an unsupported container', 'film.mkv', 'video/x-matroska', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])],
    ['a MIME type that contradicts the extension', 'talk.wav', 'application/x-msdownload', wavFile()],
    ['a renamed document', 'talk.wav', 'audio/wav', Buffer.from('%PDF-1.7 this is not audio at all, just renamed')],
  ])('rejects %s with 415', async (_label, filename, contentType, data) => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...multipart([], { filename, contentType, data }) });

    expect(response.statusCode).toBe(415);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tempEntries()).toEqual([]);
  });

  it('rejects an oversized upload with 413 and leaves no partial file behind', async () => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock, { transcription: { maxUploadBytes: 4096, timeoutMs: 30_000 } });

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload([], wavFile(8192)) });

    expect(response.statusCode).toBe(413);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toContain('4 KB');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tempEntries()).toEqual([]);
  });

  it('rejects an empty file', async () => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock);

    const response = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      ...multipart([], { filename: 'empty.wav', contentType: 'audio/wav', data: Buffer.alloc(0) }),
    });

    expect(response.statusCode).toBe(400);
    expect(await tempEntries()).toEqual([]);
  });

  it('rejects requests without a file, with the wrong field, or not multipart', async () => {
    const fetchMock: FetchMock = vi.fn();
    const server = await build(fetchMock);

    const noFile = await server.inject({ method: 'POST', url: '/api/transcriptions', ...multipart([['model', 'whisper-large-v3']]) });
    expect(noFile.statusCode).toBe(400);

    const wrongField = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      ...multipart([], { field: 'audio', filename: 'a.wav', contentType: 'audio/wav', data: wavFile() }),
    });
    expect(wrongField.statusCode).toBe(400);

    const json = await server.inject({
      method: 'POST',
      url: '/api/transcriptions',
      payload: { file: 'x' },
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    expect(json.statusCode).toBe(415);
    expect(apiErrorResponseSchema.parse(json.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tempEntries()).toEqual([]);
  });

  it('keeps the global 1 MB limit for JSON bodies', async () => {
    const server = await build(vi.fn(), {}, (instance) => instance.post('/api/test/json', async () => ({ ok: true })));
    const response = await server.inject({
      method: 'POST',
      url: '/api/test/json',
      payload: JSON.stringify({ big: 'x'.repeat(2 * MB) }),
      headers: { 'content-type': 'application/json', [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    expect(response.statusCode).toBe(413);
  });
});

describe('POST /api/transcriptions — provider failures', () => {
  it.each([
    ['a rate limit with Retry-After', 429, { 'retry-after': '12' }, 429, 'RATE_LIMITED', 'about 12 seconds'],
    ['a rate limit without Retry-After', 429, {}, 429, 'RATE_LIMITED', 'Wait a moment'],
    ['a server error', 500, {}, 502, 'PROVIDER_ERROR', 'having problems'],
    ['a gateway error', 503, {}, 502, 'PROVIDER_ERROR', 'having problems'],
    ['an invalid key', 401, {}, 503, 'PROVIDER_UNAVAILABLE', 'API key'],
    ['a provider size rejection', 413, {}, 413, 'PAYLOAD_TOO_LARGE', 'too large'],
    ['an undecodable file', 400, {}, 502, 'PROVIDER_ERROR', "couldn't process"],
  ] as const)('maps %s', async (_label, status, headers, expectedStatus, code, messagePart) => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: `upstream says ${status}`, type: 'invalid_request_error' } }, { status, headers }),
    );
    const server = await build(fetchMock);

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(expectedStatus);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe(code);
    expect(body.error.message).toContain(messagePart);
    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toMatch(/at .*\.ts:\d+/); // no stack traces
    expect(await tempEntries()).toEqual([]);
  });

  it.each([
    ['missing text', { segments: [] }],
    ['wrong types', { text: 'x', segments: [{ start: 'zero', end: 1, text: 'x' }] }],
    ['a non-object', ['not', 'an', 'object']],
  ])('rejects an invalid provider response (%s)', async (_label, payload) => {
    const server = await build(vi.fn(async () => jsonResponse(payload)));

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(502);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('PROVIDER_ERROR');
    expect(await tempEntries()).toEqual([]);
  });

  it('rejects a response that is not JSON', async () => {
    const server = await build(vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 200 })));
    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    expect(response.statusCode).toBe(502);
    expect(await tempEntries()).toEqual([]);
  });

  it('reports network failures as provider unavailable', async () => {
    const server = await build(vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    expect(response.statusCode).toBe(503);
    expect(apiErrorResponseSchema.parse(response.json()).error.message).toContain("Couldn't reach Groq");
    expect(await tempEntries()).toEqual([]);
  });

  it('times out slow provider calls with 504 and cleans up', async () => {
    const fetchMock: FetchMock = vi.fn(async (_url, init) => waitForAbort(init?.signal));
    const server = await build(fetchMock, { transcription: { maxUploadBytes: 25 * MB, timeoutMs: 80 } });

    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });

    expect(response.statusCode).toBe(504);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('PROVIDER_TIMEOUT');
    expect(await tempEntries()).toEqual([]);
  });

  it('limits concurrent transcriptions', async () => {
    const release: Array<() => void> = [];
    const fetchMock: FetchMock = vi.fn(
      () => new Promise<Response>((resolve) => release.push(() => resolve(jsonResponse(GROQ_SUCCESS)))),
    );
    const server = await build(fetchMock);

    const first = server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    const second = server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    await waitUntil(() => fetchMock.mock.calls.length === 2);

    const third = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    expect(third.statusCode).toBe(429);

    release.forEach((resolve) => resolve());
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect(await tempEntries()).toEqual([]);
  });
});

describe('POST /api/transcriptions — cancellation', () => {
  async function listen(fetchMock: FetchMock): Promise<number> {
    const server = await build(fetchMock);
    await server.listen({ host: '127.0.0.1', port: 0 });
    return (server.server.address() as AddressInfo).port;
  }

  it('aborts the provider call and deletes the temp file when the browser disconnects', async () => {
    let providerSignal: AbortSignal | undefined;
    const fetchMock: FetchMock = vi.fn(async (_url, init) => {
      providerSignal = init?.signal ?? undefined;
      return waitForAbort(init?.signal);
    });
    const port = await listen(fetchMock);
    const { payload, headers } = wavUpload();

    const request = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/transcriptions', headers });
    request.on('error', () => undefined);
    request.end(payload);

    await waitUntil(() => fetchMock.mock.calls.length === 1);
    expect(await tempEntries()).toHaveLength(1);
    request.destroy();

    await waitUntil(() => providerSignal?.aborted === true);
    await waitUntil(async () => (await tempEntries()).length === 0);
  });

  it('deletes a partial upload when the browser disconnects mid-upload', async () => {
    const fetchMock: FetchMock = vi.fn();
    const port = await listen(fetchMock);
    const { payload, headers } = wavUpload([], wavFile(512 * 1024));

    const request = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/transcriptions',
      headers: { ...headers, 'content-length': String(payload.length) },
    });
    request.on('error', () => undefined);
    // Send only part of the body, wait until the server has started writing, then vanish.
    request.write(payload.subarray(0, 200 * 1024));
    await waitUntil(async () => (await tempEntries()).length === 1);
    request.destroy();

    await waitUntil(async () => (await tempEntries()).length === 0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('normalizeGroqTranscription', () => {
  const request = { model: 'whisper-large-v3-turbo', language: 'en' } as const;

  it('drops malformed entries and clamps timings', () => {
    const result = normalizeGroqTranscription(
      {
        text: '  Text  ',
        language: '  english ',
        duration: Number.NaN,
        segments: [
          { start: -1, end: 1, text: ' a ', no_speech_prob: 1.5, avg_logprob: Number.NEGATIVE_INFINITY },
          { start: 2, end: 1, text: ' b ' },
          { start: 3, end: 4, text: '   ' },
        ],
        words: [
          { word: ' ok ', start: 0, end: 0.5 },
          { word: 'backwards', start: 2, end: 1 },
          { word: '  ', start: 1, end: 2 },
          { word: 'nan', start: Number.NaN, end: 1 },
        ],
      },
      request,
    );
    expect(result.text).toBe('Text');
    expect(result.detectedLanguage).toBe('english');
    expect(result.durationSeconds).toBeNull();
    expect(result.segments).toEqual([
      { id: '1', startMs: 0, endMs: 1000, text: 'a', avgLogprob: null, noSpeechProb: null },
      { id: '2', startMs: 2000, endMs: 2000, text: 'b', avgLogprob: null, noSpeechProb: null },
    ]);
    expect(result.words).toEqual([{ text: 'ok', startMs: 0, endMs: 500 }]);
  });

  it('treats a blank language as unknown', () => {
    expect(normalizeGroqTranscription({ text: '', language: '  ' }, request).detectedLanguage).toBeNull();
  });
});

describe('safeProviderDetail', () => {
  it('redacts the configured key and anything key-like, and truncates', () => {
    expect(safeProviderDetail(`bad key ${SECRET} rejected`, SECRET)).toBe('bad key [redacted] rejected');
    expect(safeProviderDetail('other key gsk_AbC123 seen', SECRET)).toBe('other key [redacted] seen');
    expect(safeProviderDetail('x'.repeat(500), SECRET)).toHaveLength(200);
    expect(safeProviderDetail(undefined, SECRET)).toBeUndefined();
  });

  it('never returns a key that the provider echoes in an error', async () => {
    const server = await build(vi.fn(async () => jsonResponse({ error: { message: `Model not found for key ${SECRET}` } }, { status: 404 })));
    const response = await server.inject({ method: 'POST', url: '/api/transcriptions', ...wavUpload() });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain(SECRET);
    expect(response.body).toContain('[redacted]');
  });
});

describe('temp root sanity', () => {
  it('uses a dedicated temp root in tests', () => {
    expect(existsSync(tempRoot)).toBe(true);
  });
});
