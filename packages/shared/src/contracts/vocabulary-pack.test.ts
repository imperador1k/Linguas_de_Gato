import { describe, expect, it } from 'vitest';
import { vocabularyPackIndexSchema, vocabularyPackSchema } from './vocabulary-pack.js';

function samplePack(overrides: Record<string, unknown> = {}) {
  return {
    format: 'linguas-de-gato-vocabulary-pack',
    schemaVersion: 1,
    id: 'test-pack',
    version: '1.0.0',
    language: 'en',
    title: 'Test pack',
    description: 'Fixture.',
    demo: true,
    licence: { name: 'Test', url: null, attribution: 'Fixture' },
    sources: [{ id: 'author', name: 'Author', url: null, licence: 'Fixture' }],
    entries: [
      {
        id: 'en:book:verb',
        lemma: 'book',
        partOfSpeech: 'verb',
        kind: 'word',
        forms: { past: 'booked' },
        topics: ['travel'],
        cefr: { level: 'A2', source: 'author', certainty: 'estimated' },
        difficulty: 2,
        senses: [{ id: 's1', translations: { 'pt-PT': ['reservar'] }, definition: 'to arrange a seat or room', register: 'neutral', contexts: [{ id: 'c1', sentence: 'We ___ a table.', answer: 'booked' }] }],
      },
    ],
    ...overrides,
  };
}

function issues(value: unknown): string[] {
  const parsed = vocabularyPackSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('vocabularyPackSchema', () => {
  it('accepts a valid pack and fills defaults', () => {
    const parsed = vocabularyPackSchema.parse(samplePack());
    expect(parsed.entries[0]?.variants).toEqual([]);
    expect(parsed.entries[0]?.senses[0]?.contexts[0]).toMatchObject({ accepted: [], clue: null, difficulty: null });
    expect(parsed.entries[0]?.senses[0]?.audio).toBeNull();
  });

  it('rejects duplicate entry ids', () => {
    const pack = samplePack();
    const entry = pack.entries[0];
    expect(issues({ ...pack, entries: [entry, entry] }).join(' ')).toContain('Duplicate entry id');
  });

  it('rejects ids that are not stable slugs', () => {
    const pack = samplePack();
    expect(issues({ ...pack, entries: [{ ...pack.entries[0], id: 'Book Verb' }] }).length).toBeGreaterThan(0);
  });

  it('requires exactly one gap marker in each context sentence', () => {
    const pack = samplePack();
    const entry = pack.entries[0] as (typeof pack.entries)[number];
    const withSentence = (sentence: string) => ({ ...pack, entries: [{ ...entry, senses: [{ ...entry.senses[0], contexts: [{ id: 'c1', sentence, answer: 'booked' }] }] }] });
    expect(issues(withSentence('We booked a table.')).join(' ')).toContain('exactly one ___ (found 0)');
    expect(issues(withSentence('We ___ a ___.')).join(' ')).toContain('(found 2)');
  });

  it('rejects CEFR metadata that names an unknown source', () => {
    const pack = samplePack();
    expect(issues({ ...pack, entries: [{ ...pack.entries[0], cefr: { level: 'B1', source: 'nobody', certainty: 'listed' } }] }).join(' ')).toContain('Unknown source');
  });

  it('allows entries without CEFR and senses without a definition or contexts', () => {
    const pack = samplePack();
    const entry = pack.entries[0] as (typeof pack.entries)[number];
    expect(issues({ ...pack, entries: [{ ...entry, cefr: null, senses: [{ id: 's1', translations: { 'pt-PT': ['reservar'] }, register: 'neutral' }] }] })).toEqual([]);
  });

  it('rejects unsupported languages instead of pretending they work', () => {
    expect(issues(samplePack({ language: 'fr' })).length).toBeGreaterThan(0);
  });

  it('rejects unknown fields (strict content contract)', () => {
    expect(issues(samplePack({ extra: true })).length).toBeGreaterThan(0);
  });
});

describe('vocabularyPackIndexSchema', () => {
  it('accepts a catalogue entry with a safe relative path only', () => {
    const index = { format: 'linguas-de-gato-vocabulary-index', schemaVersion: 1, packs: [{ id: 'p', version: '1.0.0', language: 'en', title: 'P', description: 'D', demo: true, entryCount: 1, path: 'en/p.json' }] };
    expect(vocabularyPackIndexSchema.safeParse(index).success).toBe(true);
    const unsafe = { ...index, packs: [{ ...index.packs[0], path: '../secrets.json' }] };
    expect(vocabularyPackIndexSchema.safeParse(unsafe).success).toBe(false);
  });
});
