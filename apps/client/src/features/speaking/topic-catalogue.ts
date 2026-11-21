import type { CustomTopic, GeneratedSpeakingDetails, SpeakingCategory, SpeakingLevel } from '@ldg/shared';
import { FORMAT_LABELS } from './generation-labels';
import { CATEGORY_LABELS, type LibraryPrompt } from './prompt-library';

/**
 * Curated library prompts and the learner's own topics in one shape, so the
 * Speaking hub can search, filter and preview them together. Pure: tested
 * without a browser.
 */

export type TopicSource = 'curated' | 'personal';

export interface TopicEntry {
  /** Unique across both sources. */
  readonly key: string;
  readonly source: TopicSource;
  readonly title: string;
  readonly instructions: string;
  readonly points: readonly string[];
  readonly category: SpeakingCategory;
  /** Null for hand-written topics, which have no target level. */
  readonly level: SpeakingLevel | null;
  /** Suggested speaking time; null when the topic doesn't suggest one. */
  readonly durationSeconds: number | null;
  /** How the task is meant to be answered, in words. */
  readonly formatLabel: string;
  /** Guided mode's suggested structure (curated prompts). */
  readonly structure: readonly string[];
  readonly generated: GeneratedSpeakingDetails | null;
  /** The stored record, for editing and deleting (personal topics only). */
  readonly custom: CustomTopic | null;
  readonly practicePath: string;
  readonly createdAt: number | null;
}

export function fromLibrary(prompt: LibraryPrompt): TopicEntry {
  return {
    key: `library:${prompt.id}`,
    source: 'curated',
    title: prompt.title,
    instructions: prompt.instructions,
    points: prompt.points,
    category: prompt.category,
    level: prompt.level,
    durationSeconds: prompt.suggestedDurationSeconds,
    formatLabel: 'Guided or free',
    structure: prompt.structure,
    generated: null,
    custom: null,
    practicePath: `/speaking/practice/library/${prompt.id}`,
    createdAt: null,
  };
}

export function fromCustom(topic: CustomTopic): TopicEntry {
  return {
    key: `custom:${topic.id}`,
    source: 'personal',
    title: topic.prompt.title,
    instructions: topic.prompt.instructions,
    points: topic.prompt.points,
    category: topic.prompt.category,
    level: topic.generated?.level ?? topic.prompt.level,
    durationSeconds: topic.generated?.targetDurationSeconds ?? null,
    formatLabel: topic.generated ? FORMAT_LABELS[topic.generated.format].label : 'Your own topic',
    structure: [],
    generated: topic.generated ?? null,
    custom: topic,
    practicePath: `/speaking/practice/custom/${topic.id}`,
    createdAt: topic.createdAt,
  };
}

/** Your own topics first (newest first), then the curated library in its fixed order. */
export function buildCatalogue(library: readonly LibraryPrompt[], custom: readonly CustomTopic[]): TopicEntry[] {
  return [...[...custom].sort((a, b) => b.createdAt - a.createdAt).map(fromCustom), ...library.map(fromLibrary)];
}

export interface TopicFilters {
  readonly query: string;
  readonly level: SpeakingLevel | 'all';
  readonly category: SpeakingCategory | 'all';
  readonly source: TopicSource | 'all';
}

export const NO_FILTERS: TopicFilters = { query: '', level: 'all', category: 'all', source: 'all' };

export function hasFilters(filters: TopicFilters): boolean {
  return filters.query.trim() !== '' || filters.level !== 'all' || filters.category !== 'all' || filters.source !== 'all';
}

/** Case- and accent-insensitive, so "creativite" finds "créativité". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * All filters apply together. The search looks at the title, the prompt, the
 * points and the category name; every word must appear somewhere.
 */
export function filterTopics(entries: readonly TopicEntry[], filters: TopicFilters): TopicEntry[] {
  const words = normalize(filters.query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filters.source !== 'all' && entry.source !== filters.source) return false;
    if (filters.level !== 'all' && entry.level !== filters.level) return false;
    if (filters.category !== 'all' && entry.category !== filters.category) return false;
    if (words.length === 0) return true;
    const haystack = normalize([entry.title, entry.instructions, ...entry.points, CATEGORY_LABELS[entry.category]].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}
