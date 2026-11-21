import { describe, expect, it } from 'vitest';
import { vocabularyPackSchema, type VocabularyPack } from '../contracts/vocabulary-pack.js';
import type { LocalVocabularyQuestion, ReviewState, VocabularyAnswer, VocabularyPracticeSet } from '../contracts/vocabulary.js';
import { vocabularyEntrySchema, vocabularyPracticeSetSchema } from '../contracts/vocabulary.js';
import { evaluateVocabularyAnswer, initialReviewState, scheduleReview, scoreVocabularySet } from './vocabulary.js';
import {
  NO_PACK_FILTERS,
  adoptPackSense,
  buildLocalRound,
  entryModes,
  filterPackEntries,
  hintMask,
  isDifficult,
  matchLocalAnswer,
  nextHint,
  packItemId,
  retryQuestions,
  trainerRating,
} from './vocabulary-trainer.js';

const NOW = Date.UTC(2026, 10, 21, 12);
const DAY = 86_400_000;

function entry(id: string, lemma: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    lemma,
    partOfSpeech: 'noun',
    kind: 'word',
    forms: { plural: `${lemma}s` },
    topics: ['everyday'],
    cefr: { level: 'A2', source: 'author', certainty: 'estimated' },
    difficulty: 2,
    senses: [
      {
        id: 's1',
        translations: { 'pt-PT': [`pt-${lemma}`] },
        definition: `definition of ${lemma}`,
        register: 'neutral',
        contexts: [{ id: `${id.replace(/:/g, '-')}-c1`, sentence: `I like the ___ very much.`, answer: lemma }],
      },
    ],
    ...extra,
  };
}

const pack: VocabularyPack = vocabularyPackSchema.parse({
  format: 'linguas-de-gato-vocabulary-pack',
  schemaVersion: 1,
  id: 'test-pack',
  version: '1.2.0',
  language: 'en',
  title: 'Test',
  description: 'Fixture',
  demo: true,
  licence: { name: 'Test', url: null, attribution: 'Fixture' },
  sources: [{ id: 'author', name: 'Fixture author', url: null, licence: 'Fixture' }],
  entries: [
    entry('en:apple:noun', 'apple', { topics: ['food'] }),
    entry('en:river:noun', 'river', { topics: ['nature'], cefr: null }),
    entry('en:laptop:noun', 'laptop', { topics: ['technology'], cefr: { level: 'B1', source: 'author', certainty: 'estimated' } }),
    entry('en:teach:verb', 'teach', {
      partOfSpeech: 'verb',
      forms: { 'third person': 'teaches', past: 'taught' },
      topics: ['education'],
      senses: [{ id: 's1', translations: { 'pt-PT': ['ensinar'] }, definition: 'to give lessons', register: 'neutral', contexts: [{ id: 'teach-c1', sentence: 'Who ___ you to swim?', answer: 'taught' }] }],
    }),
    // Spelling only: no definition, no contexts.
    entry('en:fridge:noun', 'fridge', { senses: [{ id: 's1', translations: { 'pt-PT': ['frigorífico'] }, register: 'informal' }] }),
    entry('en:colour:noun', 'colour', { variants: ['color'] }),
  ],
});

describe('mode availability and filters', () => {
  it('derives modes from the data each entry has', () => {
    expect(entryModes(pack.entries[4]!)).toEqual(['spelling']);
    expect(entryModes(pack.entries[0]!)).toEqual(['spelling', 'context', 'definition']);
  });

  it('filters by CEFR (including unrated), topic, part of speech, mode and text', () => {
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, cefr: 'B1' }).map((item) => item.lemma)).toEqual(['laptop']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, cefr: 'unrated' }).map((item) => item.lemma)).toEqual(['river']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, topic: 'food' }).map((item) => item.lemma)).toEqual(['apple']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, partOfSpeech: 'verb' }).map((item) => item.lemma)).toEqual(['teach']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, mode: 'context' }).map((item) => item.lemma)).not.toContain('fridge');
    // Search covers forms, variants and Portuguese translations, accent-insensitively.
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, query: 'taught' }).map((item) => item.lemma)).toEqual(['teach']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, query: 'color' }).map((item) => item.lemma)).toEqual(['colour']);
    expect(filterPackEntries(pack, { ...NO_PACK_FILTERS, query: 'frigorifico' }).map((item) => item.lemma)).toEqual(['fridge']);
  });
});

describe('buildLocalRound', () => {
  const base = { pack, filters: NO_PACK_FILTERS, count: 10, seed: 'seed-1', now: NOW };

  it('is deterministic for a seed and varies with the seed', () => {
    const first = buildLocalRound({ ...base, mode: 'spelling' });
    expect(buildLocalRound({ ...base, mode: 'spelling' })).toEqual(first);
    const orders = new Set(['a', 'b', 'c', 'd', 'e'].map((seed) => buildLocalRound({ ...base, mode: 'spelling', seed }).map((question) => question.lemma).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('uses only entries with the data the mode needs, once each', () => {
    const context = buildLocalRound({ ...base, mode: 'context' });
    expect(context.map((question) => question.lemma)).not.toContain('fridge');
    expect(new Set(context.map((question) => question.itemId)).size).toBe(context.length);
    expect(buildLocalRound({ ...base, mode: 'definition' }).every((question) => question.prompt.startsWith('definition of') || question.prompt === 'to give lessons')).toBe(true);
  });

  it('respects the round size and the filters', () => {
    expect(buildLocalRound({ ...base, mode: 'spelling', count: 2 })).toHaveLength(2);
    expect(buildLocalRound({ ...base, mode: 'spelling', filters: { ...NO_PACK_FILTERS, topic: 'food' } }).map((question) => question.lemma)).toEqual(['apple']);
  });

  it('builds questions with the right answer, alternatives and other forms', () => {
    const [teach] = buildLocalRound({ ...base, mode: 'context', filters: { ...NO_PACK_FILTERS, partOfSpeech: 'verb' } });
    expect(teach).toMatchObject({ type: 'context', prompt: 'Who ___ you to swim?', answer: 'taught', clue: 'to give lessons', language: 'en', ref: { packId: 'test-pack', packVersion: '1.2.0', entryId: 'en:teach:verb', senseId: 's1', contextId: 'teach-c1' } });
    expect(teach?.forms).toEqual(['teach', 'teaches']);
    const [colour] = buildLocalRound({ ...base, mode: 'spelling', filters: { ...NO_PACK_FILTERS, query: 'colour' } });
    expect(colour).toMatchObject({ prompt: 'pt-colour', answer: 'colour', accepted: ['color'], itemId: packItemId('test-pack', 'en:colour:noun', 's1') });
  });

  it('puts difficult, then due, then new words first when progress is known', () => {
    const progress = new Map<string, ReviewState>([
      ['en:apple:noun', { ...initialReviewState(NOW - 10 * DAY), dueAt: NOW + 5 * DAY, step: 3, status: 'learning' }],
      ['en:river:noun', scheduleReview(initialReviewState(NOW - DAY), 'again', NOW - DAY)],
      ['en:laptop:noun', { ...initialReviewState(NOW - 10 * DAY), dueAt: NOW - DAY, step: 2, status: 'learning' }],
    ]);
    const round = buildLocalRound({ ...base, mode: 'spelling', progress: (item) => progress.get(item.id) ?? null });
    expect(round[0]?.lemma).toBe('river');
    expect(round[1]?.lemma).toBe('laptop');
    expect(round.at(-1)?.lemma).toBe('apple');
    expect(isDifficult(progress.get('en:river:noun') ?? null)).toBe(true);
  });

  it('renumbers questions for a retry round', () => {
    const round = buildLocalRound({ ...base, mode: 'spelling', count: 4 });
    expect(retryQuestions(round.slice(2)).map((question) => question.id)).toEqual(['q1', 'q2']);
  });
});

describe('hints', () => {
  it('offers length, then the first letter, then letters, never the whole word', () => {
    expect(nextHint('book', [])).toBe('length');
    expect(nextHint('book', ['length'])).toBe('first_letter');
    expect(nextHint('book', ['length', 'first_letter'])).toBe('letter');
    expect(nextHint('book', ['length', 'first_letter', 'letter', 'letter'])).toBeNull();
  });

  it('masks letters and keeps spaces, hyphens and apostrophes', () => {
    expect(hintMask('book', [])).toBeNull();
    expect(hintMask('book', ['length'])).toBe('_ _ _ _');
    expect(hintMask('book', ['length', 'first_letter'])).toBe('b _ _ _');
    expect(hintMask('look after', ['length', 'first_letter', 'letter'])).toBe('l o _ _   _ _ _ _ _');
    expect(hintMask('well-known', ['length'])).toBe('_ _ _ _ - _ _ _ _ _');
  });
});

describe('scoring, evidence and the review ladder', () => {
  const round = buildLocalRound({ pack, filters: NO_PACK_FILTERS, mode: 'context', count: 10, seed: 's', now: NOW });
  const teach = round.find((question) => question.lemma === 'teach') as LocalVocabularyQuestion;
  const typed = (text: string, hints: VocabularyAnswer extends infer A ? (A extends { kind: 'typed'; hints: infer H } ? H : never) : never = []): VocabularyAnswer => ({ kind: 'typed', questionId: teach.id, text, hints, answeredAt: NOW });

  it('scores local questions with the matcher; near misses and wrong forms are not correct', () => {
    expect(evaluateVocabularyAnswer(teach, typed('taught'))).toBe('correct');
    expect(evaluateVocabularyAnswer(teach, typed('tuaght'))).toBe('incorrect');
    expect(evaluateVocabularyAnswer(teach, typed('teach'))).toBe('incorrect');
    expect(evaluateVocabularyAnswer(teach, undefined)).toBe('unanswered');
    expect(evaluateVocabularyAnswer(teach, typed(''))).toBe('incorrect');
    expect(matchLocalAnswer(teach, typed('teach'))?.verdict).toBe('wrong_form');
  });

  it('counts local questions as objective in a stored practice set', () => {
    const set: VocabularyPracticeSet = vocabularyPracticeSetSchema.parse({
      id: 'set-1',
      version: 1,
      entryIds: round.map((question) => question.itemId),
      types: ['context'],
      questions: round,
      shuffles: {},
      discarded: 0,
      model: 'local',
      answers: [typed('taught')],
      reviews: [],
      checkedAt: null,
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(scoreVocabularySet(set)).toMatchObject({ objectiveTotal: round.length, correct: 1, answered: 1 });
  });

  it('maps verdicts to ratings without resetting or promoting on weak evidence', () => {
    const correct = { verdict: 'correct', reason: 'exact', closest: 'x' } as const;
    expect(trainerRating(correct, 0, true)).toBe('good');
    expect(trainerRating(correct, 0, false)).toBeNull();
    expect(trainerRating(correct, 2, true)).toBeNull();
    expect(trainerRating({ verdict: 'almost', reason: 'spelling', closest: 'x' }, 0, true)).toBeNull();
    expect(trainerRating({ verdict: 'wrong_form', reason: 'form', closest: 'x' }, 0, true)).toBeNull();
    expect(trainerRating({ verdict: 'incorrect', reason: 'none', closest: 'x' }, 0, false)).toBe('again');
    // "I don't know" is a submitted empty answer: not remembered.
    expect(trainerRating({ verdict: 'empty', reason: 'none', closest: 'x' }, 0, false)).toBe('again');
    expect(trainerRating(null, 0, true)).toBeNull();
  });

  it('marks trainer schedule changes so they are not counted again as reviews', () => {
    const state = scheduleReview(initialReviewState(NOW), 'good', NOW, 'trainer');
    expect(state.history.at(-1)).toEqual({ at: NOW, rating: 'good', via: 'trainer' });
    expect(scheduleReview(initialReviewState(NOW), 'good', NOW).history.at(-1)).toEqual({ at: NOW, rating: 'good' });
  });
});

describe('adoptPackSense', () => {
  const ids = { entryId: 'entry-1', senseId: 'sense-1' };
  const apple = pack.entries[0]!;
  const sense = apple.senses[0]!;

  it('creates a valid collection entry with library provenance and curated CEFR', () => {
    const { entry: created, outcome } = adoptPackSense(null, pack, apple, sense, NOW, ids);
    expect(outcome).toBe('created');
    expect(vocabularyEntrySchema.parse(created)).toBeTruthy();
    expect(created.senses[0]).toMatchObject({
      source: { kind: 'library', packId: 'test-pack', packVersion: '1.2.0', entryId: 'en:apple:noun', senseId: 's1' },
      cefrEstimate: null,
      cefr: { level: 'A2', source: 'Fixture author', certainty: 'estimated' },
      examples: ['I like the apple very much.'],
      portugueseExplanation: 'pt-apple',
    });
    expect(created.review.status).toBe('new');
  });

  it('adds the sense to an existing entry once, and never duplicates it', () => {
    const { entry: created } = adoptPackSense(null, pack, apple, sense, NOW, ids);
    expect(adoptPackSense(created, pack, apple, sense, NOW + 1, { entryId: 'x', senseId: 'y' }).outcome).toBe('already_saved');
    const readingEntry = { ...created, senses: created.senses.map((item) => ({ ...item, source: { kind: 'manual' as const } })) };
    const merged = adoptPackSense(readingEntry, pack, apple, sense, NOW + 1, { entryId: 'x', senseId: 'sense-2' });
    expect(merged.outcome).toBe('added_sense');
    expect(merged.entry.id).toBe(created.id);
    expect(merged.entry.senses).toHaveLength(2);
  });
});
