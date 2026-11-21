import type { AssessmentIssue } from '@ldg/shared';

export interface Highlight {
  readonly start: number;
  readonly end: number;
  /** Index of the issue in the assessment, which is also its visible number minus one. */
  readonly index: number;
  readonly major: boolean;
}

/**
 * Where each correction's quote sits in one transcript segment. Exact matches
 * first, then case-insensitive; quotes that can't be found are not marked
 * (the correction is still listed), and overlapping quotes keep the earlier one.
 */
export function highlightsFor(text: string, segmentId: string, issues: readonly AssessmentIssue[]): Highlight[] {
  const found: Highlight[] = [];
  issues.forEach((issue, index) => {
    if (issue.segmentId !== segmentId || !issue.original) return;
    let start = text.indexOf(issue.original);
    if (start < 0) start = text.toLowerCase().indexOf(issue.original.toLowerCase());
    if (start < 0) return;
    found.push({ start, end: start + issue.original.length, index, major: issue.severity === 'major' });
  });
  found.sort((a, b) => a.start - b.start || a.index - b.index);
  const kept: Highlight[] = [];
  for (const highlight of found) if (!kept.some((other) => highlight.start < other.end && other.start < highlight.end)) kept.push(highlight);
  return kept;
}
