import { describe, expect, it } from 'vitest';
import type { FacetKnowledge, LocalVocabularyQuestion, VocabularyEntry, VocabularyPracticeSet } from '../contracts/vocabulary.js';
import { vocabularyEntrySchema } from '../contracts/vocabulary.js';
import type { MatchResult } from './vocabulary-answers.js';
import { DAY_MS as DAY, V1_NOW as NOW, personalEntry } from './vocabulary-fixtures.test-helpers.js';
import {
  contextForms,
  dueFacets,
  entriesDueForPractice,
  facetStatus,
  isFacetDue,
  migrateLegacyKnowledge,
  nextFacetDueAt,
  recognisesButCannotRecall,
  recordFacetAttempt,
  replayTrainerRounds,
  withFacetAttempt,
} from './vocabulary-knowledge.js';
import { initialReviewState } from './vocabulary.js';

const correct: MatchResult = { verdict: 'correct', reason: 'exact', closest: 'eat' };
const almost: MatchResult = { verdict: 'almost', reason: 'spelling', closest: 'eat' };
const wrongForm: MatchResult = { verdict: 'wrong_form', reason: 'form', closest: 'ate' };
const incorrect: MatchResult = { verdict: 'incorrect', reason: 'none', closest: 'eat' };
const empty: MatchResult = { verdict: 'empty', reason: 'none', closest: 'eat' };

const attempt = (result: MatchResult, hints = 0, expected = 'eat') => ({ result, hints, expected, roundId: 'r' });

/** Applies answers one per `gap` days, starting at NOW. */
function history(results: Array<[MatchResult, number?]>, gap = 1): FacetKnowledge | undefined {
  let knowledge: FacetKnowledge | undefined;
  results.forEach(([result, hints = 0], index) => {
    knowledge = recordFacetAttempt(knowledge, attempt(result, hints), NOW + index * gap * DAY);
  });
  return knowledge;
}

describe('the scheduling policy, per facet', () => {
  it('moves a new facet one step on an unaided correct answer, due the next day', () => {
    expect(recordFacetAttempt(undefined, attempt(correct), NOW)).toEqual({ step: 1, dueAt: NOW + DAY, attempts: [{ at: NOW, outcome: 'correct', hints: 0, expected: 'eat', roundId: 'r' }] });
  });

  it('treats hints, near misses and wrong forms as weak evidence: recorded, no step', () => {
    for (const [result, hints] of [[correct, 2], [almost, 0], [wrongForm, 0]] as const) {
      const next = recordFacetAttempt(undefined, attempt(result, hints), NOW);
      expect(next).toMatchObject({ step: 0, dueAt: NOW });
      expect(next.attempts).toHaveLength(1);
    }
  });

  it('sends an incorrect or skipped answer back to the start, due tomorrow', () => {
    const learned = history([[correct], [correct]]);
    expect(learned?.step).toBe(2);
    expect(recordFacetAttempt(learned, attempt(incorrect), NOW + 5 * DAY)).toMatchObject({ step: 0, dueAt: NOW + 6 * DAY });
    expect(recordFacetAttempt(learned, attempt(empty), NOW + 5 * DAY).attempts.at(-1)?.outcome).toBe('skipped');
  });

  it('does not promote a facet that is not due, so repeating rounds cannot race ahead', () => {
    const once = recordFacetAttempt(undefined, attempt(correct), NOW);
    const again = recordFacetAttempt(once, attempt(correct), NOW + 60_000);
    expect(again).toMatchObject({ step: 1, dueAt: NOW + DAY });
    expect(again.attempts).toHaveLength(2);
  });

  it('never calls one correct answer mastery: established needs two unaided successes on different days', () => {
    expect(facetStatus(history([[correct]]))).toBe('learning');
    expect(facetStatus(history([[correct], [correct]]))).toBe('established');
    // Two correct answers on the same day are still one step.
    const sameDay = recordFacetAttempt(recordFacetAttempt(undefined, attempt(correct), NOW), attempt(correct), NOW + 1000);
    expect(facetStatus(sameDay)).toBe('learning');
    // Steps 1, 2, 3, 4 need answers 1, 3 and 7 days apart.
    let knowledge = recordFacetAttempt(undefined, attempt(correct), NOW);
    for (const days of [1, 4, 11]) knowledge = recordFacetAttempt(knowledge, attempt(correct), NOW + days * DAY);
    expect(knowledge.step).toBe(4);
    expect(facetStatus(knowledge)).toBe('secure');
  });

  it('marks a facet difficult after a wrong answer or repeated misses, and recovers', () => {
    expect(facetStatus(undefined)).toBe('untested');
    expect(facetStatus(history([[correct], [incorrect]]))).toBe('difficult');
    expect(facetStatus(history([[almost], [correct], [wrongForm]]))).toBe('difficult');
    // After a failure, two unaided successes on later days re-establish it.
    expect(facetStatus(history([[incorrect], [correct]]))).toBe('learning');
    expect(facetStatus(history([[incorrect], [correct], [correct]]))).toBe('established');
  });

  it('keeps a bounded attempt log', () => {
    let knowledge: FacetKnowledge | undefined;
    for (let index = 0; index < 40; index += 1) knowledge = recordFacetAttempt(knowledge, attempt(correct), NOW + index);
    expect(knowledge?.attempts).toHaveLength(30);
  });
});

describe('evidence isolated by meaning and direction', () => {
  it('records an answer only on the facet of the sense it tested', () => {
    const book = personalEntry('book', { expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '', forms: [] }, { expression: 'book', translations: ['reservar'], partOfSpeech: 'verb', example: '', forms: ['booked'] });
    const [noun, verb] = book.senses;
    const trained = withFacetAttempt(noun!, 'recall', attempt(correct, 0, 'book'), NOW);
    expect(trained.knowledge?.recall?.step).toBe(1);
    expect(trained.knowledge?.recognition).toBeUndefined();
    expect(trained.knowledge?.context).toBeUndefined();
    expect(verb?.knowledge).toBeUndefined();
    expect(vocabularyEntrySchema.parse({ ...book, senses: [trained, verb] })).toBeTruthy();
  });

  it('can show recognition without recall', () => {
    const eat = personalEntry('eat', {}).senses[0]!;
    const recognised = { ...eat, knowledge: { recognition: history([[correct], [correct]]) } };
    expect(recognisesButCannotRecall(recognised)).toBe(true);
    expect(recognisesButCannotRecall({ ...recognised, knowledge: { ...recognised.knowledge, recall: history([[correct], [correct]]) } })).toBe(false);
  });

  it('tells apart the forms produced in sentences from the ones still missed', () => {
    let knowledge = recordFacetAttempt(undefined, attempt(wrongForm, 0, 'ate'), NOW);
    knowledge = recordFacetAttempt(knowledge, attempt(correct, 0, 'eats'), NOW + DAY);
    knowledge = recordFacetAttempt(knowledge, attempt(correct, 1, 'eaten'), NOW + 2 * DAY);
    expect(contextForms(knowledge)).toEqual({ produced: ['eats'], missed: ['ate', 'eaten'] });
    knowledge = recordFacetAttempt(knowledge, attempt(correct, 0, 'ate'), NOW + 3 * DAY);
    expect(contextForms(knowledge).missed).toEqual(['eaten']);
  });
});

describe('due words', () => {
  it('lists due facets oldest first; untested facets are new, not due', () => {
    const eat = personalEntry('eat', {});
    const run = personalEntry('run', { expression: 'run', translations: ['correr'], example: '', forms: [] });
    const trainedEat: VocabularyEntry = { ...eat, senses: [{ ...eat.senses[0]!, knowledge: { recall: recordFacetAttempt(undefined, attempt(incorrect), NOW - 3 * DAY), recognition: recordFacetAttempt(undefined, attempt(correct), NOW) } }] };
    const trainedRun: VocabularyEntry = { ...run, senses: [{ ...run.senses[0]!, knowledge: { recognition: recordFacetAttempt(undefined, attempt(incorrect), NOW - DAY) } }] };
    expect(isFacetDue(undefined, NOW)).toBe(false);
    expect(dueFacets([trainedRun, trainedEat, personalEntry('new', { expression: 'new', translations: ['novo'] })], NOW).map((due) => [due.entry.id, due.facet])).toEqual([
      ['eat', 'recall'],
      ['run', 'recognition'],
    ]);
    expect(entriesDueForPractice([trainedRun, trainedEat], NOW).map((entry) => entry.id)).toEqual(['eat', 'run']);
    expect(nextFacetDueAt([trainedEat], NOW)).toBe(NOW + DAY);
  });
});

describe('earlier trainer rounds', () => {
  const question = (id: string, type: LocalVocabularyQuestion['type'], answer: string): LocalVocabularyQuestion =>
    ({
      id,
      type,
      itemId: 'demo/en:eat:verb/s1',
      prompt: type === 'context' ? 'We ___ late.' : 'comer',
      explanation: 'PT: comer',
      language: 'en',
      lemma: 'eat',
      answer,
      accepted: [],
      forms: ['eat', 'ate', 'eats'].filter((form) => form !== answer),
      ref: { packId: 'demo', packVersion: '1.0.0', entryId: 'en:eat:verb', senseId: 's1', contextId: type === 'context' ? 'c1' : null },
      ...(type === 'context' ? { clue: null } : {}),
    }) as LocalVocabularyQuestion;
  const round = (id: string, checkedAt: number | null, type: LocalVocabularyQuestion['type'], answer: string, text: string): VocabularyPracticeSet => ({
    id,
    version: 1,
    entryIds: ['demo/en:eat:verb/s1'],
    types: [type],
    questions: [question('q1', type, answer)],
    shuffles: {},
    discarded: 0,
    model: 'local',
    answers: [{ kind: 'typed', questionId: 'q1', text, hints: [], answeredAt: checkedAt ?? NOW }],
    reviews: [],
    checkedAt,
    history: checkedAt === null ? [] : [{ checkedAt, correct: text === answer ? 1 : 0, objectiveTotal: 1 }],
    createdAt: NOW - 10 * DAY,
    updatedAt: checkedAt ?? NOW,
  });
  const libraryEntry = (): VocabularyEntry => ({
    ...personalEntry('lib', {}),
    senses: [{ ...personalEntry('lib', {}).senses[0]!, source: { kind: 'library', packId: 'demo', packVersion: '1.0.0', entryId: 'en:eat:verb', senseId: 's1' }, knowledge: undefined }],
    review: { ...initialReviewState(NOW - 10 * DAY), step: 2, status: 'learning', history: [{ at: NOW - 5 * DAY, rating: 'good', via: 'trainer' }] },
  });

  it('replays checked rounds in order, per facet; unchecked rounds are ignored', () => {
    const replayed = replayTrainerRounds([
      round('b', NOW - 4 * DAY, 'context', 'ate', 'eat'),
      round('a', NOW - 5 * DAY, 'spelling', 'eat', 'eat'),
      round('c', NOW - 3 * DAY, 'spelling', 'eat', 'eat'),
      round('open', null, 'spelling', 'eat', 'zzz'),
    ]).get('demo/en:eat:verb/s1');
    expect(replayed?.recall).toMatchObject({ step: 2, attempts: [{ roundId: 'a' }, { roundId: 'c' }] });
    expect(replayed?.context).toMatchObject({ step: 0, attempts: [{ outcome: 'wrong_form', expected: 'ate' }] });
    expect(replayed?.recognition).toBeUndefined();
  });

  it('migrates a library sense once, leaves its old schedule untouched, and starts saved senses untested', () => {
    const legacy = libraryEntry();
    const manual = personalEntry('manual', { expression: 'run', translations: ['correr'] });
    const sets = [round('a', NOW - 5 * DAY, 'spelling', 'eat', 'eat')];
    const [migrated, ...rest] = migrateLegacyKnowledge([legacy, manual], sets);
    expect(rest).toEqual([]);
    expect(migrated?.senses[0]?.knowledge?.recall?.step).toBe(1);
    expect(migrated?.review).toEqual(legacy.review);
    expect(vocabularyEntrySchema.parse(migrated)).toBeTruthy();
    // Idempotent: nothing left to migrate.
    expect(migrateLegacyKnowledge([migrated!, manual], sets)).toEqual([]);
    // A library sense with no surviving rounds is marked migrated with no evidence (never inflated).
    expect(migrateLegacyKnowledge([legacy], [])[0]?.senses[0]?.knowledge).toEqual({});
  });
});
