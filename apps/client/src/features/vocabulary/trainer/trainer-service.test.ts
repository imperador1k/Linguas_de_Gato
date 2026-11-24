import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  NO_PACK_FILTERS,
  hintsUsed,
  initialReviewState,
  vocabularyPackSchema,
  type LocalVocabularyQuestion,
  type TrainerHint,
  type VocabularyEntry,
  type VocabularyFacet,
  type VocabularyPack,
} from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '@/lib/storage/app-database';
import { indexedDbVocabularyRepository, memoryVocabularyRepository, type VocabularyRepository } from '../storage/vocabulary-repository';
import { loadPendingHints, savePendingHints } from './pending-hints';
import { memoryHintStore } from './pending-hints.test-helpers';
import { finishRound, isLocalSet, localQuestions, retryMissed, saveAnswer, startRound } from './trainer-service';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 21, 12);
const packFiles = import.meta.glob<unknown>('../../../../public/content/vocabulary/en/demo-everyday.json', { eager: true, import: 'default' });
const pack: VocabularyPack = vocabularyPackSchema.parse(Object.values(packFiles)[0]);

/** The evidence of the (only) sense of an entry for one facet. Spelling and definition rounds train `recall`. */
function facetOf(entry: VocabularyEntry | undefined, facet: VocabularyFacet = 'recall') {
  return entry?.senses.find((sense) => sense.source.kind === 'library')?.knowledge?.[facet];
}

async function answerAll(repository: VocabularyRepository, setId: string, questions: readonly LocalVocabularyQuestion[], answer: (question: LocalVocabularyQuestion, index: number) => { text: string; hints?: TrainerHint[] }) {
  for (const [index, question] of questions.entries()) {
    const { text, hints = [] } = answer(question, index);
    await saveAnswer(repository, setId, { kind: 'typed', questionId: question.id, text, hints, answeredAt: NOW }, NOW);
  }
}

describe('Vocabulary Trainer persistence', () => {
  it('saves a local round as a practice set, without touching the collection', async () => {
    const repository = memoryVocabularyRepository();
    const set = await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 5, collection: [], now: NOW, seed: 's1' });
    expect(set).not.toBeNull();
    expect(set).toMatchObject({ model: 'local', types: ['spelling'], checkedAt: null, discarded: 0 });
    expect(isLocalSet(set!)).toBe(true);
    expect(await repository.practiceSets.get(set!.id)).toEqual(set);
    expect(await repository.entries.list()).toEqual([]);
  });

  it('returns null when nothing has what the mode needs', async () => {
    const repository = memoryVocabularyRepository();
    expect(await startRound(repository, { pack, filters: { ...NO_PACK_FILTERS, query: 'no-such-word' }, mode: 'context', count: 5, collection: [], now: NOW })).toBeNull();
  });

  it('keeps the first answer to each question (feedback was already shown)', async () => {
    const repository = memoryVocabularyRepository();
    const set = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 3, collection: [], now: NOW, seed: 's2' }))!;
    const [first] = localQuestions(set);
    await saveAnswer(repository, set.id, { kind: 'typed', questionId: first!.id, text: 'wrong', hints: [], answeredAt: NOW });
    const again = await saveAnswer(repository, set.id, { kind: 'typed', questionId: first!.id, text: first!.answer, hints: [], answeredAt: NOW });
    expect(again?.answers).toHaveLength(1);
    expect(again?.answers[0]).toMatchObject({ text: 'wrong' });
  });

  it('on checking, adds answered words to the collection and moves only the trained facet on the review ladder', async () => {
    const repository = memoryVocabularyRepository();
    const set = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 4, collection: [], now: NOW, seed: 's3' }))!;
    const questions = localQuestions(set);
    // 1: correct · 2: correct with hints · 3: a typo · 4: wrong.
    await answerAll(repository, set.id, questions, (question, index) =>
      index === 0 ? { text: question.answer } : index === 1 ? { text: question.answer, hints: ['length', 'first_letter'] } : index === 2 ? { text: `${question.answer}x` } : { text: 'zzzz' },
    );
    const outcome = await finishRound(repository, set.id, pack, NOW);
    expect(outcome).toMatchObject({ added: 4, rescheduled: 2 });
    expect(outcome?.set.checkedAt).toBe(NOW);
    expect(outcome?.set.history).toEqual([{ checkedAt: NOW, correct: 2, objectiveTotal: 4 }]);

    const entries = await repository.entries.list();
    const byLemma = new Map(entries.map((entry) => [entry.lemma, entry]));
    const [q1, q2, q3, q4] = questions;
    // Correct without hints: one step up, due tomorrow.
    expect(facetOf(byLemma.get(q1!.lemma))).toMatchObject({ step: 1, dueAt: NOW + DAY });
    expect(facetOf(byLemma.get(q1!.lemma))?.attempts).toEqual([{ at: NOW, outcome: 'correct', hints: 0, expected: q1!.answer, roundId: set.id }]);
    // With hints, or a near miss: no step; still at the start and due.
    expect(facetOf(byLemma.get(q2!.lemma))).toMatchObject({ step: 0, dueAt: NOW, attempts: [{ outcome: 'correct', hints: 2 }] });
    expect(facetOf(byLemma.get(q3!.lemma))).toMatchObject({ step: 0, dueAt: NOW, attempts: [{ outcome: 'almost' }] });
    // Wrong: back to the start, due tomorrow.
    expect(facetOf(byLemma.get(q4!.lemma))).toMatchObject({ step: 0, dueAt: NOW + DAY, attempts: [{ outcome: 'incorrect' }] });
    // Only the trained direction has evidence; the self-rated review schedule is not touched by the trainer.
    for (const entry of entries) {
      expect(facetOf(entry, 'recognition')).toBeUndefined();
      expect(facetOf(entry, 'context')).toBeUndefined();
      expect(entry.review).toEqual(initialReviewState(NOW));
    }
    expect(entries.every((entry) => entry.senses.every((sense) => sense.source.kind === 'library' && sense.source.packId === pack.id))).toBe(true);
  });

  it('is idempotent: checking twice changes nothing more', async () => {
    const repository = memoryVocabularyRepository();
    const set = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'definition', count: 2, collection: [], now: NOW, seed: 's4' }))!;
    await answerAll(repository, set.id, localQuestions(set), (question) => ({ text: question.answer }));
    await finishRound(repository, set.id, pack, NOW);
    const before = await repository.entries.list();
    expect(await finishRound(repository, set.id, pack, NOW + DAY)).toMatchObject({ added: 0, rescheduled: 0 });
    expect(await repository.entries.list()).toEqual(before);
  });

  it('does not promote a word that is not due when trained again', async () => {
    const repository = memoryVocabularyRepository();
    const filters = { ...NO_PACK_FILTERS, query: 'laptop' };
    const first = (await startRound(repository, { pack, filters, mode: 'spelling', count: 1, collection: [], now: NOW, seed: 'a' }))!;
    await answerAll(repository, first.id, localQuestions(first), (question) => ({ text: question.answer }));
    await finishRound(repository, first.id, pack, NOW);
    const second = (await startRound(repository, { pack, filters, mode: 'spelling', count: 1, collection: await repository.entries.list(), now: NOW + 1000, seed: 'b' }))!;
    await answerAll(repository, second.id, localQuestions(second), (question) => ({ text: question.answer }));
    await finishRound(repository, second.id, pack, NOW + 1000);
    const [entry] = await repository.entries.list();
    expect(facetOf(entry)).toMatchObject({ step: 1, dueAt: NOW + DAY });
    // Both answers are recorded as evidence; only the first (while due) moved the schedule.
    expect(facetOf(entry)?.attempts.map((attempt) => attempt.outcome)).toEqual(['correct', 'correct']);
  });

  it('adds a library sense to a word already saved from Reading, keeping one entry', async () => {
    const repository = memoryVocabularyRepository();
    const filters = { ...NO_PACK_FILTERS, query: 'deadline' };
    const set = (await startRound(repository, { pack, filters, mode: 'definition', count: 1, collection: [], now: NOW, seed: 'c' }))!;
    await repository.entries.put({
      id: 'reading-entry',
      version: 1,
      language: 'en',
      expression: 'deadline',
      lemma: 'deadline',
      key: 'deadline',
      kind: 'word',
      senses: [
        {
          id: 'r1',
          contextualMeaning: 'the date by which work must be finished',
          dictionaryMeaning: 'a time limit',
          partOfSpeech: 'noun',
          context: 'The deadline is tomorrow.',
          source: { kind: 'manual' },
          examples: [],
          collocations: [],
          synonyms: [],
          antonyms: [],
          register: 'neutral',
          patterns: [],
          cefrEstimate: 'B1',
          portugueseExplanation: null,
          addedAt: NOW - DAY,
        },
      ],
      review: { status: 'learning', step: 2, dueAt: NOW + 2 * DAY, lastReviewedAt: NOW - DAY, history: [{ at: NOW - DAY, rating: 'good' }] },
      createdAt: NOW - DAY,
      updatedAt: NOW - DAY,
    });
    await answerAll(repository, set.id, localQuestions(set), () => ({ text: 'deadline' }));
    await finishRound(repository, set.id, pack, NOW);
    const entries = await repository.entries.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.senses.map((sense) => sense.source.kind)).toEqual(['manual', 'library']);
    // The trainer leaves the self-rated review schedule alone.
    expect(entries[0]?.review.step).toBe(2);
    // Evidence belongs to the sense trained (the library one), never to the other meaning.
    expect(facetOf(entries[0])).toMatchObject({ step: 1, attempts: [{ outcome: 'correct' }] });
    expect(entries[0]?.senses[0]?.knowledge).toBeUndefined();
  });

  it('builds a retry round from the questions that went wrong or needed hints', async () => {
    const repository = memoryVocabularyRepository();
    const set = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'context', count: 4, collection: [], now: NOW, seed: 'd' }))!;
    const questions = localQuestions(set);
    await answerAll(repository, set.id, questions, (question, index) => (index === 0 ? { text: question.answer } : index === 1 ? { text: question.answer, hints: ['length'] } : { text: '' }));
    const checked = (await finishRound(repository, set.id, pack, NOW))!.set;
    const retry = await retryMissed(repository, checked, NOW);
    expect(retry?.questions.map((question) => question.id)).toEqual(['q1', 'q2', 'q3']);
    expect(retry?.entryIds).toEqual(questions.slice(1).map((question) => question.itemId));
    expect(retry?.model).toBe('local');
  });

  it('survives a reload: the round, its answers and the collection are in IndexedDB', async () => {
    const factory = new IDBFactory();
    const first = indexedDbVocabularyRepository(await openAppDatabase(factory));
    const set = (await startRound(first, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 3, collection: [], now: NOW, seed: 'e' }))!;
    await answerAll(first, set.id, localQuestions(set), (question) => ({ text: question.answer }));
    await finishRound(first, set.id, pack, NOW);

    const reopened = indexedDbVocabularyRepository(await openAppDatabase(factory));
    const stored = await reopened.practiceSets.get(set.id);
    expect(stored).toMatchObject({ model: 'local', checkedAt: NOW, history: [{ correct: 3, objectiveTotal: 3 }] });
    expect(stored?.answers).toHaveLength(3);
    expect(await reopened.entries.list()).toHaveLength(3);
  });
});

describe('hints taken before leaving a round', () => {
  /** Trains "laptop" once (correct, no hints): in the collection, step 1, due tomorrow. */
  async function learnLaptop(repository: VocabularyRepository) {
    const filters = { ...NO_PACK_FILTERS, query: 'laptop' };
    const first = (await startRound(repository, { pack, filters, mode: 'spelling', count: 1, collection: [], now: NOW, seed: 'h0' }))!;
    await answerAll(repository, first.id, localQuestions(first), (question) => ({ text: question.answer }));
    await finishRound(repository, first.id, pack, NOW);
    // A day later the word is due again; a new round on it is started.
    const later = NOW + DAY;
    const round = (await startRound(repository, { pack, filters, mode: 'spelling', count: 1, collection: await repository.entries.list(), now: later, seed: 'h1' }))!;
    return { round, question: localQuestions(round)[0]!, later };
  }

  it('scores a correct answer after resuming with the hints actually taken, and does not promote the word', async () => {
    const repository = memoryVocabularyRepository();
    const store = memoryHintStore();
    const { round, question, later } = await learnLaptop(repository);
    // Two hints, then the learner leaves (nothing in memory survives)…
    savePendingHints(round.id, question.id, ['length', 'first_letter'], later, store);
    // …and resumes: the question screen restores its hints from storage.
    const restored = loadPendingHints(round.id, question.id, question.answer, store);
    expect(restored).toEqual(['length', 'first_letter']);
    await saveAnswer(repository, round.id, { kind: 'typed', questionId: question.id, text: question.answer, hints: restored, answeredAt: later }, later);
    const outcome = (await finishRound(repository, round.id, pack, later))!;
    expect(hintsUsed(outcome.set.answers[0])).toBe(2);
    expect(outcome.rescheduled).toBe(0);
    const [entry] = await repository.entries.list();
    // Still step 1 and due: a hinted answer is weak evidence.
    expect(facetOf(entry)).toMatchObject({ step: 1, dueAt: NOW + DAY });
    expect(facetOf(entry)?.attempts.map((attempt) => [attempt.outcome, attempt.hints])).toEqual([
      ['correct', 0],
      ['correct', 2],
    ]);
  });

  it('promotes the same due word when it really was answered without hints (control)', async () => {
    const repository = memoryVocabularyRepository();
    const { round, question, later } = await learnLaptop(repository);
    const restored = loadPendingHints(round.id, question.id, question.answer, memoryHintStore());
    expect(restored).toEqual([]);
    await saveAnswer(repository, round.id, { kind: 'typed', questionId: question.id, text: question.answer, hints: restored, answeredAt: later }, later);
    await finishRound(repository, round.id, pack, later);
    const [entry] = await repository.entries.list();
    expect(facetOf(entry)?.step).toBe(2);
  });

  it('does not carry hints into a different round', async () => {
    const repository = memoryVocabularyRepository();
    const store = memoryHintStore();
    const a = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 3, collection: [], now: NOW, seed: 'ra' }))!;
    const b = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 3, collection: [], now: NOW, seed: 'rb' }))!;
    const qa = localQuestions(a)[0]!;
    const qb = localQuestions(b)[0]!;
    // Question ids repeat across rounds ("q1"); the round id keeps them apart.
    expect(qa.id).toBe(qb.id);
    savePendingHints(a.id, qa.id, ['length', 'first_letter'], NOW, store);
    expect(loadPendingHints(b.id, qb.id, qb.answer, store)).toEqual([]);
  });
});

describe('checking a round atomically', () => {
  async function answeredRound(repository: VocabularyRepository, seed: string) {
    const set = (await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 3, collection: [], now: NOW, seed }))!;
    // All wrong: each word gets one "again".
    await answerAll(repository, set.id, localQuestions(set), () => ({ text: 'zzzz' }));
    return set;
  }

  it('writes nothing when the transaction fails, and a retry applies each rating once', async () => {
    const repository = indexedDbVocabularyRepository(await openAppDatabase(new IDBFactory()));
    const set = await answeredRound(repository, 'atomic');
    const originalPut = IDBObjectStore.prototype.put;
    // The checked round is written last in the transaction; make that write fail once (e.g. a full disk).
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'vocabularyPracticeSets') throw new DOMException('Disk full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    try {
      await expect(finishRound(repository, set.id, pack, NOW)).rejects.toThrow();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    // Rolled back: no entry was added and the round is still open.
    expect(await repository.entries.list()).toEqual([]);
    expect((await repository.practiceSets.get(set.id))?.checkedAt).toBeNull();

    const retried = await finishRound(repository, set.id, pack, NOW + 1000);
    expect(retried).toMatchObject({ added: 3, rescheduled: 3 });
    const entries = await repository.entries.list();
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => facetOf(entry)?.attempts.map((attempt) => [attempt.at, attempt.outcome]))).toEqual(entries.map(() => [[NOW + 1000, 'incorrect']]));
    expect(entries.every((entry) => facetOf(entry)?.dueAt === NOW + 1000 + DAY)).toBe(true);
  });

  it('applies ratings once when the same round is completed twice at the same time (two tabs)', async () => {
    const factory = new IDBFactory();
    const tabA = indexedDbVocabularyRepository(await openAppDatabase(factory));
    const tabB = indexedDbVocabularyRepository(await openAppDatabase(factory));
    const set = await answeredRound(tabA, 'twice');
    const results = await Promise.all([finishRound(tabA, set.id, pack, NOW), finishRound(tabB, set.id, pack, NOW + 1)]);
    expect(results.map((result) => result?.set.checkedAt !== null)).toEqual([true, true]);
    expect(results.reduce((sum, result) => sum + (result?.rescheduled ?? 0), 0)).toBe(3);
    const entries = await tabA.entries.list();
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => facetOf(entry)?.attempts.length === 1)).toBe(true);
  });

  it('refuses to commit over a round that is already checked', async () => {
    const repository = memoryVocabularyRepository();
    const set = await answeredRound(repository, 'done');
    await finishRound(repository, set.id, pack, NOW);
    const before = await repository.entries.list();
    const stored = (await repository.practiceSets.get(set.id))!;
    expect(await repository.commitRound(before.map((entry) => ({ ...entry, updatedAt: NOW + DAY })), stored)).toBe(false);
    expect(await repository.entries.list()).toEqual(before);
  });
});
