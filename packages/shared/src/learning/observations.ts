import type { DictationRecord, ListeningSession } from '../contracts/listening-records.js';
import type { ListeningExerciseSet } from '../contracts/exercise-generation.js';
import type { GrammarSetRecord } from '../contracts/grammar.js';
import type { ReadingQuestionSet, ReadingTextRecord } from '../contracts/reading.js';
import type { SpeakingAttempt } from '../contracts/speaking.js';
import { isLocalQuestionType, type LocalVocabularyQuestion, type VocabularyEntry, type VocabularyPracticeSet } from '../contracts/vocabulary.js';
import { hintsUsed, matchLocalAnswer } from '../domain/vocabulary-trainer.js';
import type { WritingAttempt } from '../contracts/writing.js';
import { evaluateGrammarAnswer } from '../domain/grammar-answers.js';
import { questionOutcome } from '../domain/exercise-generation.js';
import { readingOutcome } from '../domain/reading.js';
import { compareTexts } from '../domain/text-compare.js';
import { evaluateVocabularyAnswer } from '../domain/vocabulary.js';
import { categorizeGrammarTopic, categorizeSpeakingIssue, categorizeWritingCorrection, type LearningCategory } from './taxonomy.js';

/**
 * Learning observations: one normalised, traceable piece of evidence about
 * the learner, derived on demand from stored records (never stored itself).
 *
 * Rules applied here, deliberately and in one place:
 * - Writing suggestions are kept as `suggestion` and never counted as errors.
 * - Transcript corrections the learner made to Whisper's output are
 *   recognition errors, not learner errors: they are only counted as excluded.
 * - Only validated, stored feedback is used (records are Zod-validated on
 *   read; corrections were evidence-verified when created).
 * - A re-assessment replaces the previous one, so each correction is
 *   counted once; duplicates within one assessment are merged.
 * - Exercise rounds that were never checked are not evidence.
 * - An unmatched open answer that the AI second opinion accepted is not
 *   counted as wrong (the key may be incomplete).
 * - Missing evidence is never an error.
 */

export const LEARNING_MODULES = ['listening', 'speaking', 'writing', 'grammar', 'reading', 'vocabulary'] as const;
export type LearningModule = (typeof LEARNING_MODULES)[number];

/**
 * `error`: a verified mistake in the learner's own production.
 * `incorrect`: a wrong answer in an exercise (evidence, not proof, of a gap).
 * `correct`: a right answer: evidence of strength.
 * `suggestion`: an acceptable choice that could be improved; never an error.
 */
export type ObservationKind = 'error' | 'incorrect' | 'correct' | 'suggestion';

export type EvidenceType = 'verified_quote' | 'answer_key' | 'self_assessment' | 'dictation_comparison' | 'review_rating' | 'ai_rubric';
export type Confidence = 'high' | 'medium' | 'low';

export interface LearningObservation {
  /** Deterministic: the same source always yields the same id. */
  readonly id: string;
  readonly module: LearningModule;
  readonly sourceRecordId: string;
  readonly sourceLabel: string;
  /** In-app link to the source (exercise, attempt, session). */
  readonly sourcePath: string;
  readonly occurredAt: number;
  readonly category: LearningCategory;
  readonly kind: ObservationKind;
  readonly original: string | null;
  readonly corrected: string | null;
  readonly note: string | null;
  readonly evidence: EvidenceType;
  readonly confidence: Confidence;
  readonly severity: 'high' | 'medium' | 'low' | null;
}

/** One assessed or checked piece of work: the denominator for "errors per piece of work". */
export interface Exposure {
  readonly module: LearningModule;
  readonly recordId: string;
  readonly at: number;
}

export interface LearningSnapshot {
  readonly listeningSessions: readonly ListeningSession[];
  readonly dictation: readonly DictationRecord[];
  readonly listeningExerciseSets: readonly ListeningExerciseSet[];
  readonly speakingAttempts: readonly SpeakingAttempt[];
  readonly writingAttempts: readonly WritingAttempt[];
  readonly grammarSets: readonly GrammarSetRecord[];
  readonly readingTexts: readonly ReadingTextRecord[];
  readonly readingQuestionSets: readonly ReadingQuestionSet[];
  readonly vocabularyEntries: readonly VocabularyEntry[];
  readonly vocabularyPracticeSets: readonly VocabularyPracticeSet[];
}

export interface ExtractionResult {
  readonly observations: LearningObservation[];
  readonly exposures: Exposure[];
  /** What was deliberately left out, so the learner can see it was considered. */
  readonly excluded: {
    readonly recognitionCorrections: number;
    readonly uncheckedRounds: number;
    readonly acceptedBySecondOpinion: number;
    readonly unratedShortAnswers: number;
    readonly duplicateCorrections: number;
  };
}

const clip = (text: string | null | undefined, max = 200) => (text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null);

/** Dictation diff observations per line are capped, so one hard line can't dominate. */
export const MAX_DICTATION_OBSERVATIONS_PER_LINE = 4;

export function extractObservations(snapshot: LearningSnapshot): ExtractionResult {
  const observations: LearningObservation[] = [];
  const exposures: Exposure[] = [];
  const seen = new Set<string>();
  const excluded = { recognitionCorrections: 0, uncheckedRounds: 0, acceptedBySecondOpinion: 0, unratedShortAnswers: 0, duplicateCorrections: 0 };
  const push = (observation: LearningObservation) => {
    if (seen.has(observation.id)) return;
    seen.add(observation.id);
    observations.push(observation);
  };

  // --- Speaking: verified issues of the latest assessment ---------------------------------
  for (const attempt of snapshot.speakingAttempts) {
    excluded.recognitionCorrections += attempt.transcript.segments.filter((segment) => segment.recognizedText.trim() !== segment.text.trim()).length;
    const assessment = attempt.assessment;
    if (!assessment) continue;
    exposures.push({ module: 'speaking', recordId: attempt.id, at: assessment.createdAt });
    const withinAttempt = new Set<string>();
    assessment.result.issues.forEach((issue, index) => {
      const category = categorizeSpeakingIssue(issue);
      const key = `${category}|${issue.original.toLowerCase().trim()}`;
      if (withinAttempt.has(key)) {
        excluded.duplicateCorrections += 1;
        return;
      }
      withinAttempt.add(key);
      push({
        id: `speaking:${attempt.id}:issue:${index}`,
        module: 'speaking',
        sourceRecordId: attempt.id,
        sourceLabel: attempt.prompt.title,
        sourcePath: `/speaking/attempts/${attempt.id}`,
        occurredAt: assessment.createdAt,
        category,
        kind: 'error',
        original: clip(issue.original),
        corrected: clip(issue.correction),
        note: clip(issue.explanation, 300),
        evidence: 'verified_quote',
        confidence: 'high',
        severity: issue.severity === 'major' ? 'high' : 'low',
      });
    });
  }

  // --- Writing: verified corrections, errors and suggestions kept apart -----------------------
  for (const attempt of snapshot.writingAttempts) {
    const assessment = attempt.assessment;
    if (!assessment) continue;
    exposures.push({ module: 'writing', recordId: attempt.id, at: assessment.createdAt });
    for (const correction of assessment.result.corrections) {
      push({
        id: `writing:${attempt.id}:${correction.id}`,
        module: 'writing',
        sourceRecordId: attempt.id,
        sourceLabel: attempt.task.title,
        sourcePath: `/writing/attempts/${attempt.id}`,
        occurredAt: assessment.createdAt,
        category: categorizeWritingCorrection(correction),
        kind: correction.kind === 'error' ? 'error' : 'suggestion',
        original: clip(correction.original),
        corrected: clip(correction.correction),
        note: clip(correction.explanation, 300),
        evidence: 'verified_quote',
        confidence: correction.kind === 'error' ? 'high' : 'medium',
        severity: correction.priority,
      });
    }
  }

  // --- Grammar: answers of the checked round, scored against the key -------------------------
  for (const record of snapshot.grammarSets) {
    if (record.checkedAt === null) {
      if (record.answers.length > 0) excluded.uncheckedRounds += 1;
      continue;
    }
    exposures.push({ module: 'grammar', recordId: record.id, at: record.checkedAt });
    const answers = new Map(record.answers.map((answer) => [answer.questionId, answer]));
    const reviews = new Map(record.reviews.map((review) => [review.questionId, review]));
    for (const question of record.set.questions) {
      const answer = answers.get(question.id);
      if (!answer || (answer.kind === 'text' && answer.text.trim() === '')) continue;
      const { correct } = evaluateGrammarAnswer(question, answer);
      const review = reviews.get(question.id);
      if (!correct && review && review.verdict !== 'incorrect') {
        excluded.acceptedBySecondOpinion += 1;
        continue;
      }
      const expected = question.type === 'multiple_choice' ? (question.options[question.correctOptionIndex] ?? null) : (question.acceptedAnswers[0] ?? null);
      push({
        id: `grammar:${record.id}:${record.history.length}:${question.id}`,
        module: 'grammar',
        sourceRecordId: record.id,
        sourceLabel: record.set.title,
        sourcePath: `/grammar/sets/${record.id}`,
        occurredAt: record.checkedAt,
        category: categorizeGrammarTopic(record.set.topic, expected),
        kind: correct ? 'correct' : 'incorrect',
        original: correct ? null : clip(answer.kind === 'text' ? answer.text : question.type === 'multiple_choice' ? (question.options[answer.selectedIndex] ?? null) : null),
        corrected: correct ? null : clip(expected),
        note: clip(question.rule, 300),
        evidence: 'answer_key',
        confidence: 'high',
        severity: null,
      });
    }
  }

  // --- Listening: dictation (latest attempt per line) and comprehension sets ------------------------
  const sessionTitles = new Map(snapshot.listeningSessions.map((session) => [session.id, session.title]));
  for (const record of snapshot.dictation) {
    const latest = record.attempts.at(-1);
    if (!latest) continue;
    exposures.push({ module: 'listening', recordId: `${record.sessionId}:${record.cueId}`, at: latest.submittedAt });
    const base = {
      module: 'listening' as const,
      sourceRecordId: record.sessionId,
      sourceLabel: sessionTitles.get(record.sessionId) ?? 'Listening session',
      sourcePath: `/listening/session/${record.sessionId}?mode=dictation`,
      occurredAt: latest.submittedAt,
      evidence: 'dictation_comparison' as const,
      severity: null,
    };
    const comparison = compareTexts(record.referenceText, latest.answer);
    if (comparison.isExactMatch) {
      push({ ...base, id: `listening:${record.sessionId}:${record.cueId}:${latest.submittedAt}:ok`, category: 'listening_recognition', kind: 'correct', original: null, corrected: null, note: null, confidence: 'high' });
      continue;
    }
    let emitted = 0;
    comparison.alignment.forEach((op, index) => {
      if (op.type === 'match' || emitted >= MAX_DICTATION_OBSERVATIONS_PER_LINE) return;
      emitted += 1;
      const id = `listening:${record.sessionId}:${record.cueId}:${latest.submittedAt}:${index}`;
      if (op.type === 'substitution') {
        push({ ...base, id, category: op.nearMiss ? 'spelling' : 'listening_recognition', kind: 'incorrect', original: op.hypothesis.text, corrected: op.reference.text, note: op.nearMiss ? 'Spelling slip in dictation' : 'Heard a different word', confidence: op.nearMiss ? 'low' : 'medium' });
      } else if (op.type === 'deletion') {
        push({ ...base, id, category: 'listening_recognition', kind: 'incorrect', original: null, corrected: op.reference.text, note: 'Missed word', confidence: 'medium' });
      } else {
        push({ ...base, id, category: 'listening_recognition', kind: 'incorrect', original: op.hypothesis.text, corrected: null, note: 'Extra word', confidence: 'low' });
      }
    });
  }

  for (const set of snapshot.listeningExerciseSets) {
    if (set.submittedAt === null) {
      if (set.answers.length > 0) excluded.uncheckedRounds += 1;
      continue;
    }
    exposures.push({ module: 'listening', recordId: set.id, at: set.submittedAt });
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    for (const question of set.questions) {
      const outcome = questionOutcome(question, answers.get(question.id));
      if (outcome === 'unanswered') continue;
      if (outcome === 'unrated') {
        excluded.unratedShortAnswers += 1;
        continue;
      }
      push({
        id: `listening-set:${set.id}:${question.id}`,
        module: 'listening',
        sourceRecordId: set.sessionId,
        sourceLabel: sessionTitles.get(set.sessionId) ?? 'Listening session',
        sourcePath: `/listening/session/${set.sessionId}?mode=exercises`,
        occurredAt: set.submittedAt,
        category: 'listening_comprehension',
        kind: outcome === 'correct' ? 'correct' : 'incorrect',
        original: null,
        corrected: null,
        note: clip(question.question, 300),
        evidence: question.format === 'multiple_choice' ? 'answer_key' : 'self_assessment',
        confidence: question.format === 'multiple_choice' ? 'high' : outcome === 'partly' ? 'low' : 'medium',
        severity: null,
      });
    }
  }

  // --- Reading: checked comprehension sets ------------------------------------------------------
  const textTitles = new Map(snapshot.readingTexts.map((text) => [text.id, text.title]));
  for (const set of snapshot.readingQuestionSets) {
    if (set.submittedAt === null) {
      if (set.answers.length > 0) excluded.uncheckedRounds += 1;
      continue;
    }
    exposures.push({ module: 'reading', recordId: set.id, at: set.submittedAt });
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    for (const question of set.questions) {
      const outcome = readingOutcome(question, answers.get(question.id));
      if (outcome === 'unanswered') continue;
      if (outcome === 'unrated') {
        excluded.unratedShortAnswers += 1;
        continue;
      }
      const category: LearningCategory =
        question.type === 'vocabulary_in_context' ? 'vocabulary_in_context' : question.type === 'main_idea' || question.type === 'detail' ? 'reading_comprehension' : 'reading_inference';
      push({
        id: `reading:${set.id}:${question.id}`,
        module: 'reading',
        sourceRecordId: set.textId,
        sourceLabel: textTitles.get(set.textId) ?? 'Reading text',
        sourcePath: `/reading/texts/${set.textId}`,
        occurredAt: set.submittedAt,
        category,
        kind: outcome === 'correct' ? 'correct' : 'incorrect',
        original: null,
        corrected: null,
        note: clip(question.question, 300),
        evidence: question.format === 'multiple_choice' ? 'answer_key' : 'self_assessment',
        confidence: question.format === 'multiple_choice' ? 'high' : outcome === 'partly' ? 'low' : 'medium',
        severity: null,
      });
    }
  }

  // --- Vocabulary: practice rounds, AI rubric reviews, review ratings --------------------------------
  const entries = new Map(snapshot.vocabularyEntries.map((entry) => [entry.id, entry]));
  for (const set of snapshot.vocabularyPracticeSets) {
    if (set.checkedAt === null) {
      if (set.answers.length > 0) excluded.uncheckedRounds += 1;
      continue;
    }
    exposures.push({ module: 'vocabulary', recordId: set.id, at: set.checkedAt });
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    const reviews = new Map(set.reviews.map((review) => [review.questionId, review]));
    for (const question of set.questions) {
      // Local trainer questions (Vocabulary Trainer): graded verdicts give more precise evidence.
      if (isLocalQuestionType(question.type)) {
        const local = question as LocalVocabularyQuestion;
        const answer = answers.get(question.id);
        const result = matchLocalAnswer(local, answer);
        if (!result) continue;
        const hints = hintsUsed(answer);
        const typed = answer?.kind === 'typed' && answer.text.trim() ? clip(answer.text) : null;
        const category: LearningCategory = result.verdict === 'almost' ? 'spelling' : result.verdict === 'wrong_form' ? 'grammar_other' : 'vocabulary_retention';
        push({
          id: `vocabulary:${set.id}:${set.history.length}:${question.id}`,
          module: 'vocabulary',
          sourceRecordId: set.id,
          sourceLabel: local.lemma,
          sourcePath: `/vocabulary/train/${set.id}`,
          occurredAt: set.checkedAt,
          severity: null,
          category,
          kind: result.verdict === 'correct' ? 'correct' : 'incorrect',
          original: result.verdict === 'correct' ? null : typed,
          corrected: result.verdict === 'correct' ? null : clip(result.closest),
          note:
            result.verdict === 'wrong_form'
              ? 'Right word, wrong form'
              : result.verdict === 'almost'
                ? 'Near miss (spelling)'
                : result.verdict === 'empty'
                  ? 'Not known'
                  : result.verdict === 'correct' && hints > 0
                    ? `Correct with ${hints} hint${hints === 1 ? '' : 's'}`
                    : null,
          evidence: 'answer_key',
          // A hinted answer is weaker evidence of recall.
          confidence: hints > 0 ? 'medium' : 'high',
        });
        continue;
      }
      const outcome = evaluateVocabularyAnswer(question, answers.get(question.id));
      const label = entries.get(question.itemId)?.expression ?? 'Vocabulary practice';
      const base = { module: 'vocabulary' as const, sourceRecordId: set.id, sourceLabel: label, sourcePath: `/vocabulary/practice/${set.id}`, occurredAt: set.checkedAt, severity: null };
      if (outcome === 'correct' || outcome === 'incorrect') {
        push({
          ...base,
          id: `vocabulary:${set.id}:${set.history.length}:${question.id}`,
          category: question.type === 'collocation' ? 'collocations' : 'vocabulary_retention',
          kind: outcome,
          original: null,
          corrected: null,
          note: clip(question.explanation, 300),
          evidence: 'answer_key',
          confidence: 'high',
        });
      } else if (outcome === 'open') {
        const review = reviews.get(question.id);
        if (!review) continue; // Not evaluated: no evidence either way.
        const answer = answers.get(question.id);
        push({
          ...base,
          id: `vocabulary:${set.id}:${set.history.length}:${question.id}:review`,
          category: 'vocabulary_precision',
          kind: review.verdict === 'correct' ? 'correct' : 'incorrect',
          original: answer?.kind === 'text' ? clip(answer.text) : null,
          corrected: clip(review.improvedAnswer),
          note: clip(review.feedback, 300),
          evidence: 'ai_rubric',
          confidence: 'medium',
        });
      }
    }
  }

  for (const entry of snapshot.vocabularyEntries) {
    for (const rating of entry.review.history) {
      // Schedule changes made by a trainer round: the round's answers are already the evidence.
      if (rating.via === 'trainer') continue;
      push({
        id: `vocabulary-review:${entry.id}:${rating.at}`,
        module: 'vocabulary',
        sourceRecordId: entry.id,
        sourceLabel: entry.expression,
        sourcePath: `/vocabulary/entries/${entry.id}`,
        occurredAt: rating.at,
        category: 'vocabulary_retention',
        kind: rating.rating === 'again' ? 'incorrect' : 'correct',
        original: null,
        corrected: null,
        note: rating.rating === 'again' ? 'Not remembered in review' : 'Remembered in review',
        evidence: 'review_rating',
        confidence: 'low',
        severity: null,
      });
    }
  }

  return { observations: observations.sort((a, b) => b.occurredAt - a.occurredAt), exposures, excluded };
}

/** Errors and wrong answers: what counts against a category. Suggestions and successes never do. */
export function isNegative(observation: Pick<LearningObservation, 'kind'>): boolean {
  return observation.kind === 'error' || observation.kind === 'incorrect';
}
