import type { ExpressionKind, VocabularyQuestionType } from '@ldg/shared';

export const KIND_LABELS: Record<ExpressionKind, string> = {
  word: 'Word',
  phrasal_verb: 'Phrasal verb',
  idiom: 'Idiom',
  collocation: 'Collocation',
  expression: 'Expression',
};

export const STATUS_LABELS = { new: 'New', learning: 'Learning', known: 'Known' } as const;

export const PRACTICE_TYPE_LABELS: Record<VocabularyQuestionType, { label: string; hint: string }> = {
  gap_fill: { label: 'Fill in the blank', hint: 'Use the expression in a new sentence' },
  meaning_choice: { label: 'Meaning in context', hint: 'Choose what it means here' },
  collocation: { label: 'Collocations', hint: 'Choose the natural word partner' },
  matching: { label: 'Matching', hint: 'Match expressions and meanings' },
  sentence_completion: { label: 'Sentence completion', hint: 'Finish a sentence with it' },
  paraphrase: { label: 'Paraphrasing', hint: 'Rewrite a sentence using it' },
  own_sentence: { label: 'Your own sentence', hint: 'Write a sentence of your own' },
};

export const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function describeDue(dueAt: number, now: number): string {
  if (dueAt <= now) return 'Due now';
  const days = Math.ceil((dueAt - now) / 86_400_000);
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}
