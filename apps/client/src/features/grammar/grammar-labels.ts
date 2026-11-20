import type { GrammarQuestionType, GrammarTopic } from '@ldg/shared';

export const GRAMMAR_TOPIC_LABELS: Record<GrammarTopic, string> = {
  conditionals: 'Conditionals and mixed conditionals',
  inversion: 'Inversion',
  passive_voice: 'Passive voice',
  modal_verbs: 'Modal verbs',
  relative_clauses: 'Relative clauses',
  participle_clauses: 'Participle clauses',
  reported_speech: 'Reported speech',
  articles_and_prepositions: 'Articles and prepositions',
  cleft_sentences: 'Cleft sentences',
  linking_devices: 'Advanced linking devices',
  collocations_and_phrasal_verbs: 'Collocations and phrasal verbs',
  advanced_structures: 'Advanced sentence structures',
};

export const QUESTION_TYPE_LABELS: Record<GrammarQuestionType, { label: string; hint: string }> = {
  multiple_choice: { label: 'Multiple choice', hint: 'Choose the correct option' },
  gap_fill: { label: 'Gap filling', hint: 'Write the missing words' },
  error_correction: { label: 'Error correction', hint: 'Find and fix the mistake' },
  transformation: { label: 'Sentence transformation', hint: 'Same meaning, with a given word' },
  word_order: { label: 'Word order', hint: 'Build the sentence' },
  sentence_completion: { label: 'Sentence completion', hint: 'Finish the sentence' },
};

export const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
