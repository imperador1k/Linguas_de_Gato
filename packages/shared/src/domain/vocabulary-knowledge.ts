import {
  isCollectionRef,
  isLocalQuestionType,
  type FacetAttempt,
  type FacetKnowledge,
  type FacetOutcome,
  type LocalVocabularyQuestion,
  type LocalVocabularyQuestionType,
  type SenseKnowledge,
  type VocabularyEntry,
  type VocabularyFacet,
  type VocabularyPracticeSet,
  type VocabularySense,
} from '../contracts/vocabulary.js';
import { VOCABULARY_LIMITS } from '../contracts/vocabulary.js';
import type { MatchResult } from './vocabulary-answers.js';
import { REVIEW_LADDER_DAYS } from './vocabulary.js';
import { hintsUsed, matchLocalAnswer, packItemId, trainerRating } from './vocabulary-trainer.js';

/*
 * Demonstrated knowledge, separate from the saved collection.
 *
 * Saving a sense means "I want to study this". What the learner has shown is
 * recorded per sense and per facet (recognition, recall, context) as a short
 * attempt log, and each facet has its own place on the existing review
 * ladder. An answer only ever touches the facet it tested, of the sense it
 * tested: "book" the verb and "book" the noun, or recognising "eat" and
 * recalling it, never share evidence.
 *
 * The scheduling policy is the trainer's existing one (`trainerRating`),
 * applied per facet:
 * - correct without hints while the facet is due (or new) → one step up;
 * - correct with hints, a near miss, or the right word in the wrong form →
 *   no change (weak evidence; a due facet stays due);
 * - incorrect, or "I don't know" → back to step 0, due tomorrow.
 * One correct answer is never mastery: "established" needs step 2 (two unaided
 * correct answers on different days), "secure" needs step 4 (about two weeks
 * of spaced successes).
 */

const DAY = 24 * 60 * 60 * 1000;
/** From this step a facet counts as established (recognised, recalled, used in context). */
export const FACET_ESTABLISHED_STEP = 2;
/** From this step (a 16-day interval) a facet counts as secure. */
export const FACET_SECURE_STEP = 4;

export function facetForQuestion(type: LocalVocabularyQuestionType): VocabularyFacet {
  switch (type) {
    case 'recognition':
      return 'recognition';
    case 'context':
      return 'context';
    case 'spelling':
    case 'definition':
      return 'recall';
  }
}

export function outcomeFor(result: MatchResult): FacetOutcome {
  return result.verdict === 'empty' ? 'skipped' : result.verdict;
}

export function hasEvidence(knowledge: FacetKnowledge | undefined): knowledge is FacetKnowledge {
  return knowledge !== undefined && knowledge.attempts.length > 0;
}

/** Due: tested before and its review date has come. Untested facets are "new", not due. */
export function isFacetDue(knowledge: FacetKnowledge | undefined, now: number): boolean {
  return hasEvidence(knowledge) && knowledge.dueAt <= now;
}

export interface AttemptInput {
  readonly result: MatchResult;
  readonly hints: number;
  readonly expected: string;
  readonly roundId: string | null;
}

/** Adds one answer to a facet's evidence and moves its schedule (see the policy above). */
export function recordFacetAttempt(current: FacetKnowledge | undefined, input: AttemptInput, now: number): FacetKnowledge {
  const due = current === undefined || current.dueAt <= now;
  const rating = trainerRating(input.result, input.hints, due);
  const last = REVIEW_LADDER_DAYS.length - 1;
  let step = current?.step ?? 0;
  let dueAt = current?.dueAt ?? now;
  if (rating === 'good') {
    step = Math.min(last, step + 1);
    dueAt = now + (REVIEW_LADDER_DAYS[step] ?? 1) * DAY;
  } else if (rating === 'again') {
    step = 0;
    dueAt = now + DAY;
  }
  const attempt: FacetAttempt = { at: now, outcome: outcomeFor(input.result), hints: Math.min(20, input.hints), expected: input.expected.slice(0, 80), roundId: input.roundId };
  return { step, dueAt, attempts: [...(current?.attempts ?? []), attempt].slice(-VOCABULARY_LIMITS.maxFacetAttempts) };
}

export function withFacetAttempt(sense: VocabularySense, facet: VocabularyFacet, input: AttemptInput, now: number): VocabularySense {
  const knowledge: SenseKnowledge = { ...(sense.knowledge ?? {}), [facet]: recordFacetAttempt(sense.knowledge?.[facet], input, now) };
  return { ...sense, knowledge };
}

// --- Derived state ------------------------------------------------------------------------------

export type FacetStatus = 'untested' | 'difficult' | 'learning' | 'established' | 'secure';

/**
 * A deterministic reading of the evidence:
 * - untested: no answer yet;
 * - difficult: the last answer was wrong or skipped, or two of the last three
 *   answers were not fully correct (near misses and wrong forms count);
 * - learning / established / secure: by ladder step.
 */
export function facetStatus(knowledge: FacetKnowledge | undefined): FacetStatus {
  if (!hasEvidence(knowledge)) return 'untested';
  const last = knowledge.attempts.at(-1);
  const misses = knowledge.attempts.slice(-3).filter((attempt) => attempt.outcome !== 'correct').length;
  if (last?.outcome === 'incorrect' || last?.outcome === 'skipped' || misses >= 2) return 'difficult';
  if (knowledge.step >= FACET_SECURE_STEP) return 'secure';
  if (knowledge.step >= FACET_ESTABLISHED_STEP) return 'established';
  return 'learning';
}

export const isEstablished = (status: FacetStatus) => status === 'established' || status === 'secure';

/**
 * Forms the learner produced correctly in sentences without hints, and forms
 * they missed (or only got with hints) and have not produced unaided since.
 */
export function contextForms(knowledge: FacetKnowledge | undefined): { produced: string[]; missed: string[] } {
  const produced = new Set<string>();
  const missed = new Set<string>();
  for (const attempt of knowledge?.attempts ?? []) {
    const form = attempt.expected.toLowerCase();
    if (attempt.outcome === 'correct' && attempt.hints === 0) {
      produced.add(form);
      missed.delete(form);
    } else missed.add(form);
  }
  return { produced: [...produced], missed: [...missed].filter((form) => !produced.has(form)) };
}

/** At least one unaided correct answer in a sentence. */
export function hasUsedInContext(sense: Pick<VocabularySense, 'knowledge'>): boolean {
  return (sense.knowledge?.context?.attempts ?? []).some((attempt) => attempt.outcome === 'correct' && attempt.hints === 0);
}

/** Recognised (established) but not yet recalled (recall not established): the receptive/productive gap. */
export function recognisesButCannotRecall(sense: Pick<VocabularySense, 'knowledge'>): boolean {
  return isEstablished(facetStatus(sense.knowledge?.recognition)) && !isEstablished(facetStatus(sense.knowledge?.recall));
}

export interface DueFacet {
  readonly entry: VocabularyEntry;
  readonly sense: VocabularySense;
  readonly facet: VocabularyFacet;
  readonly dueAt: number;
}

/** Every due sense × facet, oldest first. */
export function dueFacets(entries: readonly VocabularyEntry[], now: number): DueFacet[] {
  const due: DueFacet[] = [];
  for (const entry of entries) {
    for (const sense of entry.senses) {
      for (const [facet, knowledge] of Object.entries(sense.knowledge ?? {}) as Array<[VocabularyFacet, FacetKnowledge | undefined]>) {
        if (knowledge && isFacetDue(knowledge, now)) due.push({ entry, sense, facet, dueAt: knowledge.dueAt });
      }
    }
  }
  return due.sort((a, b) => a.dueAt - b.dueAt);
}

/** Entries with at least one due facet, in order of their oldest due facet. */
export function entriesDueForPractice(entries: readonly VocabularyEntry[], now: number): VocabularyEntry[] {
  const seen = new Set<string>();
  return dueFacets(entries, now).flatMap(({ entry }) => (seen.has(entry.id) ? [] : (seen.add(entry.id), [entry])));
}

/** The earliest future due date of any tested facet, or null. */
export function nextFacetDueAt(entries: readonly VocabularyEntry[], now: number): number | null {
  let next: number | null = null;
  for (const entry of entries) {
    for (const sense of entry.senses) {
      for (const knowledge of Object.values(sense.knowledge ?? {})) {
        if (hasEvidence(knowledge) && knowledge.dueAt > now && (next === null || knowledge.dueAt < next)) next = knowledge.dueAt;
      }
    }
  }
  return next;
}

// --- Earlier trainer rounds (before per-facet evidence) ----------------------------------------

/**
 * Rebuilds per-facet evidence from checked trainer rounds, in the order they
 * were checked, with the same policy a new round uses. Rounds before V1 only
 * trained pack senses, so the result is keyed by `packItemId`.
 */
export function replayTrainerRounds(sets: readonly VocabularyPracticeSet[]): Map<string, SenseKnowledge> {
  const byItem = new Map<string, SenseKnowledge>();
  const checked = sets.filter((set) => set.checkedAt !== null).sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0));
  for (const set of checked) {
    const at = set.checkedAt as number;
    const answers = new Map(set.answers.map((answer) => [answer.questionId, answer]));
    for (const question of set.questions) {
      if (!isLocalQuestionType(question.type)) continue;
      const local = question as LocalVocabularyQuestion;
      if (isCollectionRef(local.ref)) continue;
      const answer = answers.get(local.id);
      const result = matchLocalAnswer(local, answer);
      if (!result) continue;
      const item = packItemId(local.ref.packId, local.ref.entryId, local.ref.senseId);
      const facet = facetForQuestion(local.type);
      const current = byItem.get(item) ?? {};
      byItem.set(item, { ...current, [facet]: recordFacetAttempt(current[facet], { result, hints: hintsUsed(answer), expected: local.answer, roundId: set.id }, at) });
    }
  }
  return byItem;
}

/**
 * Library senses saved before V1 have no `knowledge` yet; their evidence is
 * rebuilt from the rounds that trained them (an empty object marks a sense
 * as migrated with no evidence, so this runs once per sense). Senses the
 * learner saved themselves were never trained per facet and simply start
 * untested. Nothing is inflated and the old per-expression schedule
 * (`entry.review`) is left exactly as it was. Returns only changed entries.
 */
export function migrateLegacyKnowledge(entries: readonly VocabularyEntry[], sets: readonly VocabularyPracticeSet[]): VocabularyEntry[] {
  const pending = entries.filter((entry) => entry.senses.some(needsMigration));
  if (pending.length === 0) return [];
  const replayed = replayTrainerRounds(sets);
  return pending.map((entry) => ({
    ...entry,
    senses: entry.senses.map((sense) =>
      needsMigration(sense) && sense.source.kind === 'library' ? { ...sense, knowledge: replayed.get(packItemId(sense.source.packId, sense.source.entryId, sense.source.senseId)) ?? {} } : sense,
    ),
  }));
}

export function needsMigration(sense: Pick<VocabularySense, 'source' | 'knowledge'>): boolean {
  return sense.source.kind === 'library' && sense.knowledge === undefined;
}
