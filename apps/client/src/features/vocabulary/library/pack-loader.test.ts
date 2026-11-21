import { afterEach, describe, expect, it, vi } from 'vitest';

const summary = { id: 'p', version: '1.0.0', language: 'en' as const, title: 'P', description: 'D', demo: true, entryCount: 1, path: 'en/p.json' };

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('pack loader', () => {
  it('fetches packs from static content, never from /api/', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) => respond({ format: 'linguas-de-gato-vocabulary-index', schemaVersion: 1, packs: [summary] }));
    vi.stubGlobal('fetch', fetch);
    const { loadPackIndex } = await import('./pack-loader');
    await loadPackIndex();
    expect(fetch).toHaveBeenCalledWith('/content/vocabulary/index.json', expect.anything());
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('/api/'))).toBe(true);
  });

  it('rejects a damaged catalogue and retries on the next call', async () => {
    const fetch = vi.fn().mockReturnValueOnce(respond({ nope: true })).mockReturnValueOnce(respond({ format: 'linguas-de-gato-vocabulary-index', schemaVersion: 1, packs: [] }));
    vi.stubGlobal('fetch', fetch);
    const { loadPackIndex } = await import('./pack-loader');
    await expect(loadPackIndex()).rejects.toThrow('damaged');
    await expect(loadPackIndex()).resolves.toMatchObject({ packs: [] });
  });

  it('rejects a pack that fails validation or does not match its catalogue entry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ format: 'linguas-de-gato-vocabulary-pack', schemaVersion: 1 })));
    const { loadPack } = await import('./pack-loader');
    await expect(loadPack(summary)).rejects.toThrow('failed validation');
  });

  it('reports a failed request plainly', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond('missing', 404)));
    const { loadPack } = await import('./pack-loader');
    await expect(loadPack(summary)).rejects.toThrow('(404)');
  });
});
