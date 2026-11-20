import { describe, expect, it } from 'vitest';
import { generationRequestSchema, generationResultSchema } from '../contracts/exercise-generation.js';
import { grammarEvaluationRequestSchema, grammarSetRecordSchema, type GrammarQuestion, type GrammarSetRecord } from '../contracts/grammar.js';
import {
  canRequestReview,
  checkGrammarSet,
  evaluateGrammarAnswer,
  normalizeAnswer,
  retryGrammarSet,
  scoreGrammarSet,
  verifyGrammarQuestions,
  withGrammarAnswer,
  withGrammarReview,
  wordTokens,
} from './grammar-answers.js';

const ALL_TYPES = ['multiple_choice', 'gap_fill', 'error_correction', 'transformation', 'word_order', 'sentence_completion'] as const;

const raw = {
  multipleChoice: {
    type: 'multiple_choice',
    prompt: 'If I ___ about the traffic, I would have left earlier.',
    sourceSentence: null,
    keyword: null,
    words: [],
    options: ['knew', 'had known', 'have known', 'would know'],
    correctOptionIndex: 1,
    acceptedAnswers: [],
    explanation: 'An unreal past condition takes the past perfect.',
    rule: 'Third conditional: if + past perfect, would have + past participle.',
    distractorExplanations: ['Past simple is for second conditionals.', 'Correct.', 'Present perfect cannot follow "if" here.', '"Would" does not go in the if-clause.'],
  },
  gapFill: {
    type: 'gap_fill',
    prompt: 'Had she ___ (know) the truth, she would have spoken up.',
    sourceSentence: null,
    keyword: null,
    words: [],
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: ['known'],
    explanation: 'Inverted third conditional uses the past participle.',
    rule: 'Had + subject + past participle replaces "if + past perfect".',
    distractorExplanations: [],
  },
  errorCorrection: {
    type: 'error_correction',
    prompt: 'If I would have known, I would have helped.',
    sourceSentence: null,
    keyword: null,
    words: [],
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: ['If I had known, I would have helped.', 'Had I known, I would have helped.'],
    explanation: '"Would" is not used in the if-clause.',
    rule: 'Use the past perfect in the if-clause of a third conditional.',
    distractorExplanations: [],
  },
  transformation: {
    type: 'transformation',
    prompt: 'I ___ the exam if I had studied harder.',
    sourceSentence: 'I failed the exam because I did not study hard enough.',
    keyword: 'passed',
    words: [],
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: ['would have passed', "would've passed"],
    explanation: 'The result of an unreal past condition uses would have + past participle.',
    rule: 'Third conditional result clause.',
    distractorExplanations: [],
  },
  wordOrder: {
    type: 'word_order',
    prompt: 'Put the words in order to make a sentence.',
    sourceSentence: null,
    keyword: null,
    words: ['never', 'have', 'I', 'seen', 'such', 'chaos'],
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: ['Never have I seen such chaos.'],
    explanation: 'Negative adverbials at the start trigger inversion.',
    rule: 'Never + auxiliary + subject.',
    distractorExplanations: [],
  },
  completion: {
    type: 'sentence_completion',
    prompt: 'Not only did the plan fail, ___',
    sourceSentence: null,
    keyword: null,
    words: [],
    options: [],
    correctOptionIndex: null,
    acceptedAnswers: ['but it also cost a fortune', 'but it also damaged trust'],
    explanation: '"Not only" is completed with "but (also)".',
    rule: 'Not only + inversion ..., but (also) + clause.',
    distractorExplanations: [],
  },
};

const verifyAll = (items: readonly unknown[], types: readonly (typeof ALL_TYPES)[number][] = ALL_TYPES, maxQuestions = 12) => verifyGrammarQuestions(items, { types, maxQuestions });

describe('grammar generation contracts', () => {
  const request = { kind: 'grammar', level: 'C1', topic: 'conditionals', types: ['multiple_choice', 'gap_fill'], questionCount: 8, focus: null, avoidTitles: [] };

  it('validates generation requests', () => {
    expect(generationRequestSchema.safeParse(request).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...request, topic: 'tenses' }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, types: ['essay'] }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, types: ['gap_fill', 'gap_fill'] }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, questionCount: 13 }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, focus: 'x'.repeat(201) }).success).toBe(false);
  });

  it('validates second-opinion requests', () => {
    const evaluation = {
      level: 'C1',
      topic: 'conditionals',
      question: { type: 'transformation', prompt: 'I ___ the exam.', sourceSentence: 'I failed.', keyword: 'PASSED', acceptedAnswers: ['would have passed'], rule: 'r' },
      answer: 'would have passed',
    };
    expect(grammarEvaluationRequestSchema.safeParse(evaluation).success).toBe(true);
    expect(grammarEvaluationRequestSchema.safeParse({ ...evaluation, question: { ...evaluation.question, type: 'multiple_choice' } }).success).toBe(false);
    expect(grammarEvaluationRequestSchema.safeParse({ ...evaluation, answer: 'x'.repeat(401) }).success).toBe(false);
  });
});

describe('answer normalisation', () => {
  it('ignores harmless differences', () => {
    expect(normalizeAnswer('  Had I KNOWN , I would have helped. ')).toBe(normalizeAnswer('had I known, I would have helped'));
    expect(normalizeAnswer('I don’t know')).toBe(normalizeAnswer('I do not know'));
    expect(normalizeAnswer("would've passed")).toBe(normalizeAnswer('would have passed'));
    expect(normalizeAnswer("can't")).toBe(normalizeAnswer('cannot'));
    expect(normalizeAnswer('"known"')).toBe('known');
  });

  it('keeps meaningful distinctions', () => {
    expect(normalizeAnswer('who')).not.toBe(normalizeAnswer('whom'));
    expect(normalizeAnswer('My brother, who lives in Paris, is a chef')).not.toBe(normalizeAnswer('My brother who lives in Paris is a chef'));
    expect(normalizeAnswer('the book')).not.toBe(normalizeAnswer('a book'));
    expect(normalizeAnswer('had known')).not.toBe(normalizeAnswer('has known'));
  });

  it('tokenises words for word order', () => {
    expect(wordTokens('Never have I seen such chaos!')).toEqual(['never', 'have', 'i', 'seen', 'such', 'chaos']);
  });
});

describe('verifying generated questions', () => {
  it('keeps consistent questions of every type', () => {
    const result = verifyAll(Object.values(raw));
    expect(result.discarded).toBe(0);
    expect(result.questions.map((question) => question.type)).toEqual(['multiple_choice', 'gap_fill', 'error_correction', 'transformation', 'word_order', 'sentence_completion']);
    expect(result.questions[3]).toMatchObject({ keyword: 'PASSED' });
    expect(generationResultSchema.safeParse({ kind: 'grammar', set: { title: 't', instructions: 'i', level: 'C1', topic: 'conditionals', questions: result.questions }, discarded: 0 }).success).toBe(true);
  });

  it('rejects ambiguous multiple choice: duplicate options, bad keys, missing distractor explanations', () => {
    const items = [
      { ...raw.multipleChoice, options: ['had known', 'Had known.', 'knew'], distractorExplanations: ['a', 'b', 'c'] },
      { ...raw.multipleChoice, correctOptionIndex: 3, options: ['knew', 'had known', 'have known'], distractorExplanations: ['a', 'b', 'c'] },
      { ...raw.multipleChoice, correctOptionIndex: null },
      { ...raw.multipleChoice, distractorExplanations: ['a', 'b'] },
      { ...raw.multipleChoice, distractorExplanations: ['', 'Correct.', 'c', 'd'] },
      { ...raw.multipleChoice, options: ['knew', 'had known'], distractorExplanations: ['a', 'b'] },
    ];
    expect(verifyAll(items)).toEqual({ questions: [], discarded: items.length });
  });

  it('collapses accepted answers that differ only harmlessly', () => {
    const { questions } = verifyAll([{ ...raw.gapFill, acceptedAnswers: ['known', 'Known.'] }, raw.transformation]);
    expect(questions[0]).toMatchObject({ acceptedAnswers: ['known'] });
    expect(questions[1]).toMatchObject({ acceptedAnswers: ['would have passed'] });
  });

  it('rejects gap questions without exactly one gap or with unusable or long answers', () => {
    const items = [
      { ...raw.gapFill, prompt: 'Had she known the truth.' },
      { ...raw.gapFill, prompt: 'Had ___ known ___ truth.' },
      { ...raw.gapFill, acceptedAnswers: ['  ', '...'] },
      { ...raw.gapFill, acceptedAnswers: ['known it all along and much more besides'] },
      { ...raw.completion, prompt: 'Not only did the plan fail.' },
    ];
    expect(verifyAll(items).discarded).toBe(items.length);
  });

  it('rejects transformations whose answers ignore the keyword or are too long', () => {
    const items = [
      { ...raw.transformation, acceptedAnswers: ['would have succeeded'] },
      { ...raw.transformation, keyword: 'two words' },
      { ...raw.transformation, keyword: null },
      { ...raw.transformation, sourceSentence: null },
      { ...raw.transformation, acceptedAnswers: ['passed'] },
    ];
    expect(verifyAll(items).discarded).toBe(items.length);
  });

  it('rejects error corrections that change nothing and word orders that use other words', () => {
    const items = [
      { ...raw.errorCorrection, acceptedAnswers: ['If I would have known, I would have helped'] },
      { ...raw.errorCorrection, prompt: 'If I ___ known.' },
      { ...raw.wordOrder, acceptedAnswers: ['Never have I ever seen such chaos.'] },
      { ...raw.wordOrder, words: ['never', 'have'] },
    ];
    expect(verifyAll(items).discarded).toBe(items.length);
  });

  it('drops unrequested types, malformed items and duplicates, and caps the count', () => {
    const result = verifyAll([raw.multipleChoice, raw.multipleChoice, raw.gapFill, { nonsense: true }, 'x', raw.wordOrder], ['multiple_choice', 'word_order']);
    expect(result.questions.map((question) => question.type)).toEqual(['multiple_choice', 'word_order']);
    expect(result.discarded).toBe(4);
    expect(verifyAll(Object.values(raw), ALL_TYPES, 2).questions).toHaveLength(2);
  });
});

describe('deterministic scoring', () => {
  const { questions } = verifyAll(Object.values(raw));
  const [mc, gap, correction, transformation, order, completion] = questions as [GrammarQuestion, GrammarQuestion, GrammarQuestion, GrammarQuestion, GrammarQuestion, GrammarQuestion];
  const text = (questionId: string, value: string) => ({ kind: 'text' as const, questionId, text: value });

  it('scores multiple choice by key', () => {
    expect(evaluateGrammarAnswer(mc, { kind: 'choice', questionId: mc.id, selectedIndex: 1 }).correct).toBe(true);
    expect(evaluateGrammarAnswer(mc, { kind: 'choice', questionId: mc.id, selectedIndex: 0 }).correct).toBe(false);
    expect(evaluateGrammarAnswer(mc, text(mc.id, 'had known')).correct).toBe(false);
  });

  it('accepts listed alternatives, harmless variants and the full sentence for gaps', () => {
    expect(evaluateGrammarAnswer(gap, text(gap.id, ' Known ')).correct).toBe(true);
    expect(evaluateGrammarAnswer(gap, text(gap.id, 'Had she known the truth, she would have spoken up.')).correct).toBe(true);
    expect(evaluateGrammarAnswer(transformation, text(transformation.id, "would've passed")).matched).toBe('would have passed');
    expect(evaluateGrammarAnswer(transformation, text(transformation.id, 'Would have passed.')).correct).toBe(true);
    expect(evaluateGrammarAnswer(correction, text(correction.id, 'had I known, I would have helped')).correct).toBe(true);
    expect(evaluateGrammarAnswer(order, text(order.id, 'never have i seen such chaos')).correct).toBe(true);
    expect(evaluateGrammarAnswer(completion, text(completion.id, 'but it also cost a fortune.')).correct).toBe(true);
  });

  it('does not accept answers that merely look similar', () => {
    expect(evaluateGrammarAnswer(gap, text(gap.id, 'knew')).correct).toBe(false);
    expect(evaluateGrammarAnswer(transformation, text(transformation.id, 'would passed')).correct).toBe(false);
    expect(evaluateGrammarAnswer(transformation, text(transformation.id, 'would have pass')).correct).toBe(false);
    expect(evaluateGrammarAnswer(order, text(order.id, 'I have never seen such chaos')).correct).toBe(false);
    expect(evaluateGrammarAnswer(correction, text(correction.id, 'If I had know, I would have helped.')).correct).toBe(false);
    expect(evaluateGrammarAnswer(gap, text(gap.id, '   ')).correct).toBe(false);
    expect(evaluateGrammarAnswer(gap, undefined).correct).toBe(false);
  });
});

describe('attempt lifecycle', () => {
  const { questions } = verifyAll([raw.multipleChoice, raw.transformation]);
  const record: GrammarSetRecord = {
    id: 'set',
    version: 1,
    set: { title: 'Conditionals', instructions: 'Answer.', level: 'C1', topic: 'conditionals', questions },
    types: ['multiple_choice', 'transformation'],
    discarded: 0,
    model: 'm',
    answers: [],
    checkedAt: null,
    reviews: [],
    history: [],
    createdAt: 1,
    updatedAt: 1,
  };

  it('records answers, checks, keeps history and retries', () => {
    let current = withGrammarAnswer(record, { kind: 'choice', questionId: 'q1', selectedIndex: 1 }, 2);
    current = withGrammarAnswer(current, { kind: 'text', questionId: 'q2', text: 'would pass' }, 3);
    expect(scoreGrammarSet(current)).toEqual({ total: 2, answered: 2, correct: 1 });

    current = checkGrammarSet(current, 4);
    expect(current.history).toEqual([{ checkedAt: 4, correct: 1, total: 2 }]);
    // Locked after checking.
    expect(withGrammarAnswer(current, { kind: 'choice', questionId: 'q1', selectedIndex: 0 }, 5)).toBe(current);
    expect(checkGrammarSet(current, 6)).toBe(current);

    const retried = retryGrammarSet(current, 7);
    expect(retried.answers).toEqual([]);
    expect(retried.checkedAt).toBeNull();
    expect(retried.history).toHaveLength(1);
    expect(grammarSetRecordSchema.safeParse(retried).success).toBe(true);
  });

  it('rejects answers of the wrong kind or for unknown questions', () => {
    expect(withGrammarAnswer(record, { kind: 'text', questionId: 'q1', text: 'had known' }, 2)).toBe(record);
    expect(withGrammarAnswer(record, { kind: 'choice', questionId: 'q2', selectedIndex: 0 }, 2)).toBe(record);
    expect(withGrammarAnswer(record, { kind: 'choice', questionId: 'q9', selectedIndex: 0 }, 2)).toBe(record);
  });

  it('allows second opinions only on checked, open, unmatched answers, without changing the score', () => {
    const answered = withGrammarAnswer(withGrammarAnswer(record, { kind: 'choice', questionId: 'q1', selectedIndex: 0 }, 2), { kind: 'text', questionId: 'q2', text: 'would surely have passed' }, 2);
    const [mc, transformation] = questions as [GrammarQuestion, GrammarQuestion];
    expect(canRequestReview(answered, transformation)).toBe(false);
    const checked = checkGrammarSet(answered, 3);
    expect(canRequestReview(checked, mc)).toBe(false);
    expect(canRequestReview(checked, transformation)).toBe(true);

    const review = { questionId: 'q2', answer: 'would surely have passed', verdict: 'acceptable' as const, explanation: 'Grammatical; "surely" adds emphasis.', correctedAnswer: null, model: 'm', createdAt: 4 };
    const reviewed = withGrammarReview(checked, review, 4);
    expect(reviewed.reviews).toHaveLength(1);
    expect(scoreGrammarSet(reviewed).correct).toBe(0);
    expect(reviewed.history).toEqual(checked.history);
    expect(withGrammarReview(checked, { ...review, answer: 'something else' }, 4)).toBe(checked);
  });
});
