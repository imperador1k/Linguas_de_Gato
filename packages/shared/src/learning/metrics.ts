import { readingOutcome } from '../domain/reading.js';
import { questionOutcome } from '../domain/exercise-generation.js';
import { countWords } from '../contracts/writing.js';
import { entrySavedAt, isSavedSense } from '../domain/vocabulary-trainer.js';
import type { LearningModule, LearningSnapshot } from './observations.js';

/**
 * Activity metrics over a date range. Rules:
 * - Times are only ever measured values: recording length (Speaking) and
 *   the optional writing timer. Reading time is an estimate from word count
 *   and is always labelled as such. They are never added together.
 * - Accuracies are reported per exercise type with their counts; there is
 *   no combined "English score".
 * - Every metric has a definition (METRIC_DEFINITIONS) shown in the UI.
 */

export interface DateRange {
  /** Inclusive start (ms), or null for all time. */
  readonly from: number | null;
  /** Exclusive end (ms). */
  readonly to: number;
}

export const RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const DAY = 86_400_000;

export function rangeFor(preset: RangePreset, now: number): DateRange {
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : null;
  return { from: days === null ? null : now - days * DAY, to: now + 1 };
}

const inRange = (at: number | null | undefined, range: DateRange) => typeof at === 'number' && (range.from === null || at >= range.from) && at < range.to;

export interface Ratio {
  readonly correct: number;
  readonly total: number;
}

const ratio = (correct: number, total: number): Ratio => ({ correct, total });
export const rate = (value: Ratio): number | null => (value.total > 0 ? value.correct / value.total : null);

export interface ModuleMetrics {
  readonly listening: {
    readonly dictationAttempts: number;
    readonly linesPractised: number;
    /** Mean word accuracy of dictation attempts in the range. */
    readonly meanDictationAccuracy: number | null;
    readonly comprehensionSetsChecked: number;
    readonly comprehension: Ratio;
  };
  readonly speaking: {
    readonly attempts: number;
    readonly recordedMs: number;
    readonly assessed: number;
    readonly verifiedErrors: number;
  };
  readonly writing: {
    readonly submissions: number;
    readonly words: number;
    readonly timedMs: number;
    readonly timedSubmissions: number;
    readonly assessed: number;
    readonly verifiedErrors: number;
    readonly suggestions: number;
  };
  readonly grammar: {
    readonly roundsChecked: number;
    readonly answers: Ratio;
  };
  readonly reading: {
    readonly textsAdded: number;
    readonly textsFinished: number;
    /** Estimate from word count at 200 wpm; never a measured time. */
    readonly estimatedReadingMinutes: number;
    readonly comprehensionSetsChecked: number;
    readonly comprehension: Ratio;
  };
  readonly vocabulary: {
    readonly entriesSaved: number;
    readonly meaningsSaved: number;
    readonly reviews: number;
    readonly reviewsRemembered: number;
    readonly practiceRoundsChecked: number;
    readonly practiceObjective: Ratio;
  };
}

export interface ActivityEvent {
  readonly module: LearningModule;
  readonly at: number;
  readonly label: string;
}

export interface LearningMetrics {
  readonly modules: ModuleMetrics;
  /** Distinct local calendar days with at least one activity event. */
  readonly activeDays: number;
  readonly events: number;
  readonly completedExercises: number;
  readonly eventsByModule: Record<LearningModule, number>;
}

/** Every timestamped learner action that counts as study (not generating or opening things). */
export function activityEvents(snapshot: LearningSnapshot): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const record of snapshot.dictation) for (const attempt of record.attempts) events.push({ module: 'listening', at: attempt.submittedAt, label: 'Dictation line' });
  for (const set of snapshot.listeningExerciseSets) if (set.submittedAt !== null) events.push({ module: 'listening', at: set.submittedAt, label: 'Listening comprehension checked' });
  for (const attempt of snapshot.speakingAttempts) events.push({ module: 'speaking', at: attempt.createdAt, label: 'Speaking attempt' });
  for (const attempt of snapshot.writingAttempts) events.push({ module: 'writing', at: attempt.submittedAt, label: 'Writing submitted' });
  for (const set of snapshot.grammarSets) for (const round of set.history) events.push({ module: 'grammar', at: round.checkedAt, label: 'Grammar round checked' });
  for (const text of snapshot.readingTexts) if (text.progress.completedAt !== null) events.push({ module: 'reading', at: text.progress.completedAt, label: 'Text finished' });
  for (const set of snapshot.readingQuestionSets) if (set.submittedAt !== null) events.push({ module: 'reading', at: set.submittedAt, label: 'Reading comprehension checked' });
  for (const entry of snapshot.vocabularyEntries) {
    // Senses added by a trainer round are part of that round (counted below), not saves.
    for (const sense of entry.senses) if (isSavedSense(sense)) events.push({ module: 'vocabulary', at: sense.addedAt, label: 'Expression saved' });
    // Trainer schedule changes are part of the trainer round (counted below), not separate reviews.
    for (const rating of entry.review.history) if (rating.via !== 'trainer') events.push({ module: 'vocabulary', at: rating.at, label: 'Vocabulary review' });
  }
  for (const set of snapshot.vocabularyPracticeSets) for (const round of set.history) events.push({ module: 'vocabulary', at: round.checkedAt, label: 'Vocabulary practice checked' });
  return events.sort((a, b) => a.at - b.at);
}

export function localDateKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function computeMetrics(snapshot: LearningSnapshot, range: DateRange): LearningMetrics {
  // Listening
  const dictationAttempts = snapshot.dictation.flatMap((record) => record.attempts.filter((attempt) => inRange(attempt.submittedAt, range)).map((attempt) => ({ record, attempt })));
  const listeningSets = snapshot.listeningExerciseSets.filter((set) => inRange(set.submittedAt, range));
  let listeningCorrect = 0;
  let listeningTotal = 0;
  for (const set of listeningSets) {
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    for (const question of set.questions) {
      const outcome = questionOutcome(question, answers.get(question.id));
      if (outcome === 'unanswered' || outcome === 'unrated') continue;
      listeningTotal += 1;
      if (outcome === 'correct') listeningCorrect += 1;
    }
  }

  // Speaking and writing
  const speaking = snapshot.speakingAttempts.filter((attempt) => inRange(attempt.createdAt, range));
  const writing = snapshot.writingAttempts.filter((attempt) => inRange(attempt.submittedAt, range));
  const writingCorrections = writing.flatMap((attempt) => attempt.assessment?.result.corrections ?? []);

  // Grammar
  const grammarRounds = snapshot.grammarSets.flatMap((set) => set.history.filter((round) => inRange(round.checkedAt, range)));

  // Reading
  const finished = snapshot.readingTexts.filter((text) => inRange(text.progress.completedAt, range));
  const readingSets = snapshot.readingQuestionSets.filter((set) => inRange(set.submittedAt, range));
  let readingCorrect = 0;
  let readingTotal = 0;
  for (const set of readingSets) {
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    for (const question of set.questions) {
      const outcome = readingOutcome(question, answers.get(question.id));
      if (outcome === 'unanswered' || outcome === 'unrated') continue;
      readingTotal += 1;
      if (outcome === 'correct') readingCorrect += 1;
    }
  }

  // Vocabulary
  const reviews = snapshot.vocabularyEntries.flatMap((entry) => entry.review.history.filter((rating) => rating.via !== 'trainer' && inRange(rating.at, range)));
  const practiceRounds = snapshot.vocabularyPracticeSets.flatMap((set) => set.history.filter((round) => inRange(round.checkedAt, range)));

  const modules: ModuleMetrics = {
    listening: {
      dictationAttempts: dictationAttempts.length,
      linesPractised: new Set(dictationAttempts.map(({ record }) => `${record.sessionId}:${record.cueId}`)).size,
      meanDictationAccuracy: dictationAttempts.length > 0 ? dictationAttempts.reduce((sum, { attempt }) => sum + attempt.accuracy, 0) / dictationAttempts.length : null,
      comprehensionSetsChecked: listeningSets.length,
      comprehension: ratio(listeningCorrect, listeningTotal),
    },
    speaking: {
      attempts: speaking.length,
      recordedMs: speaking.reduce((sum, attempt) => sum + attempt.recordingDurationMs, 0),
      assessed: speaking.filter((attempt) => attempt.assessment !== null).length,
      verifiedErrors: speaking.reduce((sum, attempt) => sum + (attempt.assessment?.result.issues.length ?? 0), 0),
    },
    writing: {
      submissions: writing.length,
      words: writing.reduce((sum, attempt) => sum + (attempt.wordCount || countWords(attempt.text)), 0),
      timedMs: writing.reduce((sum, attempt) => sum + attempt.timerElapsedMs, 0),
      timedSubmissions: writing.filter((attempt) => attempt.timerElapsedMs > 0).length,
      assessed: writing.filter((attempt) => attempt.assessment !== null).length,
      verifiedErrors: writingCorrections.filter((correction) => correction.kind === 'error').length,
      suggestions: writingCorrections.filter((correction) => correction.kind === 'suggestion').length,
    },
    grammar: {
      roundsChecked: grammarRounds.length,
      answers: ratio(
        grammarRounds.reduce((sum, round) => sum + round.correct, 0),
        grammarRounds.reduce((sum, round) => sum + round.total, 0),
      ),
    },
    reading: {
      textsAdded: snapshot.readingTexts.filter((text) => inRange(text.createdAt, range)).length,
      textsFinished: finished.length,
      estimatedReadingMinutes: finished.reduce((sum, text) => sum + text.estimatedMinutes, 0),
      comprehensionSetsChecked: readingSets.length,
      comprehension: ratio(readingCorrect, readingTotal),
    },
    vocabulary: {
      // Only what the learner saved; words a trainer round added are not "saved" (see isSavedSense).
      entriesSaved: snapshot.vocabularyEntries.filter((entry) => {
        const savedAt = entrySavedAt(entry);
        return savedAt !== null && inRange(savedAt, range);
      }).length,
      meaningsSaved: snapshot.vocabularyEntries.flatMap((entry) => entry.senses).filter((sense) => isSavedSense(sense) && inRange(sense.addedAt, range)).length,
      reviews: reviews.length,
      reviewsRemembered: reviews.filter((rating) => rating.rating !== 'again').length,
      practiceRoundsChecked: practiceRounds.length,
      practiceObjective: ratio(
        practiceRounds.reduce((sum, round) => sum + round.correct, 0),
        practiceRounds.reduce((sum, round) => sum + round.objectiveTotal, 0),
      ),
    },
  };

  const events = activityEvents(snapshot).filter((event) => inRange(event.at, range));
  const eventsByModule = { listening: 0, speaking: 0, writing: 0, grammar: 0, reading: 0, vocabulary: 0 } as Record<LearningModule, number>;
  for (const event of events) eventsByModule[event.module] += 1;
  const completedExercises =
    modules.listening.dictationAttempts +
    modules.listening.comprehensionSetsChecked +
    modules.speaking.attempts +
    modules.writing.submissions +
    modules.grammar.roundsChecked +
    modules.reading.comprehensionSetsChecked +
    modules.vocabulary.practiceRoundsChecked +
    modules.vocabulary.reviews;

  return { modules, activeDays: new Set(events.map((event) => localDateKey(event.at))).size, events: events.length, completedExercises, eventsByModule };
}

/** Activity per bucket (day or week) for the chart; empty buckets are kept so gaps are visible. */
export function activitySeries(snapshot: LearningSnapshot, range: DateRange, now: number): Array<{ key: string; start: number; counts: Record<LearningModule, number>; total: number }> {
  const events = activityEvents(snapshot).filter((event) => inRange(event.at, range));
  const first = range.from ?? events[0]?.at ?? now;
  const spanDays = Math.max(1, Math.ceil((now - first) / DAY));
  const bucketDays = spanDays > 60 ? 7 : 1;
  const startOfDay = (at: number) => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const origin = startOfDay(first);
  const buckets: Array<{ key: string; start: number; counts: Record<LearningModule, number>; total: number }> = [];
  for (let start = origin; start <= now; start = startOfDay(start + bucketDays * DAY + DAY / 2)) {
    buckets.push({ key: localDateKey(start), start, counts: { listening: 0, speaking: 0, writing: 0, grammar: 0, reading: 0, vocabulary: 0 }, total: 0 });
    if (buckets.length > 400) break;
  }
  for (const event of events) {
    let index = buckets.length - 1;
    while (index > 0 && (buckets[index] as { start: number }).start > event.at) index -= 1;
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.counts[event.module] += 1;
    bucket.total += 1;
  }
  return buckets;
}

export const METRIC_DEFINITIONS = {
  activeDays: 'Calendar days (your local time) with at least one practice action: a dictation line, a checked exercise, a recording, a submitted text, a finished text, a saved expression or a review.',
  completedExercises: 'Dictation lines submitted, comprehension sets checked, speaking attempts, writing submissions, grammar and vocabulary rounds checked, and vocabulary reviews.',
  recordedTime: 'The total length of your speaking recordings. Measured, not estimated.',
  timedWriting: 'Time on the optional writing timer, only for submissions where you used it. Measured, not estimated.',
  estimatedReading: 'An estimate for texts you marked as finished: their word count at 200 words per minute. Not measured.',
  dictationAccuracy: 'The average word accuracy of your dictation attempts (1 − word error rate), over all attempts in the period, including retries.',
  comprehension: 'Correct answers out of answered questions in checked sets. Short answers count only once you have rated them.',
  grammarAccuracy: 'Correct answers out of all questions in checked rounds, scored against the answer key. Unanswered questions count as not correct.',
  vocabularyReviews: 'Review ratings given; "remembered" means Good or Easy.',
  practiceAccuracy: 'Correct objective answers out of objective questions in checked practice rounds. Open answers are not part of this figure.',
  verifiedErrors: 'Corrections from AI feedback that quote your own words (verified against your text) and are classified as errors. Stylistic suggestions are counted separately.',
} as const;
