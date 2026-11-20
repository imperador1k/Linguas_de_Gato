import type { TargetedPractice, TrainingModule } from '../contracts/learning.js';
import type { GrammarGenerationRequest, GrammarTopic } from '../contracts/grammar.js';
import type { SpeakingGenerationRequest } from '../contracts/exercise-generation.js';
import type { SpeakingSkillFocus } from '../contracts/speaking.js';
import type { WritingFormat, WritingGenerationRequest, WritingRegister } from '../contracts/writing.js';
import { isNegative, type LearningObservation } from './observations.js';
import { CATEGORY_INFO, type LearningCategory } from './taxonomy.js';

/**
 * Personalized training: which existing generator can target a category,
 * and the bounded profile sent with the request. Only categories a
 * generator can genuinely practise get an option; the rest point to
 * existing activities (dictation, reviews, reading) instead.
 */

export interface GrammarOption {
  readonly module: 'grammar';
  readonly topic: GrammarTopic;
  /** Narrows the topic when the category is more specific than the Grammar Lab's topics. */
  readonly focus: string | null;
}
export interface WritingOption {
  readonly module: 'writing';
  readonly format: WritingFormat;
  readonly register: WritingRegister;
  readonly objective: string;
}
export interface SpeakingOption {
  readonly module: 'speaking';
  readonly format: SpeakingGenerationRequest['format'];
  readonly skillFocus: SpeakingSkillFocus;
}
export type TrainingOption = GrammarOption | WritingOption | SpeakingOption;

const grammar = (topic: GrammarTopic, focus: string | null = null): GrammarOption => ({ module: 'grammar', topic, focus });
const writing = (objective: string, format: WritingFormat = 'opinion_essay', register: WritingRegister = 'neutral'): WritingOption => ({ module: 'writing', format, register, objective });
const speaking = (skillFocus: SpeakingSkillFocus, format: SpeakingGenerationRequest['format'] = 'guided'): SpeakingOption => ({ module: 'speaking', format, skillFocus });

export const TRAINING_OPTIONS: Partial<Record<LearningCategory, readonly TrainingOption[]>> = {
  articles: [grammar('articles_and_prepositions', 'articles: a, an, the and zero article'), writing('accurate use of articles')],
  prepositions: [grammar('articles_and_prepositions', 'dependent prepositions after verbs, nouns and adjectives'), writing('accurate dependent prepositions')],
  verb_tenses: [grammar('advanced_structures', 'choosing between past simple, present perfect and past perfect'), writing('accurate and consistent verb tenses'), speaking('grammatical_range')],
  subject_verb_agreement: [grammar('advanced_structures', 'subject-verb agreement, including after quantifiers and relative clauses'), writing('subject-verb agreement')],
  conditionals: [grammar('conditionals'), speaking('grammatical_range', 'critical_thinking')],
  word_order: [grammar('advanced_structures', 'word order of adverbs, questions and reported questions'), writing('natural word order')],
  sentence_structure: [grammar('advanced_structures'), writing('controlling complex sentences and sentence boundaries')],
  comparatives: [grammar('advanced_structures', 'comparative and superlative structures, including the more... the more'), writing('precise comparisons')],
  passive_voice: [grammar('passive_voice'), writing('using the passive appropriately', 'report', 'formal')],
  modal_verbs: [grammar('modal_verbs'), speaking('hedging_and_nuance')],
  relative_clauses: [grammar('relative_clauses'), writing('defining and non-defining relative clauses')],
  participle_clauses: [grammar('participle_clauses'), writing('participle clauses for concise writing')],
  reported_speech: [grammar('reported_speech'), writing('reporting verbs and reported speech', 'report', 'formal')],
  inversion: [grammar('inversion'), writing('inversion for emphasis', 'argumentative_essay', 'formal')],
  cleft_sentences: [grammar('cleft_sentences'), speaking('grammatical_range')],
  grammar_other: [grammar('advanced_structures')],
  vocabulary_precision: [speaking('lexical_range'), writing('precise vocabulary and avoiding repetition')],
  collocations: [grammar('collocations_and_phrasal_verbs', 'strong verb-noun and adjective-noun collocations'), speaking('lexical_range'), writing('natural collocations')],
  phrasal_verbs: [grammar('collocations_and_phrasal_verbs', 'phrasal verbs and their particles'), speaking('lexical_range', 'free')],
  naturalness: [speaking('lexical_range', 'free'), writing('natural, idiomatic phrasing', 'article')],
  register: [writing('consistent formal register', 'formal_email', 'formal'), speaking('register_and_tone')],
  coherence: [writing('developing and supporting arguments clearly', 'argumentative_essay'), speaking('argumentation', 'debate')],
  linking_devices: [grammar('linking_devices'), writing('cohesive devices between ideas', 'discursive_essay'), speaking('coherence')],
  task_achievement: [writing('covering every required element for the reader and purpose', 'proposal'), speaking('argumentation', 'guided')],
  punctuation: [writing('punctuation that supports clarity')],
};

export function trainingOptionsFor(category: LearningCategory): readonly TrainingOption[] {
  return TRAINING_OPTIONS[category] ?? [];
}

/** At most this many real examples are ever sent, each clipped. */
export const MAX_PROFILE_EXAMPLES = 5;

/**
 * The bounded profile for one category: its label and description, and up
 * to five recent, distinct, high- or medium-confidence mistakes with both
 * the original and the correction (when the learner chooses to include them).
 */
export function buildTargetedPractice(category: LearningCategory, observations: readonly LearningObservation[], includeExamples: boolean): TargetedPractice {
  const info = CATEGORY_INFO[category];
  const examples: TargetedPractice['examples'] = [];
  if (includeExamples) {
    const seen = new Set<string>();
    for (const observation of observations) {
      if (observation.category !== category || !isNegative(observation) || observation.confidence === 'low') continue;
      if (!observation.original || !observation.corrected) continue;
      const key = observation.original.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      examples.push({ original: observation.original.slice(0, 200), corrected: observation.corrected.slice(0, 200) });
      if (examples.length >= MAX_PROFILE_EXAMPLES) break;
    }
  }
  return { focus: info.label, description: `The learner repeatedly makes mistakes with ${info.description}.`.slice(0, 240), examples };
}

export interface TrainingRequestOptions {
  readonly level: 'B2' | 'C1' | 'C2';
  readonly questionCount: number;
  readonly targeted: TargetedPractice;
}

/** The generation request for an option: the existing generators, with the bounded profile attached. */
export function buildTrainingRequest(option: TrainingOption, options: TrainingRequestOptions): GrammarGenerationRequest | WritingGenerationRequest | SpeakingGenerationRequest {
  switch (option.module) {
    case 'grammar':
      return {
        kind: 'grammar',
        level: options.level,
        topic: option.topic,
        types: ['multiple_choice', 'gap_fill', 'error_correction', 'transformation'],
        questionCount: Math.min(12, Math.max(4, options.questionCount)),
        focus: option.focus,
        avoidTitles: [],
        targetedPractice: options.targeted,
      };
    case 'writing':
      return {
        kind: 'writing',
        level: options.level,
        format: option.format,
        category: 'society',
        interest: null,
        targetWords: 220,
        register: option.register,
        objective: option.objective.slice(0, 200),
        avoidTitles: [],
        targetedPractice: options.targeted,
      };
    case 'speaking':
      return {
        kind: 'speaking',
        level: options.level,
        category: 'society',
        interest: null,
        format: option.format,
        targetDurationSeconds: 120,
        skillFocus: option.skillFocus,
        avoidTitles: [],
        targetedPractice: options.targeted,
      };
  }
}

export const TRAINING_MODULE_LABELS: Record<TrainingModule, string> = { grammar: 'Grammar exercises', writing: 'Writing task', speaking: 'Speaking task' };
