import type { ReadingQuestionType, ReadingTextType } from '@ldg/shared';

export const TEXT_TYPE_LABELS: Record<ReadingTextType, string> = {
  article: 'Feature article',
  opinion_piece: 'Opinion piece',
  informative_article: 'Informative article',
  report: 'Report',
  narrative: 'Narrative',
};

export const QUESTION_TYPE_LABELS: Record<ReadingQuestionType, { label: string; hint: string }> = {
  main_idea: { label: 'Main idea', hint: 'The central point' },
  detail: { label: 'Specific detail', hint: 'Facts, reasons, examples' },
  inference: { label: 'Inference', hint: 'What is implied' },
  author_intention: { label: "Author's intention", hint: 'Purpose, attitude, tone' },
  argument_analysis: { label: 'Argument analysis', hint: 'How the case is built' },
  vocabulary_in_context: { label: 'Vocabulary in context', hint: 'Meaning as used here' },
  implication: { label: 'Meaning and implication', hint: 'What follows from it' },
};

export const LENGTH_OPTIONS = [250, 400, 600, 800] as const;

export const READING_DISCLAIMER = 'AI-generated text for practice. The level is a target, not an official CEFR assessment.';

export const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
