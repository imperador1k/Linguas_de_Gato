import {
  LISTENING_GENERATION_LIMITS,
  modelListeningQuestionSchema,
  type GeneratedSpeakingExercise,
  type ListeningAnswer,
  type ListeningExerciseSet,
  type ListeningQuestion,
  type SpeakingGenerationRequest,
} from '../contracts/exercise-generation.js';
import type { CustomTopicDraft } from '../contracts/speaking.js';
import { tokenizeForComparison } from './text-compare.js';
import { flattenTranscript, locateQuoteSpan, type EvidenceSegment } from './transcript-evidence.js';

/**
 * Pure logic for AI exercise generation: preparing the transcript a
 * generator may use, verifying what the model returns against it, and
 * scoring the learner's answers.
 */

// --- Listening: input -------------------------------------------------------------

export interface TranscriptCueLike {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface GenerationSegment {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface PreparedTranscript {
  readonly segments: GenerationSegment[];
  /** True when the transcript was longer than the limit and only its beginning is used. */
  readonly truncated: boolean;
  readonly wordCount: number;
}

/** Segment ids encode the cue's position, so results map back to cues without a lookup table. */
export function segmentIdForCue(cueIndex: number): string {
  return `s${cueIndex + 1}`;
}

export function cueIndexForSegmentId(segmentId: string): number | null {
  const match = /^s(\d{1,6})$/.exec(segmentId);
  return match ? Number(match[1]) - 1 : null;
}

/**
 * The transcript as a generator sees it: empty cues dropped, each cue capped,
 * and the whole cut at a cue boundary so it stays within the request limits.
 */
export function prepareListeningTranscript(cues: readonly TranscriptCueLike[]): PreparedTranscript {
  const segments: GenerationSegment[] = [];
  let characters = 0;
  let truncated = false;
  for (const [index, cue] of cues.entries()) {
    const text = cue.text.replace(/\s+/g, ' ').trim().slice(0, LISTENING_GENERATION_LIMITS.maxSegmentChars);
    if (text === '') continue;
    const added = text.length + (segments.length > 0 ? 1 : 0);
    if (segments.length >= LISTENING_GENERATION_LIMITS.maxSegments || characters + added > LISTENING_GENERATION_LIMITS.maxTranscriptChars) {
      truncated = true;
      break;
    }
    characters += added;
    segments.push({
      id: segmentIdForCue(index),
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(Math.max(cue.endMs, cue.startMs))),
      text,
    });
  }
  const wordCount = segments.reduce((total, segment) => total + segment.text.split(' ').length, 0);
  return { segments, truncated, wordCount };
}

/**
 * A short, stable fingerprint of a transcript (FNV-1a, 32 bit). Not a
 * security measure: it tells a saved exercise set that its transcript was
 * replaced, so its evidence references may no longer line up.
 */
export function transcriptFingerprint(cues: readonly TranscriptCueLike[]): string {
  let hash = 0x811c9dc5;
  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const cue of cues) feed(`${cue.startMs}|${cue.endMs}|${cue.text}\n`);
  return `${cues.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

// --- Listening: verification ----------------------------------------------------

/** Evidence shorter than this proves nothing ("the", "it was"). */
export const MIN_EVIDENCE_WORDS = 3;

export interface ListeningVerification {
  readonly questions: ListeningQuestion[];
  /** Model questions dropped for invalid structure, unknown segments or unverifiable evidence. */
  readonly discarded: number;
}

const comparable = (text: string) =>
  tokenizeForComparison(text, { ignoreBracketed: false })
    .map((token) => token.normalized)
    .join(' ');

/**
 * Turns raw model questions into questions safe to show. A question survives
 * only if its structure is consistent (3-4 distinct options and a valid
 * answer index, or at least one accepted answer), every segment it cites
 * exists, and its evidence quote occurs word for word in the transcript.
 * References are then replaced by the verified span, so timestamps come from
 * the session, never from the model.
 */
export function verifyListeningQuestions(
  raw: readonly unknown[],
  segments: readonly EvidenceSegment[],
  maxQuestions: number = LISTENING_GENERATION_LIMITS.maxQuestions,
): ListeningVerification {
  const knownIds = new Set(segments.map((segment) => segment.id));
  const flat = flattenTranscript(segments);
  const seenQuestions = new Set<string>();
  const questions: ListeningQuestion[] = [];
  let discarded = 0;

  for (const item of raw) {
    const parsed = modelListeningQuestionSchema.safeParse(item);
    if (!parsed.success) {
      discarded += 1;
      continue;
    }
    const question = parsed.data;
    const reject = () => {
      discarded += 1;
    };

    if (question.segmentIds.some((id) => !knownIds.has(id))) {
      reject();
      continue;
    }
    if (tokenizeForComparison(question.evidenceQuote, { ignoreBracketed: false }).length < MIN_EVIDENCE_WORDS) {
      reject();
      continue;
    }
    const span = locateQuoteSpan(question.evidenceQuote, segments, question.segmentIds[0], flat);
    if (!span || span.segmentIds.length > 6) {
      reject();
      continue;
    }
    const key = comparable(question.question);
    if (seenQuestions.has(key)) {
      reject();
      continue;
    }

    const base = {
      id: `q${questions.length + 1}`,
      type: question.type,
      difficulty: question.difficulty,
      question: question.question,
      explanation: question.explanation,
      evidenceQuote: question.evidenceQuote,
      segmentIds: [...span.segmentIds],
      startMs: span.startMs,
      endMs: span.endMs,
    };

    if (question.format === 'multiple_choice') {
      const options = question.options;
      const index = question.correctOptionIndex;
      const distinct = new Set(options.map(comparable)).size === options.length;
      if (options.length < 3 || index === null || index >= options.length || !distinct) {
        reject();
        continue;
      }
      questions.push({ ...base, format: 'multiple_choice', options: [...options], correctOptionIndex: index });
    } else {
      if (question.acceptedAnswers.length === 0) {
        reject();
        continue;
      }
      questions.push({ ...base, format: 'short_answer', acceptedAnswers: [...question.acceptedAnswers] });
    }
    seenQuestions.add(key);
    if (questions.length >= maxQuestions) break;
  }

  return { questions, discarded };
}

// --- Listening: answers and results ---------------------------------------------------

/**
 * A hint, never a verdict: true when the answer contains every word of an
 * accepted answer. Short answers are self-assessed because paraphrases are
 * legitimate and word matching can't judge them.
 */
export function resemblesAcceptedAnswer(answer: string, acceptedAnswers: readonly string[]): boolean {
  const answerWords = new Set(comparable(answer).split(' ').filter(Boolean));
  if (answerWords.size === 0) return false;
  return acceptedAnswers.some((accepted) => {
    const words = comparable(accepted).split(' ').filter(Boolean);
    return words.length > 0 && words.every((word) => answerWords.has(word));
  });
}

export type QuestionOutcome = 'correct' | 'partly' | 'incorrect' | 'unanswered' | 'unrated';

export function questionOutcome(question: ListeningQuestion, answer: ListeningAnswer | undefined): QuestionOutcome {
  if (!answer || answer.format !== question.format) return 'unanswered';
  if (answer.format === 'multiple_choice' && question.format === 'multiple_choice') {
    return answer.selectedIndex === question.correctOptionIndex ? 'correct' : 'incorrect';
  }
  if (answer.format === 'short_answer') {
    if (answer.text.trim() === '') return 'unanswered';
    return answer.selfAssessment ?? 'unrated';
  }
  return 'unanswered';
}

export interface ListeningResultSummary {
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
  readonly partly: number;
  readonly incorrect: number;
  /** Short answers the learner hasn't compared with the accepted answers yet. */
  readonly unrated: number;
}

export function summarizeListeningResults(set: Pick<ListeningExerciseSet, 'questions' | 'answers'>): ListeningResultSummary {
  const byQuestion = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const counts = { correct: 0, partly: 0, incorrect: 0, unanswered: 0, unrated: 0 };
  for (const question of set.questions) counts[questionOutcome(question, byQuestion.get(question.id))] += 1;
  return {
    total: set.questions.length,
    answered: set.questions.length - counts.unanswered,
    correct: counts.correct,
    partly: counts.partly,
    incorrect: counts.incorrect,
    unrated: counts.unrated,
  };
}

/** Replaces the learner's answer to one question (answers are locked once submitted). */
export function withListeningAnswer(set: ListeningExerciseSet, answer: ListeningAnswer, now: number): ListeningExerciseSet {
  const question = set.questions.find((candidate) => candidate.id === answer.questionId);
  if (!question || question.format !== answer.format) return set;
  if (set.submittedAt !== null && answer.format === 'multiple_choice') return set;
  if (set.submittedAt !== null && answer.format === 'short_answer') {
    // After submission only the self-assessment may change, not the answer text.
    const previous = set.answers.find((candidate) => candidate.questionId === answer.questionId);
    if (!previous || previous.format !== 'short_answer' || previous.text !== answer.text) return set;
  }
  const answers = [...set.answers.filter((candidate) => candidate.questionId !== answer.questionId), answer];
  return { ...set, answers, updatedAt: now };
}

// --- Speaking --------------------------------------------------------------------

/**
 * A generated exercise as a personal topic the learner can preview, edit and
 * save. The level and format are the learner's choices, not the model's, so
 * a model that drifts can't relabel the task.
 */
export function generatedExerciseToTopicDraft(
  exercise: GeneratedSpeakingExercise,
  request: Pick<SpeakingGenerationRequest, 'level' | 'category' | 'format' | 'skillFocus' | 'targetDurationSeconds'>,
  model: string,
  createdAt: number,
): CustomTopicDraft {
  return {
    prompt: {
      source: 'custom',
      promptId: null,
      title: exercise.title,
      instructions: exercise.centralPrompt,
      points: exercise.discussionPoints.slice(0, 6),
      category: request.category,
      level: request.level,
    },
    generated: {
      level: request.level,
      format: request.format,
      skillFocus: request.skillFocus,
      targetDurationSeconds: request.targetDurationSeconds,
      guidance: exercise.instructions,
      followUpQuestions: [...exercise.followUpQuestions],
      vocabulary: exercise.vocabulary.map((item) => ({ ...item })),
      objectives: [...exercise.objectives],
      model,
      createdAt,
    },
  };
}
