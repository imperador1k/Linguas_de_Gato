import type { ListeningQuestionType } from '@ldg/shared';

export const QUESTION_TYPE_LABELS: Record<ListeningQuestionType, { label: string; description: string }> = {
  main_idea: { label: 'Main idea', description: 'The overall point or purpose.' },
  detail: { label: 'Detail', description: 'Specific facts, reasons and examples.' },
  inference: { label: 'Inference', description: 'What is implied but not said.' },
  speaker_intention: { label: 'Speaker intention', description: 'Why something is said; attitude.' },
  vocabulary_in_context: { label: 'Vocabulary in context', description: 'Meaning of a phrase as used.' },
};

export const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
