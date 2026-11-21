import type { PartOfSpeech, TrainerMode, VocabularyTopic } from '@ldg/shared';

export const MODE_LABELS: Record<TrainerMode, { label: string; hint: string; instruction: string }> = {
  spelling: { label: 'Spelling', hint: 'Portuguese meaning → the English word', instruction: 'Write the English word for this meaning.' },
  context: { label: 'Context', hint: 'Complete a sentence with the missing word', instruction: 'Complete the sentence with the missing word, in the form the sentence needs.' },
  definition: { label: 'Definition', hint: 'English definition → the word', instruction: 'Write the word this definition describes.' },
  audio: { label: 'Audio', hint: 'Hear a recorded pronunciation and write the word', instruction: 'Listen and write the word.' },
};

export const POS_LABELS: Record<PartOfSpeech, string> = {
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adjective',
  adverb: 'Adverb',
  preposition: 'Preposition',
  conjunction: 'Conjunction',
  pronoun: 'Pronoun',
  determiner: 'Determiner',
  interjection: 'Interjection',
  phrase: 'Expression',
};

export const TOPIC_LABELS: Record<VocabularyTopic, string> = {
  everyday: 'Everyday life',
  food: 'Food',
  technology: 'Technology',
  travel: 'Travel',
  work: 'Work',
  health: 'Health',
  education: 'Education',
  nature: 'Nature',
  home: 'Home',
  emotions: 'Feelings',
  money: 'Money',
};

export const ROUND_SIZES = [5, 10, 15, 20] as const;
