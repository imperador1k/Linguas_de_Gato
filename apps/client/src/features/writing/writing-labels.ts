import type { WritingDimension, WritingFormat, WritingRegister } from '@ldg/shared';

export const WRITING_FORMAT_GROUPS: ReadonlyArray<{ label: string; formats: readonly WritingFormat[] }> = [
  { label: 'Essays', formats: ['argumentative_essay', 'opinion_essay', 'discursive_essay'] },
  { label: 'Correspondence', formats: ['formal_email', 'informal_email'] },
  { label: 'Workplace and publications', formats: ['report', 'proposal', 'article', 'review'] },
  { label: 'Working with a text', formats: ['summary', 'paraphrase', 'reformulation'] },
];

export const WRITING_FORMAT_LABELS: Record<WritingFormat, string> = {
  argumentative_essay: 'Argumentative essay',
  opinion_essay: 'Opinion essay',
  discursive_essay: 'Discursive essay',
  formal_email: 'Formal email',
  informal_email: 'Informal email',
  report: 'Report',
  proposal: 'Proposal',
  article: 'Article',
  review: 'Review',
  summary: 'Summary',
  paraphrase: 'Paraphrase',
  reformulation: 'Reformulation',
};

export const REGISTER_LABELS: Record<WritingRegister, { label: string; hint: string }> = {
  formal: { label: 'Formal', hint: 'Impersonal and precise' },
  neutral: { label: 'Neutral', hint: 'Clear and polite' },
  informal: { label: 'Informal', hint: 'Friendly and natural' },
};

export const DIMENSION_LABELS: Record<WritingDimension, string> = {
  grammar: 'Grammar and accuracy',
  vocabulary: 'Vocabulary range and precision',
  naturalness: 'Collocations and naturalness',
  coherence: 'Coherence and cohesion',
  taskAchievement: 'Task achievement',
  register: 'Register and formality',
  sentenceVariety: 'Sentence variety',
};

export const ERROR_CATEGORY_LABELS = {
  grammar: 'Grammar',
  spelling: 'Spelling',
  punctuation: 'Punctuation',
  word_choice: 'Word choice',
  collocation: 'Collocation',
  register: 'Register',
  cohesion: 'Cohesion',
  sentence_structure: 'Sentence structure',
} as const;

export const TARGET_WORD_OPTIONS = [80, 120, 150, 200, 250, 300, 400] as const;

export const WRITING_DISCLAIMER = 'AI-generated practice task. The level is a target for practice, not an official CEFR assessment.';

export const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
