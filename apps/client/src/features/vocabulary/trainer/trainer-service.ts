import {
  LOCAL_PRACTICE_MODEL,
  VOCABULARY_RECORD_VERSION,
  adoptPackSense,
  buildCollectionRound,
  buildLocalRound,
  checkVocabularySet,
  facetForQuestion,
  facetStatus,
  hintsUsed,
  isCollectionRef,
  isFacetDue,
  isLocalQuestionType,
  matchLocalAnswer,
  migrateLegacyKnowledge,
  trainerRating,
  vocabularyKey,
  withFacetAttempt,
  withVocabularyAnswer,
  type AvailableTrainerMode,
  type CollectionExercise,
  type LocalVocabularyQuestion,
  type PackEntry,
  type PackFilters,
  type PackSense,
  type TrainingFocus,
  type TrainingPriority,
  type VocabularyAnswer,
  type VocabularyEntry,
  type VocabularyPack,
  type VocabularyPracticeSet,
  type VocabularySense,
} from '@ldg/shared';
import type { VocabularyRepository } from '../storage/vocabulary-repository';

/*
 * The Vocabulary Trainer's persistence, on the existing stores:
 * - a round is a `VocabularyPracticeSet` with `model: 'local'` (no AI), built
 *   from a vocabulary pack or from the learner's own collection;
 * - checking it records each answer as evidence on the one sense and facet it
 *   tested (`withFacetAttempt`), which also moves that facet's schedule. A
 *   pack sense first joins the collection (as before), so its evidence has a
 *   home. The per-expression `entry.review` belongs to the self-rated review
 *   and is not touched.
 * Nothing happens to the collection until a round is checked, so an
 * abandoned round leaves no trace beyond the round itself.
 */

export function localQuestions(set: VocabularyPracticeSet): LocalVocabularyQuestion[] {
  return set.questions.filter((question): question is LocalVocabularyQuestion => isLocalQuestionType(question.type));
}

export function isLocalSet(set: Pick<VocabularyPracticeSet, 'model'>): boolean {
  return set.model === LOCAL_PRACTICE_MODEL;
}

/** Whether a round was built from a pack (rather than the learner's collection). */
export function packIdOf(set: VocabularyPracticeSet): string | null {
  for (const question of localQuestions(set)) if (!isCollectionRef(question.ref)) return question.ref.packId;
  return null;
}

const isPackSense = (sense: VocabularySense, packId: string, entryId: string, senseId: string) =>
  sense.source.kind === 'library' && sense.source.packId === packId && sense.source.entryId === entryId && sense.source.senseId === senseId;

/**
 * Attention order for pack words, from the evidence of the facet the mode
 * trains: difficult, due, never trained, then the rest.
 */
export function packPriority(entries: readonly VocabularyEntry[], packId: string, mode: AvailableTrainerMode, now: number): (entry: PackEntry, sense: PackSense) => TrainingPriority {
  const facet = facetForQuestion(mode);
  const senses = new Map<string, VocabularySense>();
  for (const entry of entries) for (const sense of entry.senses) if (sense.source.kind === 'library' && sense.source.packId === packId) senses.set(`${sense.source.entryId}/${sense.source.senseId}`, sense);
  return (entry, packSense) => {
    const knowledge = senses.get(`${entry.id}/${packSense.id}`)?.knowledge?.[facet];
    const status = facetStatus(knowledge);
    if (status === 'difficult') return 0;
    if (isFacetDue(knowledge, now)) return 1;
    if (status === 'untested') return 2;
    return 3;
  };
}

/** How many entries of a pack the learner has trained at least once (any facet). */
export function trainedPackEntries(entries: readonly VocabularyEntry[], packId: string): number {
  const trained = new Set<string>();
  for (const entry of entries) {
    for (const sense of entry.senses) {
      if (sense.source.kind === 'library' && sense.source.packId === packId && Object.values(sense.knowledge ?? {}).some((knowledge) => (knowledge?.attempts.length ?? 0) > 0)) trained.add(sense.source.entryId);
    }
  }
  return trained.size;
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
  /** The learner's collection, to put difficult and due words first. */
  readonly collection: readonly VocabularyEntry[] | null;
  readonly now?: number;
  readonly seed?: string;
}

/** Builds and saves a new local round from a pack; null when no entry has what the mode needs. */
export async function startRound(repository: VocabularyRepository, options: StartRoundOptions): Promise<VocabularyPracticeSet | null> {
  const now = options.now ?? Date.now();
  const questions = buildLocalRound({
    pack: options.pack,
    filters: options.filters,
    mode: options.mode,
    count: options.count,
    seed: options.seed ?? crypto.randomUUID(),
    now,
    ...(options.collection ? { priority: packPriority(options.collection, options.pack.id, options.mode, now) } : {}),
  });
  if (questions.length === 0) return null;
  const set = newLocalSet(questions, now);
  await repository.practiceSets.put(set);
  return set;
}

export interface StartCollectionRoundOptions {
  readonly entries: readonly VocabularyEntry[];
  readonly exercise: CollectionExercise;
  readonly focus: TrainingFocus;
  readonly count: number;
  readonly now?: number;
  readonly seed?: string;
}

/** Builds and saves a round from the learner's own collection; null when nothing matches. */
export async function startCollectionRound(repository: VocabularyRepository, options: StartCollectionRoundOptions): Promise<VocabularyPracticeSet | null> {
  const now = options.now ?? Date.now();
  const questions = buildCollectionRound({ entries: options.entries, exercise: options.exercise, focus: options.focus, count: options.count, seed: options.seed ?? crypto.randomUUID(), now });
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
  /** Collection entries created or given a new sense by this round (pack rounds). */
  readonly added: number;
  /** Facets whose place on the review ladder changed. */
  readonly rescheduled: number;
}

/**
 * Checks a finished round: each answer becomes evidence on its sense and
 * facet, and only that facet's schedule moves (`trainerRating` policy).
 *
 * All changes are computed first and then written in one transaction
 * together with the checked round (`commitRound`), so an interruption leaves
 * either nothing or everything, and retrying after a failure starts from a
 * clean state. Idempotent: a round that is already checked (here or in
 * another tab) is returned unchanged and no evidence is recorded twice.
 * Library senses from before V1 get their earlier evidence first
 * (`migrateLegacyKnowledge`), so this round builds on it.
 */
export async function finishRound(repository: VocabularyRepository, setId: string, pack: VocabularyPack | null, now = Date.now()): Promise<FinishOutcome | null> {
  const set = await repository.practiceSets.get(setId);
  if (!set) return null;
  if (set.checkedAt !== null) return { set, added: 0, rescheduled: 0 };
  const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
  const stored = await repository.entries.list();
  const migrated = new Map(migrateLegacyKnowledge(stored, await repository.practiceSets.list()).map((entry) => [entry.id, entry]));
  // Working copies: two questions on the same entry build on each other.
  const working = new Map<string, VocabularyEntry>(stored.map((entry) => [entry.id, migrated.get(entry.id) ?? entry]));
  const changed = new Set<string>(migrated.keys());
  let added = 0;
  let rescheduled = 0;

  const findByKey = (key: string) => [...working.values()].find((entry) => entry.key === key) ?? null;

  for (const question of localQuestions(set)) {
    const answer = answers.get(question.id);
    const result = matchLocalAnswer(question, answer);
    if (!result) continue;
    let entry: VocabularyEntry | null = null;
    let senseId: string | null = null;
    if (isCollectionRef(question.ref)) {
      // A word deleted since the round started has nowhere to keep evidence; the round is still checked.
      entry = working.get(question.ref.entryId) ?? null;
      const ref = question.ref;
      senseId = entry?.senses.find((sense) => sense.id === ref.senseId)?.id ?? null;
    } else if (pack) {
      // A pack that is no longer available (e.g. removed in a later version) can't create entries.
      const ref = question.ref;
      const packEntry = pack.entries.find((candidate) => candidate.id === ref.entryId);
      const packSense = packEntry?.senses.find((candidate) => candidate.id === ref.senseId);
      if (!packEntry || !packSense) continue;
      const adopted = adoptPackSense(findByKey(vocabularyKey(packEntry.lemma)), pack, packEntry, packSense, now, { entryId: crypto.randomUUID(), senseId: crypto.randomUUID() });
      if (adopted.outcome !== 'already_saved') added += 1;
      entry = adopted.entry;
      senseId = entry.senses.find((sense) => isPackSense(sense, pack.id, packEntry.id, packSense.id))?.id ?? null;
    }
    if (!entry || !senseId) continue;
    const facet = facetForQuestion(question.type);
    const target = senseId;
    const before = entry.senses.find((sense) => sense.id === target)?.knowledge?.[facet];
    const hints = hintsUsed(answer);
    const next: VocabularyEntry = {
      ...entry,
      senses: entry.senses.map((sense) => (sense.id === target ? withFacetAttempt(sense, facet, { result, hints, expected: question.answer, roundId: set.id }, now) : sense)),
      updatedAt: now,
    };
    // Same rule `withFacetAttempt` applies: only a rating moves the schedule.
    if (trainerRating(result, hints, before === undefined || before.dueAt <= now) !== null) rescheduled += 1;
    working.set(next.id, next);
    changed.add(next.id);
  }

  const checked = checkVocabularySet(set, now);
  const committed = await repository.commitRound(
    [...changed].map((id) => working.get(id)).filter((entry): entry is VocabularyEntry => entry !== undefined),
    checked,
  );
  if (!committed) {
    // Checked meanwhile (another tab, a doubled click): report the stored result and change nothing.
    const current = await repository.practiceSets.get(setId);
    return current ? { set: current, added: 0, rescheduled: 0 } : null;
  }
  return { set: checked, added, rescheduled };
}

/**
 * Gives library senses saved before V1 their per-facet evidence, rebuilt from
 * the rounds that trained them. Idempotent and safe to run on every visit:
 * each entry is re-read and only still-unmigrated senses change.
 */
export async function migrateTrainerEvidence(repository: VocabularyRepository): Promise<number> {
  const entries = await repository.entries.list();
  if (!entries.some((entry) => entry.senses.some((sense) => sense.source.kind === 'library' && sense.knowledge === undefined))) return 0;
  const sets = await repository.practiceSets.list();
  const pending = migrateLegacyKnowledge(entries, sets);
  for (const entry of pending) await repository.entries.update(entry.id, (current) => migrateLegacyKnowledge([current], sets)[0] ?? current);
  return pending.length;
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
