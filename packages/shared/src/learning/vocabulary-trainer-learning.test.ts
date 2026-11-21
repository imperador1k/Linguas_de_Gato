import { describe, expect, it } from 'vitest';
import type { LocalVocabularyQuestion, VocabularyAnswer, VocabularyPracticeSet } from '../contracts/vocabulary.js';
import { scheduleReview } from '../domain/vocabulary.js';
import { DAY, NOW, emptySnapshot, vocabularyEntry } from './fixtures.test-helpers.js';
import { activityEvents, computeMetrics, rangeFor } from './metrics.js';
import { extractObservations } from './observations.js';
import { completedWork, unfinishedWork } from './today.js';

function question(id: string, lemma: string, answer: string, forms: string[] = []): LocalVocabularyQuestion {
  return {
    id,
    type: 'context',
    itemId: `pack/en:${lemma}:verb/s1`,
    prompt: 'We ___ it.',
    explanation: `PT: ${lemma}`,
    language: 'en',
    lemma,
    answer,
    accepted: [],
    forms,
    clue: null,
    ref: { packId: 'pack', packVersion: '1.0.0', entryId: `en:${lemma}:verb`, senseId: 's1', contextId: `${lemma}-c1` },
  };
}

const typed = (questionId: string, text: string, hints: Array<'length' | 'first_letter' | 'letter'> = []): VocabularyAnswer => ({ kind: 'typed', questionId, text, hints, answeredAt: NOW - DAY });

const questions = [question('q1', 'book', 'booked'), question('q2', 'colleague', 'colleague'), question('q3', 'go', 'went', ['go', 'gone']), question('q4', 'teach', 'taught'), question('q5', 'buy', 'bought')];

function localSet(checkedAt: number | null): VocabularyPracticeSet {
  return {
    id: 'local-1',
    version: 1,
    entryIds: questions.map((item) => item.itemId),
    types: ['context'],
    questions,
    shuffles: {},
    discarded: 0,
    model: 'local',
    answers: [typed('q1', 'booked'), typed('q2', 'colegue'), typed('q3', 'go'), typed('q4', 'teached'), typed('q5', 'bought', ['length', 'first_letter'])],
    reviews: [],
    checkedAt,
    history: checkedAt === null ? [] : [{ checkedAt, correct: 2, objectiveTotal: 5 }],
    createdAt: NOW - 2 * DAY,
    updatedAt: checkedAt ?? NOW - 2 * DAY,
  };
}

describe('Vocabulary Trainer in the learning engine', () => {
  it('turns a checked local round into graded observations', () => {
    const snapshot = { ...emptySnapshot(), vocabularyPracticeSets: [localSet(NOW - DAY)] };
    const observations = extractObservations(snapshot).observations;
    const byLabel = new Map(observations.map((item) => [item.sourceLabel, item]));
    expect(byLabel.get('book')).toMatchObject({ category: 'vocabulary_retention', kind: 'correct', evidence: 'answer_key', confidence: 'high', sourcePath: '/vocabulary/train/local-1' });
    expect(byLabel.get('colleague')).toMatchObject({ category: 'spelling', kind: 'incorrect', original: 'colegue', corrected: 'colleague' });
    expect(byLabel.get('go')).toMatchObject({ category: 'grammar_other', kind: 'incorrect', note: 'Right word, wrong form' });
    expect(byLabel.get('teach')).toMatchObject({ kind: 'incorrect' });
    // Correct with hints: still correct, but weaker evidence.
    expect(byLabel.get('buy')).toMatchObject({ kind: 'correct', confidence: 'medium', note: 'Correct with 2 hints' });
  });

  it('ignores rounds that were never checked', () => {
    const snapshot = { ...emptySnapshot(), vocabularyPracticeSets: [localSet(null)] };
    expect(extractObservations(snapshot).observations).toEqual([]);
  });

  it('does not count trainer schedule changes again as reviews', () => {
    const base = vocabularyEntry('e1', NOW - 3 * DAY, []);
    const trained = { ...base, review: scheduleReview(base.review, 'again', NOW - DAY, 'trainer') };
    const reviewed = { ...base, id: 'e2', review: scheduleReview(base.review, 'good', NOW - DAY) };
    const snapshot = { ...emptySnapshot(), vocabularyEntries: [trained, reviewed] };
    const observations = extractObservations(snapshot).observations.filter((item) => item.evidence === 'review_rating');
    expect(observations.map((item) => item.sourceRecordId)).toEqual(['e2']);
    expect(computeMetrics(snapshot, rangeFor('30d', NOW)).modules.vocabulary.reviews).toBe(1);
  });

  it('links local rounds to the trainer in Today', () => {
    const open = { ...localSet(null), answers: [typed('q1', 'booked')] };
    const todayBase = { ...emptySnapshot(), writingDrafts: [], writingTasks: [] };
    expect(unfinishedWork({ ...todayBase, vocabularyPracticeSets: [open] }, NOW).find((item) => item.id === 'vocabulary-practice:local-1')).toMatchObject({ title: 'Context round · 5 words', path: '/vocabulary/train/local-1', status: 'in_progress' });
    expect(completedWork({ ...todayBase, vocabularyPracticeSets: [localSet(NOW - DAY)] }).find((item) => item.id === 'vocabulary-practice:local-1')).toMatchObject({ path: '/vocabulary/train/local-1', detail: 'Checked · 2 of 5 correct' });
  });

  describe('saved meanings (Progress and Today)', () => {
    const library = { kind: 'library' as const, packId: 'pack', packVersion: '1.0.0', entryId: 'en:book:verb', senseId: 's1' };
    const reading = { kind: 'reading' as const, textId: 't1', title: 'A text', paragraphIndex: 0 };
    /** An entry a trainer round created: only a library sense. */
    function trainerEntry(id: string, at: number) {
      const base = vocabularyEntry(id, at, []);
      return { ...base, senses: base.senses.map((sense) => ({ ...sense, source: library, cefrEstimate: null, addedAt: at })) };
    }
    /** An entry saved from Reading. */
    function readingEntry(id: string, at: number) {
      const base = vocabularyEntry(id, at, []);
      return { ...base, senses: base.senses.map((sense) => ({ ...sense, source: reading, addedAt: at })) };
    }
    const todayBase = { ...emptySnapshot(), writingDrafts: [], writingTasks: [] };
    const vocabularyMetrics = (entries: ReturnType<typeof vocabularyEntry>[]) => computeMetrics({ ...emptySnapshot(), vocabularyEntries: entries }, rangeFor('30d', NOW)).modules.vocabulary;

    it('does not count words added by a trainer round as saved', () => {
      const metrics = vocabularyMetrics([trainerEntry('t1', NOW - DAY), trainerEntry('t2', NOW - DAY)]);
      expect(metrics.entriesSaved).toBe(0);
      expect(metrics.meaningsSaved).toBe(0);
      expect(activityEvents({ ...emptySnapshot(), vocabularyEntries: [trainerEntry('t1', NOW - DAY)] }).filter((event) => event.label === 'Expression saved')).toEqual([]);
      expect(completedWork({ ...todayBase, vocabularyEntries: [trainerEntry('t1', NOW - DAY)] }).some((item) => item.id.startsWith('saves:'))).toBe(false);
    });

    it('keeps counting meanings saved from Reading', () => {
      const metrics = vocabularyMetrics([readingEntry('r1', NOW - DAY), readingEntry('r2', NOW - 2 * DAY)]);
      expect(metrics.entriesSaved).toBe(2);
      expect(metrics.meaningsSaved).toBe(2);
      expect(activityEvents({ ...emptySnapshot(), vocabularyEntries: [readingEntry('r1', NOW - DAY)] }).filter((event) => event.label === 'Expression saved')).toHaveLength(1);
      expect(completedWork({ ...todayBase, vocabularyEntries: [readingEntry('r1', NOW - DAY)] }).find((item) => item.id.startsWith('saves:'))).toMatchObject({ detail: '1 meaning saved' });
    });

    it('counts only the learner-saved part of a mixed entry', () => {
      // Saved from Reading 10 days ago, then trained from the library yesterday.
      const readingFirst = readingEntry('m1', NOW - 10 * DAY);
      const mixed1 = { ...readingFirst, senses: [...readingFirst.senses, { ...readingFirst.senses[0]!, id: 'm1-lib', source: library, addedAt: NOW - DAY }] };
      // Added by the trainer 40 days ago (outside the range), then saved from Reading yesterday.
      const trainerFirst = trainerEntry('m2', NOW - 40 * DAY);
      const mixed2 = { ...trainerFirst, senses: [...trainerFirst.senses, { ...trainerFirst.senses[0]!, id: 'm2-read', source: reading, addedAt: NOW - DAY }] };
      const metrics = vocabularyMetrics([mixed1, mixed2]);
      expect(metrics.meaningsSaved).toBe(2); // m1's Reading sense and m2's Reading sense
      expect(metrics.entriesSaved).toBe(2); // m1 saved 10 days ago; m2 saved (by the learner) yesterday
      expect(vocabularyMetrics([mixed1]).meaningsSaved).toBe(1);
    });

    it('treats existing data (no library senses) exactly as before', () => {
      // A manual entry created 40 days ago whose only remaining sense was added yesterday: counted by createdAt, as before.
      const old = vocabularyEntry('o1', NOW - 40 * DAY, []);
      const legacy = { ...old, senses: old.senses.map((sense) => ({ ...sense, addedAt: NOW - DAY })) };
      const metrics = vocabularyMetrics([legacy]);
      expect(metrics.entriesSaved).toBe(0);
      expect(metrics.meaningsSaved).toBe(1);
    });
  });
});
