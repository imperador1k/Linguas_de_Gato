import { describe, expect, it } from 'vitest';
import { ConfigError, isLoopbackHost, loadConfig } from '../src/config/env.js';

const runtime = { version: '1.0.0', clientDistDir: null };

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({}, runtime);
    expect(config).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 3001,
      logLevel: 'info',
      groqApiKey: null,
    });
  });

  it('treats an empty GROQ_API_KEY as not configured', () => {
    expect(loadConfig({ GROQ_API_KEY: '   ' }, runtime).groqApiKey).toBeNull();
  });

  it('reads and trims the Groq key', () => {
    expect(loadConfig({ GROQ_API_KEY: ' gsk_abc ' }, runtime).groqApiKey).toBe('gsk_abc');
  });

  it('rejects invalid values without echoing them', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' }, runtime)).toThrow(ConfigError);
    try {
      loadConfig({ PORT: '99999', LOG_LEVEL: 'shout' }, runtime);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('LOG_LEVEL');
      expect(message).not.toContain('99999');
      expect(message).not.toContain('shout');
    }
  });
});

describe('transcription configuration', () => {
  const MB = 1024 ** 2;

  it('defaults to a conservative 25 MB limit, a 300 s timeout and the official Groq URL', () => {
    const config = loadConfig({}, runtime);
    expect(config.transcription).toEqual({ maxUploadBytes: 25 * MB, timeoutMs: 300_000 });
    expect(config.groqBaseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it("accepts an explicit larger limit up to Groq's 100 MB maximum", () => {
    expect(loadConfig({ TRANSCRIPTION_MAX_UPLOAD_MB: '100' }, runtime).transcription.maxUploadBytes).toBe(100 * MB);
    expect(loadConfig({ TRANSCRIPTION_MAX_UPLOAD_MB: '' }, runtime).transcription.maxUploadBytes).toBe(25 * MB);
    expect(() => loadConfig({ TRANSCRIPTION_MAX_UPLOAD_MB: '101' }, runtime)).toThrow(/TRANSCRIPTION_MAX_UPLOAD_MB/);
    expect(() => loadConfig({ TRANSCRIPTION_MAX_UPLOAD_MB: '0' }, runtime)).toThrow(ConfigError);
    expect(() => loadConfig({ TRANSCRIPTION_MAX_UPLOAD_MB: 'lots' }, runtime)).toThrow(ConfigError);
  });

  it('validates the timeout range', () => {
    expect(loadConfig({ TRANSCRIPTION_TIMEOUT_SECONDS: '60' }, runtime).transcription.timeoutMs).toBe(60_000);
    expect(() => loadConfig({ TRANSCRIPTION_TIMEOUT_SECONDS: '5' }, runtime)).toThrow(ConfigError);
  });

  it('only allows https base URLs, or http on loopback, and strips trailing slashes', () => {
    expect(loadConfig({ GROQ_API_BASE_URL: 'http://127.0.0.1:4010/v1/' }, runtime).groqBaseUrl).toBe('http://127.0.0.1:4010/v1');
    expect(() => loadConfig({ GROQ_API_BASE_URL: 'http://example.com/v1' }, runtime)).toThrow(/GROQ_API_BASE_URL/);
    expect(() => loadConfig({ GROQ_API_BASE_URL: 'ftp://127.0.0.1' }, runtime)).toThrow(ConfigError);
  });
});

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['localhost', true],
    ['::1', true],
    ['0.0.0.0', false],
    ['192.168.1.10', false],
  ])('%s → %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
