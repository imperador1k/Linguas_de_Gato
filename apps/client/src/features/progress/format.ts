import type { Confidence, InsightStatus, LearningModule, ObservationKind, Ratio, Trend } from '@ldg/shared';

export const MODULE_LABELS: Record<LearningModule, string> = { listening: 'Listening', speaking: 'Speaking', writing: 'Writing', grammar: 'Grammar', reading: 'Reading', vocabulary: 'Vocabulary' };

export const plural = (value: number, singular: string, many = `${singular}s`) => `${value} ${value === 1 ? singular : many}`;

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? '< 1 min' : '0 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatRatio(value: Ratio): string {
  if (value.total === 0) return 'No data';
  return `${Math.round((value.correct / value.total) * 100)}%`;
}

export function formatDate(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at));
}

export function formatShortDate(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(at));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABELS: Record<InsightStatus, string> = {
  recurring: 'Recurring',
  preliminary: 'Preliminary',
  improving: 'Improving',
  strength: 'Strength',
  insufficient: 'Not enough evidence',
};

export const TREND_LABELS: Record<Trend, string> = { improving: 'Fewer mistakes recently', worsening: 'More mistakes recently', stable: 'About the same', unknown: 'Not enough data for a trend' };

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

export const KIND_LABELS: Record<ObservationKind, string> = { error: 'Error', incorrect: 'Wrong answer', correct: 'Correct', suggestion: 'Suggestion' };

export const EVIDENCE_LABELS = {
  verified_quote: 'AI feedback quoting your words (verified)',
  answer_key: 'Checked against the answer key',
  self_assessment: 'Your own rating',
  dictation_comparison: 'Dictation compared with the transcript',
  review_rating: 'Your review rating',
  ai_rubric: 'AI review of an open answer',
} as const;
