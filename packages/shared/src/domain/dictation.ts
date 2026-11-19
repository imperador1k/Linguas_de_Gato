import type { DictationAttempt, DictationRecord } from '../contracts/listening-records.js';

/** Older attempts add little and would grow the record without bound. */
export const MAX_ATTEMPTS_PER_LINE = 20;

/** Appends an attempt, resetting history when the reference text has changed. */
export function appendDictationAttempt(
  existing: DictationRecord | undefined,
  input: { sessionId: string; cueId: string; referenceText: string; attempt: DictationAttempt },
): DictationRecord {
  const previous =
    existing && existing.referenceText === input.referenceText && existing.cueId === input.cueId ? existing.attempts : [];
  return {
    sessionId: input.sessionId,
    cueId: input.cueId,
    referenceText: input.referenceText,
    attempts: [...previous, input.attempt].slice(-MAX_ATTEMPTS_PER_LINE),
    updatedAt: input.attempt.submittedAt,
  };
}

export interface LineProgress {
  readonly attempts: number;
  readonly latestAccuracy: number;
  readonly bestAccuracy: number;
}

export function summarizeLine(record: DictationRecord | undefined, referenceText: string): LineProgress | null {
  if (!record || record.referenceText !== referenceText || record.attempts.length === 0) return null;
  const accuracies = record.attempts.map((attempt) => attempt.accuracy);
  return {
    attempts: accuracies.length,
    latestAccuracy: accuracies[accuracies.length - 1] ?? 0,
    bestAccuracy: Math.max(...accuracies),
  };
}

export interface DictationSummary {
  readonly practisedLines: number;
  readonly totalLines: number;
  /** Mean of each practised line's latest accuracy; null when nothing is practised. */
  readonly averageLatestAccuracy: number | null;
}

/** Progress over a transcript. Records whose reference no longer matches are ignored. */
export function summarizeDictation(
  cues: readonly { readonly id: string; readonly text: string }[],
  records: readonly DictationRecord[],
): DictationSummary {
  const byCue = new Map(records.map((record) => [record.cueId, record]));
  const latest: number[] = [];
  for (const cue of cues) {
    const line = summarizeLine(byCue.get(cue.id), cue.text);
    if (line) latest.push(line.latestAccuracy);
  }
  return {
    practisedLines: latest.length,
    totalLines: cues.length,
    averageLatestAccuracy: latest.length === 0 ? null : latest.reduce((sum, value) => sum + value, 0) / latest.length,
  };
}

/** Rounds an accuracy in [0, 1] to a whole percentage for display. */
export function formatAccuracy(accuracy: number): string {
  return `${Math.round(Math.min(1, Math.max(0, accuracy)) * 100)}%`;
}
