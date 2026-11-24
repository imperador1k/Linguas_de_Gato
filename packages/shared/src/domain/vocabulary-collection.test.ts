import { describe, expect, it } from 'vitest';
import { vocabularyPracticeSetSchema, type LocalVocabularyQuestion, type VocabularyAnswer, type VocabularyEntry } from '../contracts/vocabulary.js';
import { describeMatch } from './vocabulary-answers.js';
import { buildCollectionRound, collectionCandidates, collectionQuestion, contextsOf, entryMatchesFilter, focusCounts, knowledgeSummary, supportedFacets } from './vocabulary-collection.js';
import { DAY_MS as DAY, V1_NOW as NOW, personalEntry } from './vocabulary-fixtures.test-helpers.js';
import { recordFacetAttempt, withFacetAttempt } from './vocabulary-knowledge.js';
import { matchLocalAnswer, situationOf } from './vocabulary-trainer.js';
import { evaluateVocabularyAnswer, saveLookup } from './vocabulary.js';

const typed = (question: LocalVocabularyQuestion, text: string, hints: VocabularyAnswer extends infer A ? (A extends { kind: 'typed'; hints: infer H } ? H : never) : never = []): VocabularyAnswer => ({ kind: 'typed', questionId: question.id, text, hints, answeredAt: NOW });
const verdict = (question: LocalVocabularyQuestion, text: string) => matchLocalAnswer(question, typed(question, text))?.verdict;

const eat = personalEntry('eat', { translations: ['comer', 'alimentar-se'], alternatives: [], forms: ['eats', 'ate', 'eaten', 'eating'], example: 'I usually ate breakfast at 8 AM.' });
const eatSense = eat.senses[0]!;

describe('context sentences', () => {
  it('finds the word or one of its listed forms, whole words only, longest first', () => {
    expect(contextsOf(eat, eatSense)).toEqual([{ id: 'c1', sentence: 'I usually ___ breakfast at 8 AM.', answer: 'ate', full: 'I usually ate breakfast at 8 AM.' }]);
    expect(contextsOf({ lemma: 'look after', expression: 'look after' }, { context: 'She Looked  after the kids.', examples: [], forms: ['looked after', 'look'] })[0]).toMatchObject({ sentence: 'She ___ the kids.', answer: 'looked after' });
    // "eat" inside "beat" or "eaten" inside "eatenly" is not the word.
    expect(contextsOf({ lemma: 'eat', expression: 'eat' }, { context: 'They beat us.', examples: [], forms: [] })).toEqual([]);
    expect(contextsOf({ lemma: 'eat', expression: 'eat' }, { context: 'Eat your soup.', examples: ['We want to eat something.'], forms: [] }).map((context) => [context.sentence, context.answer])).toEqual([
      ['___ your soup.', 'eat'],
      ['We want to ___ something.', 'eat'],
    ]);
  });

  it('offers only the directions the data supports', () => {
    expect(supportedFacets(eat, eatSense)).toEqual(['recognition', 'recall', 'context']);
    const noExample = personalEntry('run', { expression: 'run', translations: ['correr'], example: '' });
    expect(supportedFacets(noExample, noExample.senses[0]!)).toEqual(['recognition', 'recall']);
    // A Reading save without a translation: context only (its real sentence contains the word).
    const lookup = { expression: 'breaking even', lemma: 'break even', kind: 'idiom' as const, partOfSpeech: 'phrase', contextualMeaning: 'making no profit', dictionaryMeaning: 'to have no profit or loss', contextEvidence: 'breaking even', collocations: [], synonyms: [], antonyms: [], register: 'neutral' as const, examples: ['x', 'y'], patterns: [], cefrEstimate: 'B2' as const, portugueseExplanation: null };
    const reading = saveLookup(null, lookup, { sentence: 'Some owners are only breaking even.', source: { kind: 'reading', textId: 't', title: 'T', paragraphIndex: 0 } }, NOW, { entryId: 'r', senseId: 'rs' }).entry;
    expect(supportedFacets(reading, reading.senses[0]!)).toEqual(['context']);
    const question = collectionQuestion(reading, reading.senses[0]!, 'context', 0, 's');
    expect(question).toMatchObject({ prompt: 'Some owners are only ___.', answer: 'breaking even', clue: 'making no profit', forms: ['break even'] });
    expect(() => collectionQuestion(reading, reading.senses[0]!, 'recall', 0, 's')).toThrow();
  });
});

describe('Portuguese → English (recall)', () => {
  const question = collectionQuestion(eat, eatSense, 'recall', 0, 's');

  it('prompts with the translations and expects the dictionary form', () => {
    expect(question).toMatchObject({ type: 'spelling', prompt: 'comer / alimentar-se', answer: 'eat', itemId: 'collection/eat/eat-s1', partOfSpeech: 'verb', ref: { kind: 'collection', entryId: 'eat', senseId: 'eat-s1', contextId: null } });
  });

  it('accepts harmless differences, and the infinitive marker for a verb, but not other forms', () => {
    expect(verdict(question, 'eat')).toBe('correct');
    expect(verdict(question, '  EAT. ')).toBe('correct');
    expect(verdict(question, '“eat”')).toBe('correct');
    expect(verdict(question, 'to eat')).toBe('correct');
    expect(verdict(question, 'ate')).toBe('wrong_form');
    expect(verdict(question, 'eating')).toBe('wrong_form');
    expect(verdict(question, 'drink')).toBe('incorrect');
    expect(describeMatch(matchLocalAnswer(question, typed(question, 'ate'))!, situationOf(question))).toBe('Right word, wrong grammatical form. Write the dictionary form: “eat”.');
  });

  it('accepts only the alternatives listed for this sense', () => {
    const colour = personalEntry('colour', { expression: 'colour', translations: ['cor'], partOfSpeech: 'noun', alternatives: ['color'], forms: ['colours'], example: '' });
    const recall = collectionQuestion(colour, colour.senses[0]!, 'recall', 0, 's');
    const result = matchLocalAnswer(recall, typed(recall, 'color'))!;
    expect(result).toMatchObject({ verdict: 'correct', reason: 'variant' });
    expect(describeMatch(result, situationOf(recall))).toContain('accepted alternative');
    // A plausible synonym that was never listed is not accepted.
    expect(verdict(recall, 'hue')).toBe('incorrect');
    // Nouns get no infinitive marker.
    expect(verdict(recall, 'to colour')).toBe('incorrect');
  });
});

describe('English → Portuguese (recognition)', () => {
  const question = collectionQuestion(eat, eatSense, 'recognition', 0, 's');

  it('shows the English word with its example and accepts every listed translation', () => {
    expect(question).toMatchObject({ type: 'recognition', prompt: 'eat', example: 'I usually ate breakfast at 8 AM.', answer: 'comer', accepted: ['alimentar-se'] });
    expect(verdict(question, 'comer')).toBe('correct');
    expect(matchLocalAnswer(question, typed(question, 'Alimentar-se'))).toMatchObject({ verdict: 'correct', reason: 'variant', closest: 'alimentar-se' });
    expect(verdict(question, 'beber')).toBe('incorrect');
    expect(evaluateVocabularyAnswer(question, typed(question, 'comer'))).toBe('correct');
  });

  it('uses Portuguese rules: accents matter (a near miss), a leading article does not', () => {
    const book = personalEntry('book', { expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '', forms: [] });
    const recognition = collectionQuestion(book, book.senses[0]!, 'recognition', 0, 's');
    expect(verdict(recognition, 'o livro')).toBe('correct');
    expect(verdict(recognition, 'Um livro!')).toBe('correct');
    const cafe = personalEntry('coffee', { expression: 'coffee', translations: ['café'], partOfSpeech: 'noun', example: '', forms: [] });
    const coffee = collectionQuestion(cafe, cafe.senses[0]!, 'recognition', 0, 's');
    expect(matchLocalAnswer(coffee, typed(coffee, 'cafe'))).toMatchObject({ verdict: 'almost', reason: 'accents' });
    expect(evaluateVocabularyAnswer(coffee, typed(coffee, 'cafe'))).toBe('incorrect');
  });
});

describe('context and grammatical forms', () => {
  const question = collectionQuestion(eat, eatSense, 'context', 0, 's');

  it('expects the form the sentence needs; the lemma and other forms are the wrong form for it', () => {
    expect(question).toMatchObject({ type: 'context', prompt: 'I usually ___ breakfast at 8 AM.', answer: 'ate', clue: 'comer, alimentar-se', accepted: [], ref: { contextId: 'c1' } });
    expect(verdict(question, 'ate')).toBe('correct');
    expect(verdict(question, 'Ate')).toBe('correct');
    expect(verdict(question, 'eat')).toBe('wrong_form');
    expect(verdict(question, 'eaten')).toBe('wrong_form');
    expect(verdict(question, 'had')).toBe('incorrect');
    expect(describeMatch(matchLocalAnswer(question, typed(question, 'eat'))!, situationOf(question))).toBe('Right word and meaning, but not the form this sentence needs: “ate”.');
  });

  it('works with the lemma itself in the sentence ("I want to ___ something.")', () => {
    const plain = personalEntry('eat2', { example: 'I want to eat something.' });
    const context = collectionQuestion(plain, plain.senses[0]!, 'context', 0, 's');
    expect(context).toMatchObject({ prompt: 'I want to ___ something.', answer: 'eat' });
    expect(verdict(context, 'eat')).toBe('correct');
    expect(verdict(context, 'eats')).toBe('wrong_form');
  });
});

describe('choosing what to train', () => {
  const book = personalEntry('book', { expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: 'I read a book.', forms: ['books'] }, { expression: 'book', translations: ['reservar'], partOfSpeech: 'verb', example: 'We booked a table.', forms: ['booked'] });
  const run = personalEntry('run', { expression: 'run', translations: ['correr'], example: '', forms: [] });
  const entries: VocabularyEntry[] = [eat, book, run];

  it('asks at most one question per entry (two meanings of "book" would give each other away), deterministically', () => {
    const round = buildCollectionRound({ entries, exercise: 'recall', focus: 'mixed', count: 10, seed: 'a', now: NOW });
    expect(round).toHaveLength(3);
    expect(round.filter((question) => question.lemma === 'book')).toHaveLength(1);
    expect(buildCollectionRound({ entries, exercise: 'recall', focus: 'mixed', count: 10, seed: 'a', now: NOW })).toEqual(round);
    expect(round.map((question) => question.id)).toEqual(['q1', 'q2', 'q3']);
    expect(buildCollectionRound({ entries, exercise: 'recall', focus: 'mixed', count: 2, seed: 'a', now: NOW })).toHaveLength(2);
  });

  it('stores up to 20 questions in one round', () => {
    const many = Array.from({ length: 20 }, (_, index) => personalEntry(`w${index}`, { expression: `word${index}`, translations: [`palavra${index}`], example: '', forms: [] }));
    const round = buildCollectionRound({ entries: many, exercise: 'recognition', focus: 'new', count: 20, seed: 'b', now: NOW });
    expect(round).toHaveLength(20);
    const set = { id: 'set', version: 1, entryIds: round.map((question) => question.itemId), types: ['recognition'], questions: round, shuffles: {}, discarded: 0, model: 'local', answers: [], reviews: [], checkedAt: null, history: [], createdAt: NOW, updatedAt: NOW };
    expect(vocabularyPracticeSetSchema.safeParse(set).success).toBe(true);
  });

  it('with the mixed exercise, recognises a new word first, then recalls it, then uses it', () => {
    const [first] = buildCollectionRound({ entries: [eat], exercise: 'mixed', focus: 'mixed', count: 1, seed: 'c', now: NOW });
    expect(first?.type).toBe('recognition');
    const recognised: VocabularyEntry = { ...eat, senses: [withFacetAttempt(eatSense, 'recognition', { result: { verdict: 'correct', reason: 'exact', closest: 'comer' }, hints: 0, expected: 'comer', roundId: 'r' }, NOW)] };
    expect(buildCollectionRound({ entries: [recognised], exercise: 'mixed', focus: 'mixed', count: 1, seed: 'c', now: NOW })[0]?.type).toBe('spelling');
  });

  it('filters by focus: due, difficult and new are about the trained direction', () => {
    const recallFailed: VocabularyEntry = { ...run, senses: [{ ...run.senses[0]!, knowledge: { recall: recordFacetAttempt(undefined, { result: { verdict: 'incorrect', reason: 'none', closest: 'run' }, hints: 0, expected: 'run', roundId: 'r' }, NOW - 2 * DAY) } }] };
    const pool = [eat, book, recallFailed];
    expect(collectionCandidates(pool, { exercise: 'recall', focus: 'due', now: NOW }).map((candidate) => candidate.entry.id)).toEqual(['run']);
    expect(collectionCandidates(pool, { exercise: 'recall', focus: 'difficult', now: NOW }).map((candidate) => candidate.entry.id)).toEqual(['run']);
    // Recognition of "run" was never tested, so it is new in that direction even though recall is due.
    expect(collectionCandidates(pool, { exercise: 'recognition', focus: 'new', now: NOW }).map((candidate) => candidate.entry.id).sort()).toEqual(['book', 'eat', 'run']);
    expect(collectionCandidates(pool, { exercise: 'recognition', focus: 'due', now: NOW })).toEqual([]);
    expect(focusCounts(pool, 'recall', NOW)).toEqual({ mixed: 3, due: 1, difficult: 1, new: 2 });
    // In a mixed round the difficult, due word comes first.
    expect(buildCollectionRound({ entries: pool, exercise: 'recall', focus: 'mixed', count: 3, seed: 'd', now: NOW })[0]?.lemma).toBe('run');
  });

  it('summarises what the learner has shown, per meaning', () => {
    const recognised: VocabularyEntry = {
      ...eat,
      senses: [{ ...eatSense, knowledge: { recognition: { step: 2, dueAt: NOW + 3 * DAY, attempts: [{ at: NOW - DAY, outcome: 'correct', hints: 0, expected: 'comer', roundId: 'r' }, { at: NOW, outcome: 'correct', hints: 0, expected: 'comer', roundId: 'r2' }] }, context: { step: 0, dueAt: NOW, attempts: [{ at: NOW, outcome: 'correct', hints: 0, expected: 'ate', roundId: 'r2' }] } } }],
    };
    expect(entryMatchesFilter(recognised, 'recognise_not_recall', NOW)).toBe(true);
    expect(entryMatchesFilter(recognised, 'used_in_context', NOW)).toBe(true);
    expect(entryMatchesFilter(recognised, 'untested', NOW)).toBe(false);
    expect(knowledgeSummary([recognised, book, run], NOW)).toMatchObject({ recognise_not_recall: 1, used_in_context: 1, untested: 2, due: 1, difficult: 0 });
  });
});
