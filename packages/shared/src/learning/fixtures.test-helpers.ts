import type { GrammarSetRecord } from '../contracts/grammar.js';
import type { ListeningExerciseSet } from '../contracts/exercise-generation.js';
import type { DictationRecord, ListeningSession } from '../contracts/listening-records.js';
import type { ReadingQuestionSet, ReadingTextRecord } from '../contracts/reading.js';
import type { SpeakingAttempt } from '../contracts/speaking.js';
import type { VocabularyEntry, VocabularyPracticeSet } from '../contracts/vocabulary.js';
import type { WritingAttempt, WritingTask } from '../contracts/writing.js';
import type { LearningSnapshot } from './observations.js';

/** Schema-valid record builders shared by the learning and backup tests. */

export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 10, 20, 12);

const dimension = { level: 'developing', summary: 'Generally clear.', strengths: [] as string[] };

export function speakingAttempt(id: string, at: number, issues: Array<{ category: 'grammar' | 'vocabulary' | 'coherence' | 'naturalness' | 'task'; subcategory: string; original: string; correction?: string; severity?: 'major' | 'minor' }>, recognitionFixes = 0): SpeakingAttempt {
  const segments = Array.from({ length: Math.max(1, recognitionFixes) }, (_, index) => ({
    id: String(index + 1),
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    recognizedText: index < recognitionFixes ? `misheard ${index}` : 'fine',
    text: index < recognitionFixes ? `corrected ${index}` : 'fine',
  }));
  return {
    id,
    version: 1,
    language: 'en',
    prompt: { source: 'library', promptId: 'p', title: `Speaking ${id}`, instructions: 'Talk.', points: [], category: 'work', level: 'B2' },
    mode: 'free',
    targetDurationSeconds: 60,
    recordingDurationMs: 45_000,
    transcript: { segments, words: [], model: 'whisper-large-v3-turbo', detectedLanguage: 'English' },
    fluency: {
      wordCount: 40,
      speakingTimeMs: 40_000,
      recordingDurationMs: 45_000,
      wordsPerMinute: 120,
      timingSource: 'words',
      pauses: { thresholdMs: 1000, longThresholdMs: 2500, count: 0, longCount: 0, totalMs: 0, longestMs: 0, longest: [] },
      repetitions: { count: 0, examples: [] },
      fillers: { count: 0, items: [] },
    },
    assessment: {
      model: 'm',
      createdAt: at,
      result: {
        overview: 'o',
        taskAchievement: { level: 'strong', summary: 's', addressedPoints: [], missedPoints: [] },
        grammar: dimension,
        vocabulary: dimension,
        coherence: dimension,
        naturalness: dimension,
        issues: issues.map((issue, index) => ({
          category: issue.category,
          subcategory: issue.subcategory,
          segmentId: '1',
          startMs: 0,
          original: issue.original,
          correction: issue.correction ?? `${issue.original} (fixed)`,
          explanation: 'Explanation.',
          advancedAlternative: null,
          severity: issue.severity ?? (index % 2 === 0 ? 'major' : 'minor'),
        })),
        recurringPatterns: [],
        exercises: [],
        discarded: { issues: 0, exercises: 0 },
      },
    } as unknown as SpeakingAttempt['assessment'],
    exerciseResponses: [],
    recording: { stored: false, mimeType: 'audio/webm' },
    createdAt: at,
    updatedAt: at,
  };
}

export const TASK: WritingTask = {
  title: 'An opinion essay',
  instructions: 'Write an essay.',
  context: 'For a newspaper.',
  sourceText: null,
  wordCount: { target: 250, min: 220, max: 280 },
  requiredElements: ['A position'],
  evaluationCriteria: ['Clarity', 'Accuracy'],
  objectives: ['Concession'],
  languageFeatures: [],
  level: 'C1',
  format: 'opinion_essay',
  register: 'neutral',
};

export function writingAttempt(
  id: string,
  at: number,
  corrections: Array<{ kind: 'error' | 'suggestion'; category: 'grammar' | 'spelling' | 'punctuation' | 'word_choice' | 'collocation' | 'register' | 'cohesion' | 'sentence_structure'; original: string; explanation?: string; priority?: 'high' | 'medium' | 'low' }>,
  timerElapsedMs = 0,
): WritingAttempt {
  let text = '';
  const verified = corrections.map((correction, index) => {
    const start = text.length;
    text += `${correction.original} `;
    return {
      id: `c${index + 1}`,
      kind: correction.kind,
      category: correction.category,
      original: correction.original,
      correction: `${correction.original} fixed`,
      explanation: correction.explanation ?? 'Explanation.',
      priority: correction.priority ?? 'medium',
      advancedAlternative: null,
      start,
      end: start + correction.original.length,
    };
  });
  text += 'and some more words to make the text long enough.';
  return {
    id,
    version: 1,
    taskId: `task-${id}`,
    task: TASK,
    text,
    wordCount: text.split(/\s+/).length,
    timerElapsedMs,
    assessment: {
      model: 'm',
      createdAt: at,
      result: {
        overview: 'o',
        grammar: dimension,
        vocabulary: dimension,
        naturalness: dimension,
        coherence: dimension,
        taskAchievement: dimension,
        register: dimension,
        sentenceVariety: dimension,
        requiredElements: [],
        priorities: ['p'],
        corrections: verified,
        discarded: 0,
      },
    } as unknown as WritingAttempt['assessment'],
    improvement: null,
    submittedAt: at,
    updatedAt: at,
  };
}

export function grammarSet(id: string, checkedAt: number | null, topic: GrammarSetRecord['set']['topic'], answers: Array<'right' | 'wrong' | 'blank'>, reviewWrongAs?: 'acceptable' | 'incorrect'): GrammarSetRecord {
  const questions = answers.map((_, index) => ({
    id: `q${index + 1}`,
    type: 'gap_fill' as const,
    prompt: `Sentence ${index} with ___ gap.`,
    explanation: 'E.',
    rule: 'R.',
    acceptedAnswers: [topic === 'articles_and_prepositions' ? (index % 2 === 0 ? 'on' : 'the') : 'had known'],
  }));
  return {
    id,
    version: 1,
    set: { title: `Grammar ${id}`, instructions: 'Answer.', level: 'C1', topic, questions },
    types: ['gap_fill'],
    discarded: 0,
    model: 'm',
    answers: answers.flatMap((answer, index) => (answer === 'blank' ? [] : [{ kind: 'text' as const, questionId: `q${index + 1}`, text: answer === 'right' ? (questions[index]?.acceptedAnswers[0] ?? '') : 'wrong answer' }])),
    checkedAt,
    reviews:
      reviewWrongAs && checkedAt !== null
        ? answers.flatMap((answer, index) => (answer === 'wrong' ? [{ questionId: `q${index + 1}`, answer: 'wrong answer', verdict: reviewWrongAs, explanation: 'x', correctedAnswer: null, model: 'm', createdAt: checkedAt }] : []))
        : [],
    history: checkedAt === null ? [] : [{ checkedAt, correct: answers.filter((answer) => answer === 'right').length, total: answers.length }],
    createdAt: (checkedAt ?? NOW) - 1000,
    updatedAt: checkedAt ?? NOW,
  };
}

export const SESSION: ListeningSession = {
  id: 's1',
  version: 1,
  language: 'en',
  title: 'A podcast',
  source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
  transcript: { fileName: 'p.srt', format: 'srt', cueCount: 2, skippedBlocks: 0 },
  playback: { positionSeconds: 0, playbackRate: 1 },
  loop: null,
  durationSeconds: 60,
  createdAt: NOW - 50 * DAY,
  updatedAt: NOW - 50 * DAY,
  lastOpenedAt: NOW - DAY,
};

export function dictation(cueId: string, reference: string, answers: Array<{ at: number; answer: string }>): DictationRecord {
  return {
    sessionId: 's1',
    cueId,
    referenceText: reference,
    attempts: answers.map(({ at, answer }) => ({ submittedAt: at, answer, wordErrorRate: answer === reference ? 0 : 0.5, accuracy: answer === reference ? 1 : 0.5, referenceWords: reference.split(' ').length })),
    updatedAt: answers.at(-1)?.at ?? NOW,
  };
}

export function readingText(id: string, completedAt: number | null): ReadingTextRecord {
  return {
    id,
    version: 1,
    language: 'en',
    source: 'imported',
    title: `Text ${id}`,
    paragraphs: ['One paragraph of text.'],
    wordCount: 400,
    estimatedMinutes: 2,
    level: null,
    textType: null,
    category: null,
    objectives: [],
    vocabulary: [],
    model: null,
    progress: { furthestParagraph: 0, completedAt, lastOpenedAt: NOW },
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW,
  };
}

export function readingSet(id: string, textId: string, submittedAt: number | null, results: Array<{ type: ReadingQuestionSet['questions'][number]['type']; right: boolean }>): ReadingQuestionSet {
  return {
    id,
    version: 1,
    textId,
    level: 'C1',
    types: ['detail'],
    questions: results.map((result, index) => ({
      id: `q${index + 1}`,
      format: 'multiple_choice',
      type: result.type,
      question: `Question ${index}?`,
      options: ['A', 'B', 'C'],
      correctOptionIndex: 0,
      explanation: 'E.',
      evidenceQuote: 'One paragraph of text',
      paragraphIndex: 0,
      start: 0,
      end: 21,
    })),
    discarded: 0,
    model: 'm',
    answers: results.map((result, index) => ({ format: 'multiple_choice', questionId: `q${index + 1}`, selectedIndex: result.right ? 0 : 1 })),
    submittedAt,
    createdAt: NOW - 5 * DAY,
    updatedAt: submittedAt ?? NOW,
  };
}

export function listeningSet(id: string, submittedAt: number | null, results: boolean[]): ListeningExerciseSet {
  return {
    id,
    version: 1,
    sessionId: 's1',
    level: 'C1',
    types: ['detail'],
    questions: results.map((_, index) => ({
      id: `q${index + 1}`,
      format: 'multiple_choice',
      type: 'detail',
      difficulty: 'B2',
      question: `Q${index}?`,
      options: ['A', 'B', 'C'],
      correctOptionIndex: 0,
      explanation: 'E.',
      evidenceQuote: 'words from the transcript',
      segmentIds: ['s1'],
      startMs: 0,
      endMs: 1000,
    })),
    discarded: 0,
    transcriptFingerprint: '1-abcdef12',
    truncated: false,
    model: 'm',
    answers: results.map((right, index) => ({ format: 'multiple_choice', questionId: `q${index + 1}`, selectedIndex: right ? 0 : 2 })),
    submittedAt,
    createdAt: NOW - 3 * DAY,
    updatedAt: submittedAt ?? NOW,
  };
}

export function vocabularyEntry(id: string, createdAt: number, ratings: Array<{ at: number; rating: 'again' | 'good' | 'easy' }>, dueAt = NOW + DAY): VocabularyEntry {
  return {
    id,
    version: 1,
    language: 'en',
    expression: `expression ${id}`,
    lemma: `expression ${id}`,
    key: `expression ${id}`,
    kind: 'word',
    senses: [
      {
        id: `${id}-s1`,
        contextualMeaning: 'meaning',
        dictionaryMeaning: 'definition',
        partOfSpeech: 'noun',
        context: `A sentence with expression ${id}.`,
        source: { kind: 'manual' },
        examples: [],
        collocations: [],
        synonyms: [],
        antonyms: [],
        register: 'neutral',
        patterns: [],
        cefrEstimate: 'B2',
        portugueseExplanation: null,
        addedAt: createdAt,
      },
    ],
    review: { status: 'learning', step: 1, dueAt, lastReviewedAt: ratings.at(-1)?.at ?? null, history: ratings },
    createdAt,
    updatedAt: createdAt,
  };
}

export function practiceSet(id: string, checkedAt: number | null, entryId: string, results: Array<'right' | 'wrong'>, openReview?: 'correct' | 'incorrect'): VocabularyPracticeSet {
  const questions: VocabularyPracticeSet['questions'] = results.map((_, index) => ({
    id: `q${index + 1}`,
    type: 'meaning_choice',
    itemId: entryId,
    prompt: `What does it mean ${index}?`,
    explanation: 'E.',
    options: ['right', 'wrong a', 'wrong b'],
    correctOptionIndex: 0,
  }));
  const answers: VocabularyPracticeSet['answers'] = results.map((result, index) => ({ kind: 'choice', questionId: `q${index + 1}`, selectedIndex: result === 'right' ? 0 : 1 }));
  const reviews: VocabularyPracticeSet['reviews'] = [];
  if (openReview) {
    const openId = `q${results.length + 1}`;
    questions.push({ id: openId, type: 'own_sentence', itemId: entryId, prompt: 'Write a sentence.', explanation: 'E.' });
    answers.push({ kind: 'text', questionId: openId, text: 'My own sentence.' });
    if (checkedAt !== null) reviews.push({ questionId: openId, answer: 'My own sentence.', verdict: openReview, usesExpressionCorrectly: openReview === 'correct', feedback: 'f', improvedAnswer: null, model: 'm', createdAt: checkedAt });
  }
  return {
    id,
    version: 1,
    entryIds: [entryId],
    types: ['meaning_choice'],
    questions,
    shuffles: {},
    discarded: 0,
    model: 'm',
    answers,
    reviews,
    checkedAt,
    history: checkedAt === null ? [] : [{ checkedAt, correct: results.filter((result) => result === 'right').length, objectiveTotal: results.length }],
    createdAt: NOW - 2 * DAY,
    updatedAt: checkedAt ?? NOW,
  };
}

export function emptySnapshot(): LearningSnapshot {
  return {
    listeningSessions: [],
    dictation: [],
    listeningExerciseSets: [],
    speakingAttempts: [],
    writingAttempts: [],
    grammarSets: [],
    readingTexts: [],
    readingQuestionSets: [],
    vocabularyEntries: [],
    vocabularyPracticeSets: [],
  };
}
