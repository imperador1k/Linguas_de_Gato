import {
  OBJECTIVE_VOCABULARY_TYPES,
  VOCABULARY_RECORD_VERSION,
  modelVocabularyQuestionSchema,
  type ModelVocabularyLookup,
  type PracticeItem,
  type ReviewRating,
  type ReviewState,
  type StoredVocabularyReview,
  type VocabularyAnswer,
  type VocabularyEntry,
  type VocabularyPracticeSet,
  type VocabularyQuestion,
  type VocabularyQuestionType,
  type VocabularySense,
  type VocabularySource,
} from '../contracts/vocabulary.js';
import { normalizeAnswer } from './grammar-answers.js';
import { containsWords } from './reading.js';
import { tokenizeForComparison } from './text-compare.js';

/**
 * Vocabulary logic: one collection entry per expression with distinct
 * contextual senses, a deliberately simple review ladder, and verification
 * and deterministic scoring of practice questions.
 */

const words = (text: string) => tokenizeForComparison(text, { ignoreBracketed: false }).map((token) => token.normalized);

/** The collection key: the lemma, lower-cased with normalised spacing and quotes. */
export function vocabularyKey(lemma: string): string {
  return words(lemma).join(' ');
}

/** Whether the lookup's evidence and expression really come from the selected sentence. */
export function lookupMatchesContext(lookup: Pick<ModelVocabularyLookup, 'contextEvidence'>, sentence: string, selection: string): boolean {
  return containsWords(sentence, lookup.contextEvidence) && containsWords(lookup.contextEvidence, selection);
}

// --- Review schedule -------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
/** Days until the next review at each step: a fixed ladder, not an adaptive algorithm. */
export const REVIEW_LADDER_DAYS = [0, 1, 3, 7, 16, 35] as const;
const KNOWN_STEP = 4;

export function initialReviewState(now: number): ReviewState {
  return { status: 'new', step: 0, dueAt: now, lastReviewedAt: null, history: [] };
}

/**
 * "again": back to the start, due tomorrow. "good": one step up the ladder.
 * "easy": two steps up. From step 4 (about two weeks) an entry counts as known.
 */
export function scheduleReview(state: ReviewState, rating: ReviewRating, now: number): ReviewState {
  const last = REVIEW_LADDER_DAYS.length - 1;
  const step = rating === 'again' ? 1 : Math.min(last, state.step + (rating === 'easy' ? 2 : 1));
  const days: number = REVIEW_LADDER_DAYS[step] ?? REVIEW_LADDER_DAYS[last] ?? 1;
  return {
    status: rating === 'again' ? 'learning' : step >= KNOWN_STEP ? 'known' : 'learning',
    step,
    dueAt: now + days * DAY,
    lastReviewedAt: now,
    history: [...state.history, { at: now, rating }].slice(-20),
  };
}

export function isDue(entry: Pick<VocabularyEntry, 'review'>, now: number): boolean {
  return entry.review.dueAt <= now;
}

export function dueEntries(entries: readonly VocabularyEntry[], now: number): VocabularyEntry[] {
  return entries.filter((entry) => isDue(entry, now)).sort((a, b) => a.review.dueAt - b.review.dueAt);
}

// --- Saving lookups --------------------------------------------------------------------------

export type SaveOutcome = 'created' | 'added_sense' | 'already_saved';

function senseFromLookup(lookup: ModelVocabularyLookup, context: string, source: VocabularySource, now: number, id: string): VocabularySense {
  return {
    id,
    contextualMeaning: lookup.contextualMeaning,
    dictionaryMeaning: lookup.dictionaryMeaning,
    partOfSpeech: lookup.partOfSpeech,
    context,
    source,
    examples: lookup.examples.slice(0, 4),
    collocations: lookup.collocations,
    synonyms: lookup.synonyms,
    antonyms: lookup.antonyms,
    register: lookup.register,
    patterns: lookup.patterns,
    cefrEstimate: lookup.cefrEstimate,
    portugueseExplanation: lookup.portugueseExplanation,
    addedAt: now,
  };
}

/** Same sense: same dictionary meaning, or met in the same sentence. */
function isSameSense(sense: VocabularySense, lookup: ModelVocabularyLookup, context: string): boolean {
  return normalizeAnswer(sense.dictionaryMeaning) === normalizeAnswer(lookup.dictionaryMeaning) || normalizeAnswer(sense.context) === normalizeAnswer(context);
}

/**
 * Saves a lookup without duplicating: a new expression creates an entry; an
 * existing expression gains a sense only when this meaning (or sentence) is
 * new; otherwise nothing changes.
 */
export function saveLookup(
  existing: VocabularyEntry | null,
  lookup: ModelVocabularyLookup,
  context: { readonly sentence: string; readonly source: VocabularySource },
  now: number,
  ids: { readonly entryId: string; readonly senseId: string },
): { entry: VocabularyEntry; outcome: SaveOutcome } {
  const sense = senseFromLookup(lookup, context.sentence, context.source, now, ids.senseId);
  if (!existing) {
    return {
      outcome: 'created',
      entry: {
        id: ids.entryId,
        version: VOCABULARY_RECORD_VERSION,
        language: 'en',
        expression: lookup.expression,
        lemma: lookup.lemma,
        key: vocabularyKey(lookup.lemma),
        kind: lookup.kind,
        senses: [sense],
        review: initialReviewState(now),
        createdAt: now,
        updatedAt: now,
      },
    };
  }
  if (existing.senses.some((candidate) => isSameSense(candidate, lookup, context.sentence))) return { entry: existing, outcome: 'already_saved' };
  if (existing.senses.length >= 10) return { entry: existing, outcome: 'already_saved' };
  // A new meaning is new material: bring the entry back for review.
  return {
    outcome: 'added_sense',
    entry: { ...existing, senses: [...existing.senses, sense], review: { ...existing.review, dueAt: Math.min(existing.review.dueAt, now) }, updatedAt: now },
  };
}

/** Removes one sense; null means the entry has no senses left and should be deleted. */
export function withoutSense(entry: VocabularyEntry, senseId: string, now: number): VocabularyEntry | null {
  const senses = entry.senses.filter((sense) => sense.id !== senseId);
  return senses.length === 0 ? null : { ...entry, senses, updatedAt: now };
}

export function toPracticeItem(entry: VocabularyEntry): PracticeItem {
  const sense = entry.senses[0] as VocabularySense;
  return { id: entry.id, expression: entry.expression, meaning: sense.contextualMeaning, context: sense.context };
}

// --- Practice verification ---------------------------------------------------------------------

const gapCount = (prompt: string) => prompt.split('___').length - 1;

/**
 * Keeps practice questions that are consistent and tied to the learner's
 * items: a known item id; one gap where a gap is needed; 3-4 distinct options
 * with a valid key; matching pairs of distinct, known items; gap answers that
 * use the target expression's words.
 */
export function verifyVocabularyQuestions(
  raw: readonly unknown[],
  items: readonly PracticeItem[],
  options: { readonly types: readonly VocabularyQuestionType[]; readonly maxQuestions: number },
): { questions: VocabularyQuestion[]; discarded: number } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const allowed = new Set(options.types);
  const seen = new Set<string>();
  const questions: VocabularyQuestion[] = [];
  let discarded = 0;

  for (const item of raw) {
    const parsed = modelVocabularyQuestionSchema.safeParse(item);
    const question = parsed.success ? parsed.data : null;
    const target = question ? byId.get(question.itemId) : undefined;
    const verified = question && target && allowed.has(question.type) ? toVerified(question, target, byId, `q${questions.length + 1}`) : null;
    const key = verified ? `${verified.type}|${normalizeAnswer(verified.prompt)}|${verified.itemId}` : '';
    if (!verified || seen.has(key)) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    questions.push(verified);
    if (questions.length >= options.maxQuestions) break;
  }
  return { questions, discarded };
}

/**
 * A loose guard against answers unrelated to the target: at least half of
 * the expression's content words must appear, allowing regular inflections
 * (a shared 3-letter stem). Irregular forms such as "broke even" still pass
 * through their other words; this is not a correctness check.
 */
function usesExpression(answer: string, expression: string): boolean {
  const answerWords = words(answer);
  const content = words(expression).filter((word) => word.length > 2);
  const required = content.length > 0 ? content : words(expression);
  const matches = required.filter((word) => answerWords.some((candidate) => candidate === word || (word.length >= 4 && candidate.length >= 4 && candidate.slice(0, 3) === word.slice(0, 3))));
  return matches.length >= Math.ceil(required.length / 2);
}

function toVerified(question: ReturnType<typeof modelVocabularyQuestionSchema.parse>, target: PracticeItem, byId: Map<string, PracticeItem>, id: string): VocabularyQuestion | null {
  const base = { id, itemId: question.itemId, prompt: question.prompt, explanation: question.explanation };
  const distinctOptions = new Set(question.options.map(normalizeAnswer)).size === question.options.length;
  const answers = [...new Map(question.acceptedAnswers.map((answer) => [normalizeAnswer(answer), answer])).values()].filter((answer) => normalizeAnswer(answer) !== '');
  switch (question.type) {
    case 'gap_fill':
      if (gapCount(question.prompt) !== 1 || answers.length === 0 || !answers.every((answer) => usesExpression(answer, target.expression))) return null;
      return { ...base, type: 'gap_fill', acceptedAnswers: answers };
    case 'meaning_choice':
    case 'collocation': {
      const index = question.correctOptionIndex;
      if (question.options.length < 3 || index === null || index >= question.options.length || !distinctOptions) return null;
      return { ...base, type: question.type, options: [...question.options], correctOptionIndex: index };
    }
    case 'matching': {
      const pairs = question.pairs;
      const known = pairs.every((pair) => byId.has(pair.itemId));
      const distinct = new Set(pairs.map((pair) => pair.itemId)).size === pairs.length && new Set(pairs.map((pair) => normalizeAnswer(pair.meaning))).size === pairs.length;
      if (pairs.length < 3 || !known || !distinct) return null;
      return { ...base, type: 'matching', pairs: pairs.map((pair) => ({ ...pair })) };
    }
    case 'sentence_completion':
      if (gapCount(question.prompt) !== 1 || answers.length === 0) return null;
      return { ...base, type: 'sentence_completion', acceptedAnswers: answers };
    case 'paraphrase':
      if (answers.length === 0 || !answers.every((answer) => usesExpression(answer, target.expression))) return null;
      return { ...base, type: 'paraphrase', acceptedAnswers: answers };
    case 'own_sentence':
      return { ...base, type: 'own_sentence' };
  }
}

// --- Scoring and lifecycle ------------------------------------------------------------------------

/** A deterministic, seeded shuffle (so the display order of matching meanings is stable across reloads). */
export function seededShuffle(length: number, seed: string): number[] {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  const order = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const swap = state % (index + 1);
    [order[index], order[swap]] = [order[swap] as number, order[index] as number];
  }
  // Never present matching already solved.
  if (length > 1 && order.every((value, index) => value === index)) order.push(order.shift() as number);
  return order;
}

export type VocabularyOutcome = 'correct' | 'incorrect' | 'unanswered' | 'open';

/**
 * Objective types are scored against the key. Open types (completion,
 * paraphrase, own sentence) are "open": a listed answer counts as correct,
 * anything else needs the separate AI evaluation.
 */
export function evaluateVocabularyAnswer(question: VocabularyQuestion, answer: VocabularyAnswer | undefined): VocabularyOutcome {
  if (!answer) return 'unanswered';
  switch (question.type) {
    case 'meaning_choice':
    case 'collocation':
      return answer.kind === 'choice' ? (answer.selectedIndex === question.correctOptionIndex ? 'correct' : 'incorrect') : 'unanswered';
    case 'matching':
      if (answer.kind !== 'matching' || answer.choices.every((choice) => choice < 0)) return 'unanswered';
      return question.pairs.every((_, index) => answer.choices[index] === index) ? 'correct' : 'incorrect';
    case 'gap_fill':
      if (answer.kind !== 'text' || answer.text.trim() === '') return 'unanswered';
      return question.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === normalizeAnswer(answer.text) || normalizeAnswer(question.prompt.replace('___', accepted)) === normalizeAnswer(answer.text))
        ? 'correct'
        : 'incorrect';
    case 'sentence_completion':
    case 'paraphrase':
    case 'own_sentence': {
      if (answer.kind !== 'text' || answer.text.trim() === '') return 'unanswered';
      const listed = question.type !== 'own_sentence' && question.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === normalizeAnswer(answer.text));
      return listed ? 'correct' : 'open';
    }
  }
}

export function scoreVocabularySet(set: Pick<VocabularyPracticeSet, 'questions' | 'answers'>) {
  const byQuestion = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  let objectiveTotal = 0;
  let correct = 0;
  let open = 0;
  let answered = 0;
  for (const question of set.questions) {
    const outcome = evaluateVocabularyAnswer(question, byQuestion.get(question.id));
    if (outcome !== 'unanswered') answered += 1;
    if (OBJECTIVE_VOCABULARY_TYPES.has(question.type)) {
      objectiveTotal += 1;
      if (outcome === 'correct') correct += 1;
    } else if (outcome === 'open') open += 1;
  }
  return { total: set.questions.length, answered, objectiveTotal, correct, open };
}

export function withVocabularyAnswer(set: VocabularyPracticeSet, answer: VocabularyAnswer, now: number): VocabularyPracticeSet {
  if (set.checkedAt !== null) return set;
  const question = set.questions.find((candidate) => candidate.id === answer.questionId);
  if (!question) return set;
  const expected = question.type === 'meaning_choice' || question.type === 'collocation' ? 'choice' : question.type === 'matching' ? 'matching' : 'text';
  if (answer.kind !== expected) return set;
  return { ...set, answers: [...set.answers.filter((candidate) => candidate.questionId !== answer.questionId), answer], updatedAt: now };
}

export function checkVocabularySet(set: VocabularyPracticeSet, now: number): VocabularyPracticeSet {
  if (set.checkedAt !== null) return set;
  const { correct, objectiveTotal } = scoreVocabularySet(set);
  return { ...set, checkedAt: now, history: [...set.history, { checkedAt: now, correct, objectiveTotal }].slice(-100), updatedAt: now };
}

export function retryVocabularySet(set: VocabularyPracticeSet, now: number): VocabularyPracticeSet {
  return { ...set, answers: [], reviews: [], checkedAt: null, updatedAt: now };
}

/** An AI review is stored only for an open answer of the checked round, for the exact text reviewed. */
export function withVocabularyReview(set: VocabularyPracticeSet, review: StoredVocabularyReview, now: number): VocabularyPracticeSet {
  const question = set.questions.find((candidate) => candidate.id === review.questionId);
  const answer = set.answers.find((candidate) => candidate.questionId === review.questionId);
  if (set.checkedAt === null || !question || OBJECTIVE_VOCABULARY_TYPES.has(question.type) || answer?.kind !== 'text' || answer.text !== review.answer) return set;
  return { ...set, reviews: [...set.reviews.filter((existing) => existing.questionId !== review.questionId), review], updatedAt: now };
}
