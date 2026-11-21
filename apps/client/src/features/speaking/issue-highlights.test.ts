import type { AssessmentIssue } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { highlightsFor } from './issue-highlights';

function issue(segmentId: string, original: string, severity: AssessmentIssue['severity'] = 'minor'): AssessmentIssue {
  return { segmentId, original, severity, correction: 'x', category: 'grammar', subcategory: 'tense', explanation: 'e', advancedAlternative: null, startMs: 0 } as AssessmentIssue;
}

describe('highlightsFor', () => {
  const text = 'Yesterday I go to the office and I have discussed about the budget.';

  it('marks each quote in its own segment, numbered by position in the assessment', () => {
    const issues = [issue('s2', 'other segment'), issue('s1', 'I go'), issue('s1', 'discussed about', 'major')];
    expect(highlightsFor(text, 's1', issues)).toEqual([
      { start: 10, end: 14, index: 1, major: false },
      { start: text.indexOf('discussed'), end: text.indexOf('discussed') + 'discussed about'.length, index: 2, major: true },
    ]);
  });

  it('falls back to a case-insensitive match', () => {
    expect(highlightsFor(text, 's1', [issue('s1', 'yesterday I go')])).toEqual([{ start: 0, end: 14, index: 0, major: false }]);
  });

  it('skips quotes that are not in the text instead of guessing', () => {
    expect(highlightsFor(text, 's1', [issue('s1', 'went yesterday')])).toEqual([]);
  });

  it('keeps the earlier of two overlapping quotes', () => {
    const marks = highlightsFor(text, 's1', [issue('s1', 'I go to the office'), issue('s1', 'the office and')]);
    expect(marks.map((mark) => mark.index)).toEqual([0]);
  });
});
