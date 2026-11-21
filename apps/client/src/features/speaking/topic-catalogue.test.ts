import type { CustomTopic } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { PROMPT_LIBRARY } from './prompt-library';
import { NO_FILTERS, buildCatalogue, filterTopics, hasFilters, normalize } from './topic-catalogue';

const manual: CustomTopic = {
  id: 'mine-1',
  createdAt: 2_000,
  prompt: { source: 'custom', promptId: null, title: 'My job interview', instructions: 'Present yourself for a nursing post and explain your motivation.', points: ['Experience', 'Teamwork'], category: 'work', level: null },
};

const generated: CustomTopic = {
  id: 'ai-1',
  createdAt: 3_000,
  prompt: { source: 'custom', promptId: null, title: 'Cities without cars', instructions: 'Should city centres ban private cars?', points: [], category: 'society', level: 'C2' },
  generated: {
    level: 'C2',
    format: 'debate',
    skillFocus: null,
    targetDurationSeconds: 180,
    guidance: 'Take a side.',
    followUpQuestions: [],
    vocabulary: [],
    objectives: [],
    model: 'm',
    createdAt: 3_000,
  },
};

describe('topic catalogue', () => {
  const catalogue = buildCatalogue(PROMPT_LIBRARY, [manual, generated]);

  it('lists your own topics first, newest first, then the whole curated library', () => {
    expect(catalogue.slice(0, 2).map((entry) => entry.key)).toEqual(['custom:ai-1', 'custom:mine-1']);
    expect(catalogue).toHaveLength(PROMPT_LIBRARY.length + 2);
    expect(new Set(catalogue.map((entry) => entry.key)).size).toBe(catalogue.length);
  });

  it('describes every topic with the same fields', () => {
    const ai = catalogue[0]!;
    expect(ai).toMatchObject({ source: 'personal', level: 'C2', durationSeconds: 180, formatLabel: 'Debate', practicePath: '/speaking/practice/custom/ai-1' });
    expect(catalogue[1]).toMatchObject({ level: null, durationSeconds: null, formatLabel: 'Your own topic' });
    const curated = catalogue.find((entry) => entry.key === 'library:technology-phones-at-school')!;
    expect(curated).toMatchObject({ source: 'curated', level: 'B2', durationSeconds: 60, formatLabel: 'Guided or free', practicePath: '/speaking/practice/library/technology-phones-at-school' });
    expect(curated.structure.length).toBeGreaterThan(0);
  });

  it('applies search, level, category and source together', () => {
    expect(filterTopics(catalogue, NO_FILTERS)).toHaveLength(catalogue.length);
    expect(filterTopics(catalogue, { ...NO_FILTERS, source: 'personal' }).map((entry) => entry.key)).toEqual(['custom:ai-1', 'custom:mine-1']);
    expect(filterTopics(catalogue, { ...NO_FILTERS, level: 'C2' }).map((entry) => entry.key)).toEqual(['custom:ai-1']);
    expect(filterTopics(catalogue, { ...NO_FILTERS, level: 'B2', category: 'work' }).map((entry) => entry.title)).toEqual(['Remote or office work?']);
    // Search covers points and the category name; every word must match.
    expect(filterTopics(catalogue, { ...NO_FILTERS, query: 'teamwork' }).map((entry) => entry.key)).toEqual(['custom:mine-1']);
    const everyday = filterTopics(catalogue, { ...NO_FILTERS, query: 'everyday situations' });
    expect(everyday.length).toBeGreaterThan(0);
    expect(catalogue.filter((entry) => entry.category === 'everyday').every((entry) => everyday.includes(entry))).toBe(true);
    expect(filterTopics(catalogue, { ...NO_FILTERS, query: 'smartphones schools', source: 'curated' }).map((entry) => entry.title)).toEqual(['Smartphones in schools']);
    expect(filterTopics(catalogue, { ...NO_FILTERS, query: 'smartphones', source: 'personal' })).toEqual([]);
  });

  it('ignores case and accents and knows when filters are active', () => {
    expect(normalize('Créativité')).toBe('creativite');
    expect(filterTopics(catalogue, { ...NO_FILTERS, query: 'AI AND HUMAN' }).map((entry) => entry.title)).toEqual(['AI and human creativity']);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, query: '  ' })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, category: 'work' })).toBe(true);
  });
});
