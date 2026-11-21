import {
  LOCAL_PRACTICE_MODEL,
  VOCABULARY_RECORD_VERSION,
  adoptPackSense,
  buildLocalRound,
  checkVocabularySet,
  hintsUsed,
  isDueForTrainer,
  isLocalQuestionType,
  matchLocalAnswer,
  scheduleReview,
  trainerRating,
  vocabularyKey,
  withVocabularyAnswer,
  type AvailableTrainerMode,
  type LocalVocabularyQuestion,
  type PackFilters,
  type ProgressLookup,
  type ReviewState,
  type VocabularyAnswer,
  type VocabularyEntry,
  type VocabularyPack,
  type VocabularyPracticeSet,
} from '@ldg/shared';
import { VOCABULARY_BY_KEY } from '@/lib/storage/app-database';
import type { VocabularyRepository } from '../storage/vocabulary-repository';

/*
 * The Vocabulary Trainer's persistence, on the existing stores:
 * - a round is a `VocabularyPracticeSet` with `model: 'local'` (no AI);
 * - checking it adds each practised word to the collection (the same
 *   `VocabularyEntry` the Reading flow uses) and moves its place on the
 *   existing review ladder, marked `via: 'trainer'`.
 * Nothing happens to the collection until a round is checked, so an
 * abandoned round leaves no trace beyond the round itself.
 */

export function localQuestions(set: VocabularyPracticeSet): LocalVocabularyQuestion[] {
  return set.questions.filter((question): question is LocalVocabularyQuestion => isLocalQuestionType(question.type));
}

export function isLocalSet(set: Pick<VocabularyPracticeSet, 'model'>): boolean {
  return set.model === LOCAL_PRACTICE_MODEL;
}

/** Review state of the collection entries already holding words from a pack, for prioritising due and difficult ones. */
export function progressFrom(entries: readonly VocabularyEntry[], packId: string): ProgressLookup {
  const byPackEntry = new Map<string, ReviewState>();
  for (const entry of entries) {
    for (const sense of entry.senses) if (sense.source.kind === 'library' && sense.source.packId === packId) byPackEntry.set(sense.source.entryId, entry.review);
  }
  return (packEntry) => byPackEntry.get(packEntry.id) ?? null;
}

export function newLocalSet(questions: readonly LocalVocabularyQuestion[], now: number, id: string = crypto.randomUUID()): VocabularyPracticeSet {
  const types = [...new Set(questions.map((question) => question.type))];
  return {
    id,
    version: VOCABULARY_RECORD_VERSION,
    entryIds: questions.map((question) => question.itemId),
    types,
    questions: [...questions],
    shuffles: {},
    discarded: 0,
    model: LOCAL_PRACTICE_MODEL,
    answers: [],
    reviews: [],
    checkedAt: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface StartRoundOptions {
  readonly pack: VocabularyPack;
  readonly filters: PackFilters;
  readonly mode: AvailableTrainerMode;
  readonly count: number;
  /** The learner's collection, to put due and difficult words first. */
  readonly collection: readonly VocabularyEntry[] | null;
  readonly now?: number;
  readonly seed?: string;
}

/** Builds and saves a new local round; null when no entry has what the mode needs. */
export async function startRound(repository: VocabularyRepository, options: StartRoundOptions): Promise<VocabularyPracticeSet | null> {
  const now = options.now ?? Date.now();
  const questions = buildLocalRound({
    pack: options.pack,
    filters: options.filters,
    mode: options.mode,
    count: options.count,
    seed: options.seed ?? crypto.randomUUID(),
    now,
    ...(options.collection ? { progress: progressFrom(options.collection, options.pack.id) } : {}),
  });
  if (questions.length === 0) return null;
  const set = newLocalSet(questions, now);
  await repository.practiceSets.put(set);
  return set;
}

/** Saves one answer (answers are final once given: the feedback has been shown). */
export async function saveAnswer(repository: VocabularyRepository, setId: string, answer: VocabularyAnswer, now = Date.now()): Promise<VocabularyPracticeSet | null> {
  return repository.practiceSets.update(setId, (current) => (current.answers.some((existing) => existing.questionId === answer.questionId) ? current : withVocabularyAnswer(current, answer, now)));
}

export interface FinishOutcome {
  readonly set: VocabularyPracticeSet;
  /** Collection entries created or given a new sense by this round. */
  readonly added: number;
  /** Entries whose place on the review ladder changed. */
  readonly rescheduled: number;
}

/**
 * Checks a finished round: every answered word joins the collection (once)
 * and its review schedule follows `trainerRating`.
 *
 * All changes are computed first and then written in one transaction
 * together with the checked round (`commitRound`), so an interruption leaves
 * either nothing or everything, and retrying after a failure starts from a
 * clean state. Idempotent: a round that is already checked (here or in
 * another tab) is returned unchanged and no rating is applied twice.
 */
export async function finishRound(repository: VocabularyRepository, setId: string, pack: VocabularyPack | null, now = Date.now()): Promise<FinishOutcome | null> {
  const set = await repository.practiceSets.get(setId);
  if (!set) return null;
  if (set.checkedAt !== null) return { set, added: 0, rescheduled: 0 };
  const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  // Working copies by collection key: two questions on the same word build on each other.
  const working = new Map<string, VocabularyEntry | null>();
  const changed = new Map<string, VocabularyEntry>();
  let added = 0;
  let rescheduled = 0;

  // A pack that is no longer available (e.g. removed in a later version) can't create entries; the round is still checked.
  if (pack) {
    for (const question of localQuestions(set)) {
      const answer = answers.get(question.id);
      if (!answer) continue;
      const packEntry = pack.entries.find((candidate) => candidate.id === question.ref.entryId);
      const sense = packEntry?.senses.find((candidate) => candidate.id === question.ref.senseId);
      if (!packEntry || !sense) continue;
      const key = vocabularyKey(packEntry.lemma);
      if (!working.has(key)) {
        const [stored] = await repository.entries.listBy(VOCABULARY_BY_KEY, key);
        working.set(key, stored ?? null);
      }
      const existing = working.get(key) ?? null;
      const adopted = adoptPackSense(existing, pack, packEntry, sense, now, { entryId: crypto.randomUUID(), senseId: crypto.randomUUID() });
      if (adopted.outcome !== 'already_saved') added += 1;
      const rating = trainerRating(matchLocalAnswer(question, answer), hintsUsed(answer), isDueForTrainer(existing, now));
      const next = rating ? { ...adopted.entry, review: scheduleReview(adopted.entry.review, rating, now, 'trainer'), updatedAt: now } : adopted.entry;
      if (rating) rescheduled += 1;
      working.set(key, next);
      if (next !== existing) changed.set(next.id, next);
    }
  }

  const checked = checkVocabularySet(set, now);
  const committed = await repository.commitRound([...changed.values()], checked);
  if (!committed) {
    // Checked meanwhile (another tab, a doubled click): report the stored result and change nothing.
    const current = await repository.practiceSets.get(setId);
    return current ? { set: current, added: 0, rescheduled: 0 } : null;
  }
  return { set: checked, added, rescheduled };
}

/** A new round from the questions that went wrong (or needed hints) in a checked round. */
export async function retryMissed(repository: VocabularyRepository, set: VocabularyPracticeSet, now = Date.now()): Promise<VocabularyPracticeSet | null> {
  const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const missed = localQuestions(set).filter((question) => {
    const answer = answers.get(question.id);
    return matchLocalAnswer(question, answer)?.verdict !== 'correct' || hintsUsed(answer) > 0;
  });
  if (missed.length === 0) return null;
  const retry = newLocalSet(
    missed.map((question, index) => ({ ...question, id: `q${index + 1}` })),
    now,
  );
  await repository.practiceSets.put(retry);
  return retry;
}
