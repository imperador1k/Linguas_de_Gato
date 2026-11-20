import { describe, expect, it } from 'vitest';
import { generationRequestSchema } from '../contracts/exercise-generation.js';
import {
  modelVocabularyLookupSchema,
  vocabularyEntrySchema,
  vocabularyEvaluationRequestSchema,
  vocabularyLookupRequestSchema,
  vocabularyPracticeSetSchema,
  type ModelVocabularyLookup,
  type PracticeItem,
  type VocabularyPracticeSet,
} from '../contracts/vocabulary.js';
import {
  REVIEW_LADDER_DAYS,
  checkVocabularySet,
  dueEntries,
  evaluateVocabularyAnswer,
  initialReviewState,
  lookupMatchesContext,
  retryVocabularySet,
  saveLookup,
  scheduleReview,
  scoreVocabularySet,
  seededShuffle,
  verifyVocabularyQuestions,
  vocabularyKey,
  withVocabularyAnswer,
  withVocabularyReview,
  withoutSense,
} from './vocabulary.js';

const DAY = 86_400_000;
const SENTENCE = 'Rents in city centres have doubled in a decade, and some owners admit they are only breaking even.';

const lookup: ModelVocabularyLookup = {
  expression: 'breaking even',
  lemma: 'break even',
  kind: 'phrasal_verb',
  partOfSpeech: 'phrasal verb',
  contextualMeaning: 'earning just enough to cover their costs, with no profit',
  dictionaryMeaning: 'to make neither a profit nor a loss',
  contextEvidence: 'they are only breaking even',
  collocations: ['just break even', 'break even after two years'],
  synonyms: ['cover your costs'],
  antonyms: ['make a profit', 'make a loss'],
  register: 'neutral',
  examples: ['The café broke even in its first year.', 'We need to sell 500 tickets to break even.'],
  patterns: ['break even (intransitive)'],
  cefrEstimate: 'C1',
  portugueseExplanation: null,
};

const source = { kind: 'reading' as const, textId: 't1', title: 'Bookshops', paragraphIndex: 2 };

describe('lookup contracts', () => {
  const request = { expression: 'breaking even', sentence: SENTENCE, paragraph: SENTENCE, explanationLanguage: 'en' };

  it('validates lookup requests', () => {
    expect(vocabularyLookupRequestSchema.safeParse(request).success).toBe(true);
    expect(vocabularyLookupRequestSchema.safeParse({ ...request, expression: 'one two three four five six seven eight nine' }).success).toBe(false);
    expect(vocabularyLookupRequestSchema.safeParse({ ...request, sentence: 'x'.repeat(601) }).success).toBe(false);
    expect(vocabularyLookupRequestSchema.safeParse({ ...request, explanationLanguage: 'fr' }).success).toBe(false);
  });

  it('validates model lookups', () => {
    expect(modelVocabularyLookupSchema.safeParse(lookup).success).toBe(true);
    expect(modelVocabularyLookupSchema.safeParse({ ...lookup, cefrEstimate: 'C3' }).success).toBe(false);
    expect(modelVocabularyLookupSchema.safeParse({ ...lookup, examples: ['Only one.'] }).success).toBe(false);
    const { contextualMeaning: _meaning, ...missing } = lookup;
    expect(modelVocabularyLookupSchema.safeParse(missing).success).toBe(false);
  });

  it('checks that a lookup is about the selected words in this sentence', () => {
    expect(lookupMatchesContext(lookup, SENTENCE, 'breaking even')).toBe(true);
    expect(lookupMatchesContext({ contextEvidence: 'they are breaking the law' }, SENTENCE, 'breaking')).toBe(false);
    expect(lookupMatchesContext({ contextEvidence: 'owners admit' }, SENTENCE, 'breaking even')).toBe(false);
  });
});

describe('saving to the collection', () => {
  it('creates an entry keyed by lemma', () => {
    const { entry, outcome } = saveLookup(null, lookup, { sentence: SENTENCE, source }, 1000, { entryId: 'e1', senseId: 's1' });
    expect(outcome).toBe('created');
    expect(entry).toMatchObject({ key: 'break even', kind: 'phrasal_verb', review: { status: 'new', dueAt: 1000 } });
    expect(vocabularyEntrySchema.safeParse(entry).success).toBe(true);
    expect(vocabularyKey('  Break  Even ')).toBe('break even');
  });

  it('does not duplicate the same meaning, but adds a different contextual meaning', () => {
    const { entry } = saveLookup(null, lookup, { sentence: SENTENCE, source }, 1000, { entryId: 'e1', senseId: 's1' });
    const again = saveLookup(entry, { ...lookup, contextualMeaning: 'reworded' }, { sentence: 'Another sentence about breaking even.', source }, 2000, { entryId: 'x', senseId: 's2' });
    expect(again.outcome).toBe('already_saved');
    expect(again.entry).toBe(entry);

    const sameSentence = saveLookup(entry, { ...lookup, dictionaryMeaning: 'different wording' }, { sentence: SENTENCE, source }, 2000, { entryId: 'x', senseId: 's2' });
    expect(sameSentence.outcome).toBe('already_saved');

    const other = saveLookup(
      { ...entry, review: { ...entry.review, dueAt: 9_999_999 } },
      { ...lookup, dictionaryMeaning: '(of waves) to collapse into foam', contextualMeaning: 'the waves collapsing' },
      { sentence: 'Waves were breaking evenly along the shore.', source: { kind: 'manual' } },
      3000,
      { entryId: 'x', senseId: 's3' },
    );
    expect(other.outcome).toBe('added_sense');
    expect(other.entry.senses.map((sense) => sense.id)).toEqual(['s1', 's3']);
    expect(other.entry.review.dueAt).toBe(3000);
  });

  it('stores collocations, phrasal verbs and idioms with their details', () => {
    const idiom = saveLookup(null, { ...lookup, expression: 'stay for the conversation', lemma: 'stay for the conversation', kind: 'expression' }, { sentence: SENTENCE, source }, 1, { entryId: 'e2', senseId: 's' });
    expect(idiom.entry.kind).toBe('expression');
    expect(idiom.entry.senses[0]?.collocations).toEqual(lookup.collocations);
  });

  it('removes senses and reports when the entry becomes empty', () => {
    const { entry } = saveLookup(null, lookup, { sentence: SENTENCE, source }, 1000, { entryId: 'e1', senseId: 's1' });
    expect(withoutSense(entry, 's1', 2)).toBeNull();
  });
});

describe('review schedule', () => {
  const now = 10 * DAY;

  it('moves up a fixed ladder, back on "again", and marks entries known from about two weeks', () => {
    let state = initialReviewState(now);
    state = scheduleReview(state, 'good', now);
    expect(state).toMatchObject({ status: 'learning', step: 1, dueAt: now + DAY });
    state = scheduleReview(state, 'easy', now);
    expect(state).toMatchObject({ step: 3, dueAt: now + 7 * DAY });
    state = scheduleReview(state, 'good', now);
    expect(state).toMatchObject({ status: 'known', step: 4, dueAt: now + 16 * DAY });
    state = scheduleReview(state, 'again', now);
    expect(state).toMatchObject({ status: 'learning', step: 1, dueAt: now + DAY });
    expect(state.history.map((item) => item.rating)).toEqual(['good', 'easy', 'good', 'again']);
    const top = scheduleReview({ ...state, step: REVIEW_LADDER_DAYS.length - 1 }, 'easy', now);
    expect(top.step).toBe(REVIEW_LADDER_DAYS.length - 1);
  });

  it('lists due entries, oldest first', () => {
    const make = (id: string, dueAt: number) => ({ ...saveLookup(null, lookup, { sentence: SENTENCE, source }, 1, { entryId: id, senseId: 's' }).entry, review: { ...initialReviewState(1), dueAt } });
    expect(dueEntries([make('a', now + 1), make('b', now - 5), make('c', now - 10)], now).map((entry) => entry.id)).toEqual(['c', 'b']);
  });
});

// --- Practice ---------------------------------------------------------------------------

const items: PracticeItem[] = [
  { id: 'e1', expression: 'break even', meaning: 'make neither profit nor loss', context: SENTENCE },
  { id: 'e2', expression: 'doomed', meaning: 'certain to fail', context: 'The corner bookshop seemed doomed.' },
  { id: 'e3', expression: 'bring in', meaning: 'earn (money)', context: 'Events bring in a third of their income.' },
];

const q = {
  gap: { type: 'gap_fill', itemId: 'e1', prompt: 'After two difficult years, the theatre finally ___.', options: [], correctOptionIndex: null, acceptedAnswers: ['broke even'], pairs: [], explanation: 'Past simple of "break even".' },
  meaning: { type: 'meaning_choice', itemId: 'e2', prompt: 'In "the plan was doomed", doomed means…', options: ['certain to fail', 'very expensive', 'kept secret'], correctOptionIndex: 0, acceptedAnswers: [], pairs: [], explanation: 'Doomed = certain to fail.' },
  collocation: { type: 'collocation', itemId: 'e3', prompt: 'The new product should ___ extra revenue.', options: ['bring in', 'bring up', 'bring about'], correctOptionIndex: 0, acceptedAnswers: [], pairs: [], explanation: 'Bring in revenue.' },
  matching: {
    type: 'matching',
    itemId: 'e1',
    prompt: 'Match each expression to its meaning.',
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: [],
    pairs: items.map((item) => ({ itemId: item.id, expression: item.expression, meaning: item.meaning })),
    explanation: 'Each expression with its meaning.',
  },
  completion: { type: 'sentence_completion', itemId: 'e2', prompt: 'Without new investment, the project ___', options: [], correctOptionIndex: null, acceptedAnswers: ['was doomed to fail'], pairs: [], explanation: 'Doomed to fail.' },
  paraphrase: { type: 'paraphrase', itemId: 'e1', prompt: 'Rewrite using "break even": The shop covered its costs but made no profit.', options: [], correctOptionIndex: null, acceptedAnswers: ['The shop broke even.'], pairs: [], explanation: 'Break even = no profit, no loss.' },
  own: { type: 'own_sentence', itemId: 'e3', prompt: 'Write your own sentence with "bring in".', options: [], correctOptionIndex: null, acceptedAnswers: [], pairs: [], explanation: 'Use it about earning money.' },
};
const ALL = ['gap_fill', 'meaning_choice', 'collocation', 'matching', 'sentence_completion', 'paraphrase', 'own_sentence'] as const;

describe('practice contracts and verification', () => {
  it('validates practice and evaluation requests', () => {
    const request = { kind: 'vocabulary_practice', types: ['gap_fill', 'matching'], questionCount: 6, items };
    expect(generationRequestSchema.safeParse(request).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...request, items: items.slice(0, 2) }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, items: [items[0], items[0]] }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, types: ['spelling_bee'] }).success).toBe(false);
    const evaluation = { expression: 'bring in', meaning: 'earn', task: 'own_sentence', prompt: 'Write a sentence.', exampleAnswers: [], answer: 'Tourism brings in millions.' };
    expect(vocabularyEvaluationRequestSchema.safeParse(evaluation).success).toBe(true);
    expect(vocabularyEvaluationRequestSchema.safeParse({ ...evaluation, task: 'gap_fill' }).success).toBe(false);
    expect(vocabularyEvaluationRequestSchema.safeParse({ ...evaluation, answer: 'x'.repeat(401) }).success).toBe(false);
  });

  it('keeps consistent questions of every type', () => {
    const { questions, discarded } = verifyVocabularyQuestions(Object.values(q), items, { types: [...ALL], maxQuestions: 12 });
    expect(discarded).toBe(0);
    expect(questions.map((question) => question.type)).toEqual([...ALL]);
  });

  it('drops questions about unknown items, without a gap, with bad keys or answers that ignore the expression', () => {
    const bad = [
      { ...q.gap, itemId: 'e9' },
      { ...q.gap, prompt: 'No gap here.' },
      { ...q.gap, acceptedAnswers: ['succeeded'] },
      { ...q.meaning, correctOptionIndex: 3 },
      { ...q.meaning, options: ['certain to fail', 'Certain to fail.', 'other'] },
      { ...q.matching, pairs: q.matching.pairs.slice(0, 2) },
      { ...q.matching, pairs: [...q.matching.pairs.slice(0, 2), { itemId: 'e9', expression: 'x', meaning: 'y' }] },
      { ...q.paraphrase, acceptedAnswers: ['The shop made no money.'] },
      { ...q.own, type: 'crossword' },
    ];
    expect(verifyVocabularyQuestions(bad, items, { types: [...ALL], maxQuestions: 12 })).toEqual({ questions: [], discarded: bad.length });
  });

  it('accepts inflected forms of the expression in gap answers', () => {
    expect(verifyVocabularyQuestions([{ ...q.gap, acceptedAnswers: ['broke even', 'breaks even'] }], items, { types: ['gap_fill'], maxQuestions: 4 }).questions).toHaveLength(1);
  });

  it('shuffles matching deterministically and never pre-solved', () => {
    expect(seededShuffle(4, 'abc')).toEqual(seededShuffle(4, 'abc'));
    for (const seed of ['a', 'b', 'c', 'd', 'e']) expect(seededShuffle(3, seed)).not.toEqual([0, 1, 2]);
  });
});

describe('practice scoring and lifecycle', () => {
  const { questions } = verifyVocabularyQuestions(Object.values(q), items, { types: [...ALL], maxQuestions: 12 });
  const set: VocabularyPracticeSet = {
    id: 'p',
    version: 1,
    entryIds: ['e1', 'e2', 'e3'],
    types: [...ALL],
    questions,
    shuffles: { q4: [2, 0, 1] },
    discarded: 0,
    model: 'm',
    answers: [],
    reviews: [],
    checkedAt: null,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const [gap, meaning, collocation, matching, completion, paraphrase, own] = questions;

  it('scores objective questions deterministically', () => {
    expect(evaluateVocabularyAnswer(gap!, { kind: 'text', questionId: 'q1', text: 'Broke even.' })).toBe('correct');
    expect(evaluateVocabularyAnswer(gap!, { kind: 'text', questionId: 'q1', text: 'broke' })).toBe('incorrect');
    expect(evaluateVocabularyAnswer(meaning!, { kind: 'choice', questionId: 'q2', selectedIndex: 0 })).toBe('correct');
    expect(evaluateVocabularyAnswer(collocation!, { kind: 'choice', questionId: 'q3', selectedIndex: 2 })).toBe('incorrect');
    expect(evaluateVocabularyAnswer(matching!, { kind: 'matching', questionId: 'q4', choices: [0, 1, 2] })).toBe('correct');
    expect(evaluateVocabularyAnswer(matching!, { kind: 'matching', questionId: 'q4', choices: [1, 0, 2] })).toBe('incorrect');
    expect(evaluateVocabularyAnswer(matching!, { kind: 'matching', questionId: 'q4', choices: [-1, -1, -1] })).toBe('unanswered');
  });

  it('never marks an unlisted open answer as correct or wrong by string matching', () => {
    expect(evaluateVocabularyAnswer(completion!, { kind: 'text', questionId: 'q5', text: 'was doomed to fail' })).toBe('correct');
    expect(evaluateVocabularyAnswer(completion!, { kind: 'text', questionId: 'q5', text: 'seemed doomed from the start' })).toBe('open');
    expect(evaluateVocabularyAnswer(paraphrase!, { kind: 'text', questionId: 'q6', text: 'It broke even last year.' })).toBe('open');
    expect(evaluateVocabularyAnswer(own!, { kind: 'text', questionId: 'q7', text: 'Tourism brings in money.' })).toBe('open');
  });

  it('records answers, checks, keeps history, accepts AI reviews only for open answers, and retries', () => {
    let current = withVocabularyAnswer(set, { kind: 'text', questionId: 'q1', text: 'broke even' }, 2);
    current = withVocabularyAnswer(current, { kind: 'choice', questionId: 'q2', selectedIndex: 1 }, 2);
    current = withVocabularyAnswer(current, { kind: 'text', questionId: 'q7', text: 'Tourism brings in money.' }, 2);
    expect(withVocabularyAnswer(current, { kind: 'choice', questionId: 'q1', selectedIndex: 0 }, 2)).toBe(current);
    expect(scoreVocabularySet(current)).toEqual({ total: 7, answered: 3, objectiveTotal: 4, correct: 1, open: 1 });

    const review = { questionId: 'q7', answer: 'Tourism brings in money.', verdict: 'correct' as const, usesExpressionCorrectly: true, feedback: 'Natural.', improvedAnswer: null, model: 'm', createdAt: 3 };
    expect(withVocabularyReview(current, review, 3)).toBe(current);
    current = checkVocabularySet(current, 3);
    expect(current.history).toEqual([{ checkedAt: 3, correct: 1, objectiveTotal: 4 }]);
    expect(withVocabularyReview(current, { ...review, questionId: 'q2' }, 4)).toBe(current);
    expect(withVocabularyReview(current, { ...review, answer: 'changed' }, 4)).toBe(current);
    current = withVocabularyReview(current, review, 4);
    expect(current.reviews).toHaveLength(1);
    expect(scoreVocabularySet(current).correct).toBe(1);
    expect(vocabularyPracticeSetSchema.safeParse(current).success).toBe(true);

    const retried = retryVocabularySet(current, 5);
    expect(retried).toMatchObject({ answers: [], reviews: [], checkedAt: null });
    expect(retried.history).toHaveLength(1);
  });
});
