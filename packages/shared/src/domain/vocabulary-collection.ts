import { GAP_MARKER } from '../contracts/vocabulary-pack.js';
import type { LocalVocabularyQuestion, VocabularyEntry, VocabularyFacet, VocabularySense } from '../contracts/vocabulary.js';
import { facetStatus,hasUsedInContext, isFacetDue, recognisesButCannotRecall, type FacetStatus } from './vocabulary-knowledge.js';
import { translationsOf } from './vocabulary-personal.js';
import type { TrainingPriority } from './vocabulary-trainer.js';
import { seededShuffle } from './vocabulary.js';

/*
 * Training the learner's own collection (V1). Every question is built from
 * the data the learner gave (or the library supplied) for one sense:
 * - English → Portuguese (recognition): the sense's translations, all of them accepted;
 * - Portuguese → English (recall): the dictionary form, plus alternatives the
 *   learner listed for this sense; other forms are "right word, wrong form";
 * - context: a sentence of the sense that contains the word or one of its
 *   listed forms; that exact form is the answer and the others are "the right
 *   word in the wrong form for this sentence".
 * Nothing is ever inferred: a sense without translations is not offered in
 * either translation direction, and a sentence without the word is not a
 * context question.
 */

export const COLLECTION_EXERCISES = ['mixed', 'recognition', 'recall', 'context'] as const;
export type CollectionExercise = (typeof COLLECTION_EXERCISES)[number];
export const TRAINING_FOCUSES = ['mixed', 'due', 'difficult', 'new'] as const;
export type TrainingFocus = (typeof TRAINING_FOCUSES)[number];

const FACET_ORDER: readonly VocabularyFacet[] = ['recognition', 'recall', 'context'];

export function collectionItemId(entryId: string, senseId: string): string {
  return `collection/${entryId}/${senseId}`;
}

/** English answers accepted for recall besides the lemma. Library senses saved before V1 kept them as `synonyms`. */
export function alternativesOf(sense: Pick<VocabularySense, 'alternatives' | 'source' | 'synonyms'>): string[] {
  return sense.alternatives ?? (sense.source.kind === 'library' ? sense.synonyms : []);
}

/** Other forms of the word in this sense: listed forms, and the text as met in Reading when it is not the dictionary form. */
export function formsOf(entry: Pick<VocabularyEntry, 'lemma' | 'expression'>, sense: Pick<VocabularySense, 'forms'>): string[] {
  const lemma = entry.lemma.toLowerCase();
  const all = [...(sense.forms ?? []), entry.expression];
  const seen = new Set<string>([lemma]);
  return all.filter((form) => {
    const key = form.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SenseContext {
  readonly id: string;
  /** The sentence with one gap marker. */
  readonly sentence: string;
  /** The form the sentence uses (from the listed forms, as the learner wrote it). */
  readonly answer: string;
  /** The original sentence. */
  readonly full: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds a whole-word occurrence of `target` (case-insensitive, flexible spacing). */
function findWord(sentence: string, target: string): { index: number; length: number } | null {
  const pattern = target.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  if (!pattern) return null;
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
  return match ? { index: match.index, length: match[0].length } : null;
}

/**
 * Sentences of a sense usable for context practice: the sentence it was met
 * in and its examples, each containing the word itself or a listed form
 * (longest form first, so "looked after" wins over "look").
 */
export function contextsOf(entry: Pick<VocabularyEntry, 'lemma' | 'expression'>, sense: Pick<VocabularySense, 'context' | 'examples' | 'forms'>): SenseContext[] {
  const targets = [entry.lemma, ...formsOf(entry, sense)].sort((a, b) => b.length - a.length);
  const sentences = [...new Set([sense.context, ...sense.examples].map((value) => value.trim()).filter((value) => value !== '' && !value.includes(GAP_MARKER)))];
  const contexts: SenseContext[] = [];
  sentences.forEach((full, index) => {
    for (const target of targets) {
      const found = findWord(full, target);
      if (!found) continue;
      contexts.push({ id: `c${index + 1}`, sentence: `${full.slice(0, found.index)}${GAP_MARKER}${full.slice(found.index + found.length)}`.slice(0, 600), answer: target, full });
      return;
    }
  });
  return contexts;
}

export function supportedFacets(entry: VocabularyEntry, sense: VocabularySense): VocabularyFacet[] {
  const translated = translationsOf(sense).length > 0;
  return FACET_ORDER.filter((facet) => (facet === 'context' ? contextsOf(entry, sense).length > 0 : translated));
}

function explanationOf(sense: VocabularySense): string {
  const translations = translationsOf(sense);
  const parts = [translations.length ? `PT: ${translations.join(', ')}` : sense.contextualMeaning, sense.notes ?? null].filter(Boolean);
  return parts.join(' — ').slice(0, 500);
}

/** One question on one sense and facet. Throws if the sense cannot support the facet (callers check `supportedFacets`). */
export function collectionQuestion(entry: VocabularyEntry, sense: VocabularySense, facet: VocabularyFacet, index: number, seed: string): LocalVocabularyQuestion {
  const translations = translationsOf(sense);
  const base = {
    id: `q${index + 1}`,
    itemId: collectionItemId(entry.id, sense.id),
    explanation: explanationOf(sense) || entry.lemma,
    language: entry.language,
    lemma: entry.lemma,
    ...(sense.partOfSpeech ? { partOfSpeech: sense.partOfSpeech.slice(0, 40) } : {}),
  };
  const ref = { kind: 'collection' as const, entryId: entry.id, senseId: sense.id };
  const forms = formsOf(entry, sense);
  if (facet === 'context') {
    const contexts = contextsOf(entry, sense);
    const chosen = contexts[seededShuffle(contexts.length, `${seed}:${sense.id}`)[0] ?? 0] ?? contexts[0];
    if (!chosen) throw new Error(`Sense ${sense.id} has no sentence containing the word.`);
    const lower = chosen.answer.toLowerCase();
    return {
      ...base,
      type: 'context',
      prompt: chosen.sentence,
      // The meaning is shown with the sentence: several words often fit a gap, and the exercise tests this one.
      clue: (translations.length ? translations.join(', ') : sense.contextualMeaning).slice(0, 300),
      answer: chosen.answer,
      accepted: [],
      forms: [entry.lemma, ...forms].filter((form) => form.toLowerCase() !== lower).slice(0, 16),
      ref: { ...ref, contextId: chosen.id },
    };
  }
  if (translations.length === 0) throw new Error(`Sense ${sense.id} has no Portuguese translation.`);
  if (facet === 'recognition') {
    const example = contextsOf(entry, sense)[0]?.full ?? null;
    return { ...base, type: 'recognition', prompt: entry.lemma, example, answer: translations[0] as string, accepted: translations.slice(1, 13), forms: [], ref: { ...ref, contextId: null } };
  }
  // Recall expects the dictionary form. "to eat" for a verb is the same answer written with its infinitive marker.
  const alternatives = alternativesOf(sense);
  const infinitive = sense.partOfSpeech.toLowerCase() === 'verb' && !/^to\s/i.test(entry.lemma) ? [`to ${entry.lemma}`] : [];
  return { ...base, type: 'spelling', prompt: translations.join(' / '), answer: entry.lemma, accepted: [...alternatives, ...infinitive].slice(0, 12), forms: forms.slice(0, 16), ref: { ...ref, contextId: null } };
}

// --- Choosing what to train -----------------------------------------------------------------

export interface FacetView {
  readonly facet: VocabularyFacet;
  readonly status: FacetStatus;
  readonly due: boolean;
  readonly supported: boolean;
  readonly dueAt: number | null;
  readonly attempts: number;
}

export function facetViews(entry: VocabularyEntry, sense: VocabularySense, now: number): FacetView[] {
  const supported = new Set(supportedFacets(entry, sense));
  return FACET_ORDER.map((facet) => {
    const knowledge = sense.knowledge?.[facet];
    return { facet, status: facetStatus(knowledge), due: isFacetDue(knowledge, now), supported: supported.has(facet), dueAt: knowledge?.attempts.length ? knowledge.dueAt : null, attempts: knowledge?.attempts.length ?? 0 };
  });
}

function priorityOfView(view: FacetView): TrainingPriority {
  if (view.status === 'difficult') return 0;
  if (view.due) return 1;
  if (view.status === 'untested') return 2;
  return 3;
}

function matchesFocus(view: FacetView, focus: TrainingFocus): boolean {
  switch (focus) {
    case 'due':
      return view.due;
    case 'difficult':
      return view.status === 'difficult';
    case 'new':
      return view.status === 'untested';
    case 'mixed':
      return true;
  }
}

export interface CollectionCandidate {
  readonly entry: VocabularyEntry;
  readonly sense: VocabularySense;
  readonly facet: VocabularyFacet;
  readonly priority: TrainingPriority;
  readonly dueAt: number | null;
}

/**
 * At most one candidate per entry (two meanings of "book" in one round would
 * give each other away): the sense × facet that most needs attention. With
 * the mixed exercise, ties go to recognition before recall before context,
 * so a new word is first recognised, then recalled, then used.
 */
export function collectionCandidates(entries: readonly VocabularyEntry[], options: { readonly exercise: CollectionExercise; readonly focus: TrainingFocus; readonly now: number; readonly seed?: string }): CollectionCandidate[] {
  const facets = options.exercise === 'mixed' ? FACET_ORDER : [options.exercise];
  const candidates: CollectionCandidate[] = [];
  for (const entry of entries) {
    const options_: CollectionCandidate[] = [];
    for (const sense of entry.senses) {
      for (const view of facetViews(entry, sense, options.now)) {
        if (!view.supported || !facets.includes(view.facet) || !matchesFocus(view, options.focus)) continue;
        options_.push({ entry, sense, facet: view.facet, priority: priorityOfView(view), dueAt: view.dueAt });
      }
    }
    if (options_.length === 0) continue;
    const order = seededShuffle(options_.length, `${options.seed ?? ''}:${entry.id}`);
    const ranked = order
      .map((index, position) => ({ candidate: options_[index] as CollectionCandidate, position }))
      .sort((a, b) => a.candidate.priority - b.candidate.priority || FACET_ORDER.indexOf(a.candidate.facet) - FACET_ORDER.indexOf(b.candidate.facet) || a.position - b.position);
    const best = ranked[0]?.candidate;
    if (best) candidates.push(best);
  }
  return candidates;
}

export interface CollectionRoundOptions {
  readonly entries: readonly VocabularyEntry[];
  readonly exercise: CollectionExercise;
  readonly focus: TrainingFocus;
  readonly count: number;
  readonly seed: string;
  readonly now: number;
}

/** A seeded round from the collection: what needs attention first (difficult, due — oldest first — new, then the rest). */
export function buildCollectionRound({ entries, exercise, focus, count, seed, now }: CollectionRoundOptions): LocalVocabularyQuestion[] {
  const candidates = collectionCandidates(entries, { exercise, focus, now, seed });
  const order = seededShuffle(candidates.length, seed);
  const ranked = order
    .map((index, position) => ({ candidate: candidates[index] as CollectionCandidate, position }))
    .sort((a, b) => a.candidate.priority - b.candidate.priority || (a.candidate.priority === 1 ? (a.candidate.dueAt ?? 0) - (b.candidate.dueAt ?? 0) : 0) || a.position - b.position)
    .map(({ candidate }) => candidate);
  return ranked.slice(0, Math.max(0, count)).map((candidate, index) => collectionQuestion(candidate.entry, candidate.sense, candidate.facet, index, seed));
}

/** How many words each focus would offer for an exercise (for the setup screen). */
export function focusCounts(entries: readonly VocabularyEntry[], exercise: CollectionExercise, now: number): Record<TrainingFocus, number> {
  return Object.fromEntries(TRAINING_FOCUSES.map((focus) => [focus, collectionCandidates(entries, { exercise, focus, now }).length])) as Record<TrainingFocus, number>;
}

// --- Knowledge filters and summary ------------------------------------------------------------

export const KNOWLEDGE_FILTERS = ['due', 'difficult', 'untested', 'recognise_not_recall', 'used_in_context', 'not_trainable'] as const;
export type KnowledgeFilter = (typeof KNOWLEDGE_FILTERS)[number];

export function senseMatchesFilter(entry: VocabularyEntry, sense: VocabularySense, filter: KnowledgeFilter, now: number): boolean {
  const views = facetViews(entry, sense, now);
  switch (filter) {
    case 'due':
      return views.some((view) => view.due);
    case 'difficult':
      return views.some((view) => view.status === 'difficult');
    case 'untested':
      return views.some((view) => view.supported) && views.every((view) => view.status === 'untested');
    case 'recognise_not_recall':
      return recognisesButCannotRecall(sense);
    case 'used_in_context':
      return hasUsedInContext(sense);
    case 'not_trainable':
      return views.every((view) => !view.supported);
  }
}

export function entryMatchesFilter(entry: VocabularyEntry, filter: KnowledgeFilter, now: number): boolean {
  return entry.senses.some((sense) => senseMatchesFilter(entry, sense, filter, now));
}

export function knowledgeSummary(entries: readonly VocabularyEntry[], now: number): Record<KnowledgeFilter, number> {
  return Object.fromEntries(KNOWLEDGE_FILTERS.map((filter) => [filter, entries.filter((entry) => entryMatchesFilter(entry, filter, now)).length])) as Record<KnowledgeFilter, number>;
}
