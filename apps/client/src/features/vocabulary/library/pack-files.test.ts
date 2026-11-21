import { entryModes, vocabularyPackIndexSchema, vocabularyPackSchema } from '@ldg/shared';
import { describe, expect, it } from 'vitest';

/**
 * The static content shipped with the app, validated as it is on disk. Read
 * through Vite's glob import in the test only; the app itself fetches these
 * files at run time and never bundles them.
 */
const PREFIX = '../../../../public/content/vocabulary/';
const files = import.meta.glob<unknown>('../../../../public/content/vocabulary/**/*.json', { eager: true, import: 'default' });
const readJson = (path: string): unknown => files[`${PREFIX}${path}`];
const index = vocabularyPackIndexSchema.parse(readJson('index.json'));

describe('shipped vocabulary packs', () => {
  it('lists every pack file in the catalogue, and nothing else', () => {
    const packFiles = Object.keys(files)
      .map((file) => file.slice(PREFIX.length))
      .filter((file) => file !== 'index.json')
      .sort();
    expect(index.packs.map((pack) => pack.path).sort()).toEqual(packFiles);
  });

  for (const summary of index.packs) {
    describe(summary.path, () => {
      const pack = vocabularyPackSchema.parse(readJson(summary.path));

      it('matches its catalogue entry', () => {
        expect(pack).toMatchObject({ id: summary.id, version: summary.version, language: summary.language, title: summary.title, demo: summary.demo });
        expect(pack.entries).toHaveLength(summary.entryCount);
      });

      it('gives every entry at least one exercise mode', () => {
        expect(pack.entries.filter((entry) => entryModes(entry).length === 0).map((entry) => entry.id)).toEqual([]);
      });

      it('has one entry per lemma and part of speech', () => {
        const keys = pack.entries.map((entry) => `${entry.lemma}|${entry.partOfSpeech}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('asks context sentences only for forms the entry lists', () => {
        const unlisted = pack.entries.flatMap((entry) => {
          const known = new Set([entry.lemma, ...Object.values(entry.forms), ...entry.variants].map((value) => value.toLowerCase()));
          return entry.senses.flatMap((sense) => sense.contexts.filter((example) => !known.has(example.answer.toLowerCase())).map((example) => `${entry.id}/${example.id}: ${example.answer}`));
        });
        expect(unlisted).toEqual([]);
      });

      it('never lists the expected answer again as an alternative', () => {
        const repeated = pack.entries.flatMap((entry) => entry.senses.flatMap((sense) => sense.contexts.filter((example) => example.accepted.some((value) => value.toLowerCase() === example.answer.toLowerCase())).map((example) => example.id)));
        expect(repeated).toEqual([]);
      });

      it('names its CEFR sources and licence', () => {
        const sources = new Set(pack.sources.map((source) => source.id));
        expect(pack.entries.every((entry) => entry.cefr === null || sources.has(entry.cefr.source))).toBe(true);
        expect(pack.licence.attribution.length).toBeGreaterThan(0);
      });
    });
  }

  it('ships only a small, clearly marked demonstration pack in this milestone', () => {
    expect(index.packs.every((pack) => pack.demo)).toBe(true);
    expect(index.packs.reduce((sum, pack) => sum + pack.entryCount, 0)).toBeLessThanOrEqual(60);
  });
});
