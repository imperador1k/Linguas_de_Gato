import { describe, expect, it } from 'vitest';
import { generationRequestSchema, generationResultSchema } from '../contracts/exercise-generation.js';
import {
  countWords,
  modelWritingAssessmentSchema,
  wordCountStatus,
  writingAssessmentRequestSchema,
  writingAssessmentSchema,
  writingAttemptSchema,
  writingDraftSchema,
  writingTaskSchema,
  type WritingTask,
} from '../contracts/writing.js';
import { annotateText, applyCorrections, findQuoteRanges, sortByPriority, verifyWritingCorrections } from './writing-evidence.js';

export const TASK: WritingTask = {
  title: 'Should cities ban cars from their centres?',
  instructions: 'Write an opinion essay for your local newspaper giving your view and supporting it with reasons and examples.',
  context: 'The council is consulting residents on a proposal to close the old town to private cars.',
  sourceText: null,
  wordCount: { target: 250, min: 220, max: 280 },
  requiredElements: ['A clear position', 'Two supported reasons', 'A counter-argument'],
  evaluationCriteria: ['Task achievement', 'Coherence', 'Range and accuracy'],
  objectives: ['Use concession to acknowledge the other side'],
  languageFeatures: ['while / although for concession'],
  level: 'C1',
  format: 'opinion_essay',
  register: 'neutral',
};

const writingRequest = {
  kind: 'writing',
  level: 'C1',
  format: 'opinion_essay',
  category: 'society',
  interest: null,
  targetWords: 250,
  register: 'neutral',
  objective: 'use concession clauses',
  avoidTitles: [],
};

const TEXT = 'In my opinion the goverment should invest more money in public transport.  It is more better for the environment, and people would use it if it were cheap.';

const correction = (overrides: Record<string, unknown> = {}) => ({
  kind: 'error',
  category: 'spelling',
  original: 'goverment',
  correction: 'government',
  explanation: '"Government" has an n before the m.',
  priority: 'medium',
  advancedAlternative: null,
  ...overrides,
});

describe('word counting', () => {
  it('counts words as exam boards do', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    // It's / a / well-known / fact / isn't / it? — the dash is not a word.
    expect(countWords("It's a well-known fact — isn't it?")).toBe(6);
    expect(countWords('One.\nTwo,  three!\tFour')).toBe(4);
    expect(countWords('In 2024 we spent 3.5 million.')).toBe(6);
    expect(countWords('Café naïve façade')).toBe(3);
  });

  it('classifies a count against the range', () => {
    const range = { min: 220, max: 280 };
    expect(wordCountStatus(0, range)).toBe('empty');
    expect(wordCountStatus(100, range)).toBe('under');
    expect(wordCountStatus(220, range)).toBe('within');
    expect(wordCountStatus(280, range)).toBe('within');
    expect(wordCountStatus(281, range)).toBe('over');
  });
});

describe('writing generation contracts', () => {
  it('accepts a valid request and rejects out-of-range or unknown values', () => {
    expect(generationRequestSchema.safeParse(writingRequest).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...writingRequest, format: 'poem' }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, level: 'B1' }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, targetWords: 20 }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, targetWords: 2000 }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, register: 'slang' }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, objective: 'x'.repeat(201) }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...writingRequest, modelAnswer: true }).success).toBe(false);
  });

  it('validates generated tasks, without a model answer', () => {
    expect(writingTaskSchema.safeParse(TASK).success).toBe(true);
    expect(writingTaskSchema.safeParse({ ...TASK, modelAnswer: 'An essay' }).success).toBe(false);
    expect(writingTaskSchema.safeParse({ ...TASK, wordCount: { target: 250, min: 260, max: 280 } }).success).toBe(false);
    expect(writingTaskSchema.safeParse({ ...TASK, requiredElements: [] }).success).toBe(false);
    const { evaluationCriteria: _criteria, ...missing } = TASK;
    expect(writingTaskSchema.safeParse(missing).success).toBe(false);
    expect(generationResultSchema.safeParse({ kind: 'writing', task: TASK }).success).toBe(true);
  });
});

describe('writing assessment request', () => {
  const request = { task: { ...TASK, evaluationCriteria: undefined, objectives: undefined, languageFeatures: undefined }, text: 'word '.repeat(40) };
  const valid = {
    task: {
      title: TASK.title,
      instructions: TASK.instructions,
      context: TASK.context,
      sourceText: null,
      format: TASK.format,
      register: TASK.register,
      level: TASK.level,
      wordCount: TASK.wordCount,
      requiredElements: TASK.requiredElements,
    },
    text: 'word '.repeat(40),
  };

  it('requires enough words, a bounded text and no unknown fields', () => {
    expect(writingAssessmentRequestSchema.safeParse(valid).success).toBe(true);
    expect(writingAssessmentRequestSchema.safeParse({ ...valid, text: 'Too short to assess.' }).success).toBe(false);
    expect(writingAssessmentRequestSchema.safeParse({ ...valid, text: 'a '.repeat(7000) }).success).toBe(false);
    expect(writingAssessmentRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('writing correction evidence', () => {
  it('keeps corrections whose quote is in the text, with offsets, in reading order', () => {
    const result = verifyWritingCorrections(
      [
        correction({ kind: 'error', category: 'grammar', original: 'more better', correction: 'better', priority: 'high' }),
        correction(),
      ],
      TEXT,
    );
    expect(result.discarded).toBe(0);
    expect(result.corrections.map((item) => [item.id, item.original])).toEqual([
      ['c1', 'goverment'],
      ['c2', 'more better'],
    ]);
    const first = result.corrections[0]!;
    expect(TEXT.slice(first.start, first.end)).toBe('goverment');
  });

  it('matches across collapsed whitespace and curly quotes', () => {
    const ranges = findQuoteRanges('public transport. It is', TEXT);
    expect(ranges).toHaveLength(1);
    expect(TEXT.slice(ranges[0]!.start, ranges[0]!.end)).toBe('public transport.  It is');
    expect(findQuoteRanges('it’s', "and it's fine")).toHaveLength(1);
  });

  it('discards invented quotes, paraphrases and changes that change nothing', () => {
    const result = verifyWritingCorrections(
      [
        correction({ original: 'the governments should', correction: 'the government should' }),
        correction({ original: 'public transports', correction: 'public transport' }),
        correction({ original: 'more  better', correction: 'more better' }),
      ],
      TEXT,
    );
    expect(result).toEqual({ corrections: [], discarded: 3 });
  });

  it('discards malformed items and overlapping corrections', () => {
    const result = verifyWritingCorrections(
      [correction(), correction({ original: 'the goverment should', correction: 'the government should' }), { original: 'x' }, null, correction({ kind: 'mistake' })],
      TEXT,
    );
    expect(result.corrections).toHaveLength(1);
    expect(result.discarded).toBe(4);
  });

  it('uses a later occurrence when an earlier one is already corrected', () => {
    const text = 'I goes home and he goes home.';
    const result = verifyWritingCorrections(
      [correction({ original: 'goes', correction: 'go', category: 'grammar' }), correction({ original: 'goes home', correction: 'went home', category: 'grammar' })],
      text,
    );
    expect(result.corrections.map((item) => text.slice(item.start, item.end))).toEqual(['goes', 'goes home']);
  });

  it('never lets a stylistic suggestion be a high priority', () => {
    const result = verifyWritingCorrections(
      [correction({ kind: 'suggestion', category: 'word_choice', original: 'invest more money', correction: 'channel more funding', priority: 'high' })],
      TEXT,
    );
    expect(result.corrections[0]).toMatchObject({ kind: 'suggestion', priority: 'medium' });
  });

  it('builds annotations and corrected versions', () => {
    const { corrections } = verifyWritingCorrections(
      [correction(), correction({ kind: 'suggestion', category: 'word_choice', original: 'cheap', correction: 'affordable', priority: 'low' })],
      TEXT,
    );
    const pieces = annotateText(TEXT, corrections);
    expect(pieces.map((piece) => piece.text).join('')).toBe(TEXT);
    expect(pieces.filter((piece) => piece.correctionId).map((piece) => piece.text)).toEqual(['goverment', 'cheap']);
    expect(applyCorrections(TEXT, corrections, 'errors')).toContain('the government should');
    expect(applyCorrections(TEXT, corrections, 'errors')).toContain('if it were cheap.');
    expect(applyCorrections(TEXT, corrections, 'all')).toContain('if it were affordable.');
    expect(sortByPriority(corrections)[0]?.original).toBe('goverment');
  });
});

describe('writing assessment and records', () => {
  const dimension = { level: 'developing', summary: 'Clear overall.', strengths: ['Clear position'] };
  const model = {
    overview: 'A clear opinion with some accuracy problems.',
    grammar: dimension,
    vocabulary: dimension,
    naturalness: dimension,
    coherence: dimension,
    taskAchievement: dimension,
    register: dimension,
    sentenceVariety: dimension,
    requiredElements: [{ element: 'A clear position', addressed: true, comment: 'Stated in the first sentence.' }],
    priorities: ['Check comparatives.'],
    corrections: [correction()],
  };

  it('rejects scores, CEFR results and missing dimensions in model output', () => {
    expect(modelWritingAssessmentSchema.safeParse(model).success).toBe(true);
    expect(modelWritingAssessmentSchema.safeParse({ ...model, score: 7 }).success).toBe(false);
    expect(modelWritingAssessmentSchema.safeParse({ ...model, cefrLevel: 'C1' }).success).toBe(false);
    const { register: _register, ...missing } = model;
    expect(modelWritingAssessmentSchema.safeParse(missing).success).toBe(false);
    expect(modelWritingAssessmentSchema.safeParse({ ...model, grammar: { ...dimension, level: 'excellent' } }).success).toBe(false);
  });

  it('accepts the verified assessment, drafts and attempts', () => {
    const { corrections, discarded } = verifyWritingCorrections(model.corrections, TEXT);
    const assessment = { ...model, corrections, discarded };
    expect(writingAssessmentSchema.safeParse(assessment).success).toBe(true);
    expect(writingDraftSchema.safeParse({ taskId: 't', version: 1, text: TEXT, timerElapsedMs: 0, createdAt: 1, updatedAt: 2 }).success).toBe(true);
    const attempt = {
      id: 'a',
      version: 1,
      taskId: 't',
      task: TASK,
      text: TEXT,
      wordCount: countWords(TEXT),
      timerElapsedMs: 0,
      assessment: { model: 'm', createdAt: 3, result: assessment },
      improvement: null,
      submittedAt: 3,
      updatedAt: 3,
    };
    expect(writingAttemptSchema.safeParse(attempt).success).toBe(true);
  });
});
