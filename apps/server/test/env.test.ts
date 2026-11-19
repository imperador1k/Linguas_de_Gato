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
