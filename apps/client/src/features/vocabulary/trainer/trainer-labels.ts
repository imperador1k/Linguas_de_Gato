import type { CollectionExercise, FacetStatus, PartOfSpeech, TrainerMode, TrainingFocus, VocabularyFacet, VocabularyTopic } from '@ldg/shared';

/** `spelling` is the stored name of Portuguese → English recall (kept for existing rounds). */
export const MODE_LABELS: Record<TrainerMode, { label: string; short: string; hint: string; instruction: string }> = {
  spelling: { label: 'Portuguese → English', short: 'PT → EN', hint: 'See the Portuguese meaning, write the English word', instruction: 'Write the English word for this meaning, in its dictionary form.' },
  recognition: { label: 'English → Portuguese', short: 'EN → PT', hint: 'See the English word, write what it means in Portuguese', instruction: 'Write what the English word means in Portuguese.' },
  context: { label: 'Context', short: 'Context', hint: 'Complete a sentence with the word, in the form it needs', instruction: 'Complete the sentence with the missing word, in the form the sentence needs.' },
  definition: { label: 'Definition', short: 'Definition', hint: 'English definition → the word', instruction: 'Write the word this definition describes.' },
  audio: { label: 'Audio', short: 'Audio', hint: 'Hear a recorded pronunciation and write the word', instruction: 'Listen and write the word.' },
};

export const EXERCISE_LABELS: Record<CollectionExercise, { label: string; hint: string }> = {
  mixed: { label: 'Mixed', hint: 'Each word gets the direction it needs most: new words are recognised first, then recalled, then used' },
  recognition: { label: MODE_LABELS.recognition.label, hint: MODE_LABELS.recognition.hint },
  recall: { label: MODE_LABELS.spelling.label, hint: MODE_LABELS.spelling.hint },
  context: { label: MODE_LABELS.context.label, hint: 'Complete one of your sentences with the word, in the form it needs' },
};

export const FOCUS_LABELS: Record<TrainingFocus, { label: string; hint: string }> = {
  mixed: { label: 'Mixed', hint: 'Difficult and due first, then new words, then the rest' },
  due: { label: 'Due', hint: 'Words whose review date has come' },
  difficult: { label: 'Difficult', hint: 'Words you got wrong recently or keep missing' },
  new: { label: 'New', hint: 'Words you have not been tested on yet' },
};

/** Facet names as the learner sees them. */
export const FACET_LABELS: Record<VocabularyFacet, { label: string; short: string; achieved: string }> = {
  recognition: { label: 'English → Portuguese', short: 'EN → PT', achieved: 'Recognised' },
  recall: { label: 'Portuguese → English', short: 'PT → EN', achieved: 'Recalled' },
  context: { label: 'In context', short: 'Context', achieved: 'Used in context' },
};

export const STATUS_TEXT: Record<FacetStatus, string> = {
  untested: 'Not tested yet',
  difficult: 'Difficult',
  learning: 'Learning',
  established: 'Established',
  secure: 'Secure',
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
