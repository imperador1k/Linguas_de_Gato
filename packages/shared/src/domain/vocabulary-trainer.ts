import type { PackEntry, PackSense, PartOfSpeech, AvailableTrainerMode, VocabularyPack, VocabularyTopic } from '../contracts/vocabulary-pack.js';
import { GAP_MARKER } from '../contracts/vocabulary-pack.js';
import {
  VOCABULARY_RECORD_VERSION,
  type LocalVocabularyQuestion,
  type ReviewRating,
  type ReviewState,
  type TrainerHint,
  type VocabularyAnswer,
  type VocabularyEntry,
  type VocabularySense,
} from '../contracts/vocabulary.js';
import type { CefrLevel } from './languages.js';
import { matchVocabularyAnswer, type MatchResult } from './vocabulary-answers.js';
import { initialReviewState, isDue, seededShuffle, vocabularyKey } from './vocabulary.js';

/*
 * Vocabulary Trainer logic: which pack entries suit which mode, filtering,
 * a deterministic round builder, progressive hints, and how a checked round
 * feeds the existing collection and review ladder (no second scheduler).
 */

// --- Mode availability ------------------------------------------------------------------------

export function senseSupports(sense: PackSense, mode: AvailableTrainerMode): boolean {
  switch (mode) {
    case 'spelling':
      return (sense.translations['pt-PT']?.length ?? 0) > 0;
    case 'definition':
      return sense.definition !== null;
    case 'context':
      return sense.contexts.length > 0;
  }
}

export function entryModes(entry: PackEntry): AvailableTrainerMode[] {
  return (['spelling', 'context', 'definition'] as const).filter((mode) => entry.senses.some((sense) => senseSupports(sense, mode)));
}

// --- Filters --------------------------------------------------------------------------------

export interface PackFilters {
  /** A level, `unrated` for entries without CEFR metadata, or null for any. */
  readonly cefr: CefrLevel | 'unrated' | null;
  readonly topic: VocabularyTopic | null;
  readonly partOfSpeech: PartOfSpeech | null;
  readonly mode: AvailableTrainerMode | null;
  /** Matches the lemma, its forms and variants, or a Portuguese translation. */
  readonly query: string;
}

export const NO_PACK_FILTERS: PackFilters = { cefr: null, topic: null, partOfSpeech: null, mode: null, query: '' };

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();

export function filterPackEntries(pack: Pick<VocabularyPack, 'entries'>, filters: PackFilters): PackEntry[] {
  const needle = fold(filters.query);
  return pack.entries.filter((entry) => {
    if (filters.cefr === 'unrated' ? entry.cefr !== null : filters.cefr !== null && entry.cefr?.level !== filters.cefr) return false;
    if (filters.topic && !entry.topics.includes(filters.topic)) return false;
    if (filters.partOfSpeech && entry.partOfSpeech !== filters.partOfSpeech) return false;
    if (filters.mode && !entry.senses.some((sense) => senseSupports(sense, filters.mode as AvailableTrainerMode))) return false;
    if (!needle) return true;
    const haystack = [entry.lemma, ...Object.values(entry.forms), ...entry.variants, ...entry.senses.flatMap((sense) => sense.translations['pt-PT'] ?? [])];
    return haystack.some((value) => fold(value).includes(needle));
  });
}

// --- Round building ---------------------------------------------------------------------------

/** The `itemId` of a local question: which pack sense it practises. */
export function packItemId(packId: string, entryId: string, senseId: string): string {
  return `${packId}/${entryId}/${senseId}`;
}

/** Review state of the collection entry a pack entry has become, if it has been trained before. */
export type ProgressLookup = (entry: PackEntry) => ReviewState | null;

export interface RoundOptions {
  readonly pack: VocabularyPack;
  readonly filters: PackFilters;
  readonly mode: AvailableTrainerMode;
  readonly count: number;
  /** Same seed, same pack and options: the same round. */
  readonly seed: string;
  readonly now: number;
  /** When given, due and difficult words come first, then new ones, then the rest. */
  readonly progress?: ProgressLookup;
}

/** A word is difficult when its most recent rating (review or trainer) was "again". */
export function isDifficult(state: ReviewState | null): boolean {
  return state !== null && state.history.at(-1)?.rating === 'again';
}

function priorityOf(state: ReviewState | null, now: number): number {
  if (state === null) return 2; // never trained: new material after what needs attention
  if (isDifficult(state)) return 0;
  if (state.dueAt <= now) return 1;
  return 3;
}

function otherForms(entry: PackEntry, answer: string, accepted: readonly string[]): string[] {
  const listed = new Set([answer, ...accepted].map((value) => value.toLowerCase()));
  const all = [entry.lemma, ...Object.values(entry.forms)];
  return [...new Set(all)].filter((form) => !listed.has(form.toLowerCase())).slice(0, 16);
}

function explanationFor(entry: PackEntry, sense: PackSense): string {
  const translations = sense.translations['pt-PT'];
  const parts = [translations ? `PT: ${translations.join(', ')}` : null, sense.definition].filter(Boolean);
  return (parts.length ? parts.join(' — ') : entry.lemma).slice(0, 500);
}

function questionFor(pack: VocabularyPack, entry: PackEntry, sense: PackSense, mode: AvailableTrainerMode, index: number, seed: string): LocalVocabularyQuestion {
  const base = {
    id: `q${index + 1}`,
    itemId: packItemId(pack.id, entry.id, sense.id),
    explanation: explanationFor(entry, sense),
    language: pack.language,
    lemma: entry.lemma,
  };
  const ref = { packId: pack.id, packVersion: pack.version, entryId: entry.id, senseId: sense.id };
  if (mode === 'context') {
    const order = seededShuffle(sense.contexts.length, `${seed}:${entry.id}:${sense.id}`);
    const example = sense.contexts[order[0] ?? 0] ?? sense.contexts[0];
    if (!example) throw new Error(`Sense ${entry.id}/${sense.id} has no context examples.`);
    return {
      ...base,
      type: 'context',
      prompt: example.sentence,
      clue: example.clue ?? sense.definition,
      answer: example.answer,
      accepted: example.accepted.slice(0, 12),
      forms: otherForms(entry, example.answer, example.accepted),
      ref: { ...ref, contextId: example.id },
    };
  }
  const accepted = [...entry.variants, ...sense.accepted].slice(0, 12);
  const prompt = mode === 'spelling' ? (sense.translations['pt-PT'] ?? []).join(' / ') : (sense.definition ?? '');
  return { ...base, type: mode, prompt, answer: entry.lemma, accepted, forms: otherForms(entry, entry.lemma, accepted), ref: { ...ref, contextId: null } };
}

/**
 * Builds a round locally: only entries whose data supports the mode, at most
 * one question per entry (so one question never gives away another), in a
 * seeded order, optionally putting difficult and due words first.
 */
export function buildLocalRound({ pack, filters, mode, count, seed, now, progress }: RoundOptions): LocalVocabularyQuestion[] {
  const candidates = filterPackEntries(pack, filters).flatMap((entry) => {
    const senses = entry.senses.filter((sense) => senseSupports(sense, mode));
    if (senses.length === 0) return [];
    const sense = senses[seededShuffle(senses.length, `${seed}:${entry.id}`)[0] ?? 0] ?? senses[0];
    return sense ? [{ entry, sense }] : [];
  });
  const order = seededShuffle(candidates.length, seed);
  const shuffled = order.map((index) => candidates[index]).filter((candidate): candidate is (typeof candidates)[number] => candidate !== undefined);
  const ranked = progress ? shuffled.map((candidate, position) => ({ candidate, position, priority: priorityOf(progress(candidate.entry), now) })).sort((a, b) => a.priority - b.priority || a.position - b.position).map(({ candidate }) => candidate) : shuffled;
  return ranked.slice(0, Math.max(0, count)).map(({ entry, sense }, index) => questionFor(pack, entry, sense, mode, index, seed));
}

/** Builds a new round from questions of an earlier one (e.g. the ones that went wrong), renumbered. */
export function retryQuestions(questions: readonly LocalVocabularyQuestion[]): LocalVocabularyQuestion[] {
  return questions.map((question, index) => ({ ...question, id: `q${index + 1}` }));
}

// --- Hints ---------------------------------------------------------------------------------

const isLetter = (char: string) => /[\p{L}\p{N}]/u.test(char);

/** The next hint to offer, or null when no more can be given without giving the whole answer away. */
export function nextHint(answer: string, hints: readonly TrainerHint[]): TrainerHint | null {
  if (!hints.includes('length')) return 'length';
  if (!hints.includes('first_letter')) return 'first_letter';
  const letters = Array.from(answer).filter(isLetter).length;
  const revealed = 1 + hints.filter((hint) => hint === 'letter').length;
  return revealed < letters - 1 ? 'letter' : null;
}

/**
 * The answer as shown after hints: letters as underscores, spaces, hyphens
 * and apostrophes kept, and revealed letters from the left. Null before the
 * first hint.
 */
export function hintMask(answer: string, hints: readonly TrainerHint[]): string | null {
  if (hints.length === 0) return null;
  const reveal = (hints.includes('first_letter') ? 1 : 0) + hints.filter((hint) => hint === 'letter').length;
  let shown = 0;
  // Letters are spaced out so each blank is countable; words are separated by a wider gap.
  return answer
    .trim()
    .split(/\s+/)
    .map((part) =>
      Array.from(part)
        .map((char) => {
          if (!isLetter(char)) return char;
          shown += 1;
          return shown <= reveal ? char : '_';
        })
        .join(' '),
    )
    .join('   ');
}

// --- Evaluation and evidence ----------------------------------------------------------------

export function matchLocalAnswer(question: LocalVocabularyQuestion, answer: VocabularyAnswer | undefined): MatchResult | null {
  if (!answer || answer.kind !== 'typed') return null;
  return matchVocabularyAnswer(answer.text, { answer: question.answer, accepted: question.accepted, forms: question.forms }, question.language);
}

export function hintsUsed(answer: VocabularyAnswer | undefined): number {
  return answer?.kind === 'typed' ? answer.hints.length : 0;
}

/**
 * How a trainer answer moves the existing review ladder (`scheduleReview`):
 * - correct without hints, while the word is due → "good" (one step up);
 *   correct when not due changes nothing, so repeating rounds can't race ahead;
 * - correct with hints, or almost (a typo, accents) → no change: weak evidence,
 *   the word stays where it is (and due words stay due);
 * - the right word in the wrong form → no change: the word was remembered;
 * - incorrect, or "I don't know" (an empty answer) → "again" (back to the start, due tomorrow).
 * No answer at all (null) changes nothing.
 */
export function trainerRating(result: MatchResult | null, hints: number, due: boolean): ReviewRating | null {
  if (!result) return null;
  if (result.verdict === 'incorrect' || result.verdict === 'empty') return 'again';
  if (result.verdict === 'correct' && hints === 0 && due) return 'good';
  return null;
}

// --- Adding a pack sense to the collection --------------------------------------------------

function senseFromPack(pack: VocabularyPack, entry: PackEntry, sense: PackSense, now: number, id: string): VocabularySense {
  const translations = sense.translations['pt-PT'] ?? [];
  const meaning = sense.definition ?? translations.join(', ');
  const examples = sense.contexts.map((example) => example.sentence.replace(GAP_MARKER, example.answer)).slice(0, 4);
  const source = pack.sources.find((candidate) => candidate.id === entry.cefr?.source);
  return {
    id,
    contextualMeaning: meaning.slice(0, 400),
    dictionaryMeaning: meaning.slice(0, 400),
    partOfSpeech: entry.partOfSpeech,
    context: examples[0] ?? '',
    source: { kind: 'library', packId: pack.id, packVersion: pack.version, entryId: entry.id, senseId: sense.id },
    examples,
    collocations: [],
    synonyms: sense.accepted.slice(0, 8),
    antonyms: [],
    register: sense.register,
    patterns: [],
    cefrEstimate: null,
    cefr: entry.cefr ? { level: entry.cefr.level, source: (source?.name ?? entry.cefr.source).slice(0, 120), certainty: entry.cefr.certainty } : null,
    portugueseExplanation: translations.length ? translations.join(', ').slice(0, 600) : null,
    addedAt: now,
  };
}

const isPackSense = (sense: VocabularySense, packId: string, entryId: string, senseId: string) =>
  sense.source.kind === 'library' && sense.source.packId === packId && sense.source.entryId === entryId && sense.source.senseId === senseId;

/**
 * The collection entry for a trained pack sense: an existing entry for the
 * same lemma gains the sense (once); otherwise a new entry is created. Same
 * collection, same review state as words saved from Reading.
 */
export function adoptPackSense(
  existing: VocabularyEntry | null,
  pack: VocabularyPack,
  entry: PackEntry,
  sense: PackSense,
  now: number,
  ids: { readonly entryId: string; readonly senseId: string },
): { entry: VocabularyEntry; outcome: 'created' | 'added_sense' | 'already_saved' } {
  const created = senseFromPack(pack, entry, sense, now, ids.senseId);
  if (!existing) {
    return {
      outcome: 'created',
      entry: {
        id: ids.entryId,
        version: VOCABULARY_RECORD_VERSION,
        language: pack.language,
        expression: entry.lemma,
        lemma: entry.lemma,
        key: vocabularyKey(entry.lemma),
        kind: entry.kind,
        senses: [created],
        review: initialReviewState(now),
        createdAt: now,
        updatedAt: now,
      },
    };
  }
  if (existing.senses.some((candidate) => isPackSense(candidate, pack.id, entry.id, sense.id)) || existing.senses.length >= 10) return { entry: existing, outcome: 'already_saved' };
  return { outcome: 'added_sense', entry: { ...existing, senses: [...existing.senses, created], updatedAt: now } };
}

/** Whether a collection entry already holds a given pack entry (any of its senses). */
export function holdsPackEntry(entry: VocabularyEntry, packId: string, packEntryId: string): boolean {
  return entry.senses.some((sense) => sense.source.kind === 'library' && sense.source.packId === packId && sense.source.entryId === packEntryId);
}

/**
 * Whether the learner saved this sense themselves (Reading, manual). Senses a
 * trainer round added from a pack are not "saved": the checked round is the
 * activity, and counting its words again would inflate Progress and Today.
 */
export function isSavedSense(sense: Pick<VocabularySense, 'source'>): boolean {
  return sense.source.kind !== 'library';
}

/**
 * When the learner saved this expression themselves, or null if only trainer
 * rounds added it. Entries without library senses keep using `createdAt`, so
 * metrics for existing data are unchanged.
 */
export function entrySavedAt(entry: Pick<VocabularyEntry, 'createdAt' | 'senses'>): number | null {
  const saved = entry.senses.filter(isSavedSense);
  if (saved.length === 0) return null;
  if (saved.length === entry.senses.length) return entry.createdAt;
  return Math.min(...saved.map((sense) => sense.addedAt));
}

/** Whether the collection entry behind a trainer question is due (new material counts as due). */
export function isDueForTrainer(entry: VocabularyEntry | null, now: number): boolean {
  return entry === null || isDue(entry, now);
}
