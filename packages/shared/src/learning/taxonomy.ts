import type { GrammarTopic } from '../contracts/grammar.js';
import type { IssueCategory } from '../contracts/speaking.js';
import type { ERROR_CATEGORIES as WRITING_ERROR_CATEGORIES } from '../contracts/writing.js';

/**
 * The canonical learning-error taxonomy (M6). Every observation from every
 * module is normalised into one of these categories, so evidence from a
 * Writing correction and a Grammar answer about prepositions add up.
 *
 * Extended beyond the initial list where the existing data requires it:
 * the Grammar Lab's topics (inversion, passive voice, …), spelling and
 * punctuation from Writing, comparatives from Speaking feedback, and
 * vocabulary retention from reviews and practice.
 */
export const LEARNING_CATEGORIES = [
  // Grammar
  'articles',
  'prepositions',
  'verb_tenses',
  'subject_verb_agreement',
  'conditionals',
  'word_order',
  'sentence_structure',
  'comparatives',
  'passive_voice',
  'modal_verbs',
  'relative_clauses',
  'participle_clauses',
  'reported_speech',
  'inversion',
  'cleft_sentences',
  'grammar_other',
  // Vocabulary and expression
  'vocabulary_precision',
  'collocations',
  'phrasal_verbs',
  'naturalness',
  'register',
  'vocabulary_retention',
  // Discourse
  'coherence',
  'linking_devices',
  'task_achievement',
  // Accuracy of form
  'spelling',
  'punctuation',
  // Receptive skills
  'listening_recognition',
  'listening_comprehension',
  'reading_comprehension',
  'reading_inference',
  'vocabulary_in_context',
] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export const SKILL_AREAS = ['grammar', 'vocabulary', 'discourse', 'accuracy', 'listening', 'reading'] as const;
export type SkillArea = (typeof SKILL_AREAS)[number];

export const CATEGORY_INFO: Record<LearningCategory, { readonly label: string; readonly area: SkillArea; readonly description: string }> = {
  articles: { label: 'Articles', area: 'grammar', description: 'a, an, the and zero article' },
  prepositions: { label: 'Prepositions', area: 'grammar', description: 'prepositions, including dependent prepositions after verbs, nouns and adjectives' },
  verb_tenses: { label: 'Verb tenses', area: 'grammar', description: 'choice and form of tense and aspect' },
  subject_verb_agreement: { label: 'Subject–verb agreement', area: 'grammar', description: 'verbs agreeing with their subjects' },
  conditionals: { label: 'Conditionals', area: 'grammar', description: 'conditional and mixed conditional sentences' },
  word_order: { label: 'Word order', area: 'grammar', description: 'the order of words in phrases and clauses' },
  sentence_structure: { label: 'Sentence structure', area: 'grammar', description: 'sentence boundaries, clauses and complex structures' },
  comparatives: { label: 'Comparatives', area: 'grammar', description: 'comparative and superlative forms' },
  passive_voice: { label: 'Passive voice', area: 'grammar', description: 'passive forms and passive reporting structures' },
  modal_verbs: { label: 'Modal verbs', area: 'grammar', description: 'modals of deduction, obligation and criticism' },
  relative_clauses: { label: 'Relative clauses', area: 'grammar', description: 'defining and non-defining relative clauses' },
  participle_clauses: { label: 'Participle clauses', area: 'grammar', description: 'participle clauses for time, reason and result' },
  reported_speech: { label: 'Reported speech', area: 'grammar', description: 'reporting verbs and backshift' },
  inversion: { label: 'Inversion', area: 'grammar', description: 'inversion after negative adverbials and in conditionals' },
  cleft_sentences: { label: 'Cleft sentences', area: 'grammar', description: 'it- and wh-clefts for emphasis' },
  grammar_other: { label: 'Other grammar', area: 'grammar', description: 'grammar points not covered by a more specific category' },
  vocabulary_precision: { label: 'Vocabulary precision', area: 'vocabulary', description: 'choosing the precise word, avoiding repetition and wrong meanings' },
  collocations: { label: 'Collocations', area: 'vocabulary', description: 'natural word partnerships' },
  phrasal_verbs: { label: 'Phrasal verbs', area: 'vocabulary', description: 'phrasal verbs and their particles' },
  naturalness: { label: 'Naturalness', area: 'vocabulary', description: 'phrasing that sounds natural to proficient speakers' },
  register: { label: 'Register', area: 'vocabulary', description: 'formality and tone suited to the reader and situation' },
  vocabulary_retention: { label: 'Vocabulary retention', area: 'vocabulary', description: 'remembering the meaning and use of saved expressions' },
  coherence: { label: 'Coherence', area: 'discourse', description: 'organising and developing ideas and arguments' },
  linking_devices: { label: 'Linking devices', area: 'discourse', description: 'connectors and cohesive devices between ideas' },
  task_achievement: { label: 'Task achievement', area: 'discourse', description: 'doing what the task asks, for its reader and purpose' },
  spelling: { label: 'Spelling', area: 'accuracy', description: 'spelling of words' },
  punctuation: { label: 'Punctuation', area: 'accuracy', description: 'punctuation that affects clarity' },
  listening_recognition: { label: 'Word recognition (listening)', area: 'listening', description: 'hearing and writing down the exact words in dictation' },
  listening_comprehension: { label: 'Listening comprehension', area: 'listening', description: 'understanding the ideas, details and implications of recordings' },
  reading_comprehension: { label: 'Reading comprehension', area: 'reading', description: 'main ideas and details of texts' },
  reading_inference: { label: 'Reading inference', area: 'reading', description: 'inference, implication, intention and argument in texts' },
  vocabulary_in_context: { label: 'Vocabulary in context', area: 'reading', description: 'working out meaning from context' },
};

/**
 * Keyword rules for free-text labels (Speaking's "subcategory", Writing's
 * explanations). Order matters: specific rules first. Deterministic and
 * conservative: when nothing matches, the caller falls back to a broad
 * category instead of guessing.
 */
const RULES: ReadonlyArray<readonly [RegExp, LearningCategory]> = [
  [/phrasal verb/i, 'phrasal_verbs'],
  [/\bcollocat/i, 'collocations'],
  [/\barticles?\b|\bthe\b.*\barticle|zero article/i, 'articles'],
  [/preposition/i, 'prepositions'],
  [/agreement|\bagree\b/i, 'subject_verb_agreement'],
  [/conditional/i, 'conditionals'],
  [/word order/i, 'word_order'],
  [/comparative|superlative/i, 'comparatives'],
  [/passive/i, 'passive_voice'],
  [/\bmodal/i, 'modal_verbs'],
  [/relative (clause|pronoun)/i, 'relative_clauses'],
  [/participle clause/i, 'participle_clauses'],
  [/reported speech|reporting verb|backshift/i, 'reported_speech'],
  [/inversion/i, 'inversion'],
  [/cleft/i, 'cleft_sentences'],
  [/\btense|past simple|present perfect|past perfect|present simple|continuous|future form|\baspect\b/i, 'verb_tenses'],
  [/spelling|misspel/i, 'spelling'],
  [/punctuation|comma|apostrophe/i, 'punctuation'],
  [/register|formality|too (in)?formal/i, 'register'],
  [/linking|connector|cohesi|transition|discourse marker/i, 'linking_devices'],
  [/argument|develop(ment)? (of|the) (idea|point)|support(ing)? (a |the )?point|coheren/i, 'coherence'],
  [/run-on|fragment|sentence (structure|boundar)/i, 'sentence_structure'],
  [/idiom|natural|awkward|unidiomatic/i, 'naturalness'],
  [/repetition|repetitive|word choice|wrong word|precis|imprecise/i, 'vocabulary_precision'],
];

export function categorizeText(...texts: ReadonlyArray<string | null | undefined>): LearningCategory | null {
  const haystack = texts.filter(Boolean).join(' · ');
  for (const [pattern, category] of RULES) if (pattern.test(haystack)) return category;
  return null;
}

const SPEAKING_FALLBACK: Record<IssueCategory, LearningCategory> = {
  grammar: 'grammar_other',
  vocabulary: 'vocabulary_precision',
  coherence: 'coherence',
  naturalness: 'naturalness',
  task: 'task_achievement',
};

/** Speaking issues: the subcategory label decides; the broad category is the fallback. */
export function categorizeSpeakingIssue(issue: { category: IssueCategory; subcategory: string }): LearningCategory {
  const fromLabel = categorizeText(issue.subcategory);
  if (!fromLabel) return SPEAKING_FALLBACK[issue.category];
  // A grammar label can't turn a task or coherence issue into grammar, and vice versa.
  const area = CATEGORY_INFO[fromLabel].area;
  if (issue.category === 'task') return 'task_achievement';
  if (issue.category === 'coherence' && area !== 'discourse') return 'coherence';
  return fromLabel;
}

type WritingErrorCategory = (typeof WRITING_ERROR_CATEGORIES)[number];

/** Writing corrections: the category is authoritative except for grammar and word choice, which the explanation refines. */
export function categorizeWritingCorrection(correction: { category: WritingErrorCategory; explanation: string }): LearningCategory {
  switch (correction.category) {
    case 'spelling':
      return 'spelling';
    case 'punctuation':
      return 'punctuation';
    case 'collocation':
      return categorizeText(correction.explanation) === 'phrasal_verbs' ? 'phrasal_verbs' : 'collocations';
    case 'register':
      return 'register';
    case 'cohesion':
      return categorizeText(correction.explanation) === 'linking_devices' ? 'linking_devices' : 'coherence';
    case 'sentence_structure':
      return categorizeText(correction.explanation) === 'word_order' ? 'word_order' : 'sentence_structure';
    case 'word_choice': {
      const found = categorizeText(correction.explanation);
      return found && (found === 'prepositions' || found === 'phrasal_verbs' || found === 'collocations' || found === 'register' || found === 'naturalness') ? found : 'vocabulary_precision';
    }
    case 'grammar': {
      const found = categorizeText(correction.explanation);
      return found && CATEGORY_INFO[found].area === 'grammar' ? found : 'grammar_other';
    }
  }
}

const ARTICLES = new Set(['a', 'an', 'the']);

/** Grammar Lab topics map directly; articles vs prepositions is decided by the expected answer. */
export function categorizeGrammarTopic(topic: GrammarTopic, expectedAnswer: string | null): LearningCategory {
  switch (topic) {
    case 'articles_and_prepositions': {
      const words = (expectedAnswer ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return words.length > 0 && words.every((word) => ARTICLES.has(word)) ? 'articles' : 'prepositions';
    }
    case 'collocations_and_phrasal_verbs':
      return (expectedAnswer ?? '').trim().split(/\s+/).length >= 2 ? 'phrasal_verbs' : 'collocations';
    case 'linking_devices':
      return 'linking_devices';
    case 'advanced_structures':
      return 'sentence_structure';
    default:
      return topic;
  }
}
