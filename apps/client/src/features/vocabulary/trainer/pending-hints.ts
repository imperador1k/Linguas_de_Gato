import { nextHint, type TrainerHint } from '@ldg/shared';

/*
 * Hints taken on a question that has not been answered yet. The answer record
 * stores its hints only once it is submitted, so without this a learner who
 * takes hints, leaves and comes back would answer "without hints" and could
 * move a word up the review ladder.
 *
 * Kept in localStorage (like the other per-viewer state in the app), keyed by
 * round, so it survives a reload, a closed tab and Today's "Continue" days
 * later. It is a convenience layer: when storage is unavailable or the stored
 * value is damaged, the trainer falls back to "no pending hints" without
 * failing. Nothing here touches IndexedDB or the backup format.
 */

export type HintStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const PREFIX = 'ldg.trainer.pendingHints.';
/** Rounds untouched for this long are forgotten (abandoned or deleted rounds). */
export const PENDING_HINTS_MAX_AGE = 30 * 86_400_000;

interface StoredRound {
  readonly at: number;
  readonly questions: Record<string, readonly string[]>;
}

function browserStore(): HintStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readRound(store: HintStore, setId: string): StoredRound | null {
  try {
    const parsed: unknown = JSON.parse(store.getItem(PREFIX + setId) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { at, questions } = parsed as { at?: unknown; questions?: unknown };
    if (typeof at !== 'number' || typeof questions !== 'object' || questions === null || Array.isArray(questions)) return null;
    return { at, questions: questions as Record<string, readonly string[]> };
  } catch {
    return null;
  }
}

function writeRound(store: HintStore, setId: string, round: StoredRound): void {
  if (Object.keys(round.questions).length === 0) store.removeItem(PREFIX + setId);
  else store.setItem(PREFIX + setId, JSON.stringify(round));
}

/** Forgets rounds not touched for `PENDING_HINTS_MAX_AGE`, so abandoned rounds don't accumulate. */
function prune(store: HintStore, now: number): void {
  const stale: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const round = readRound(store, key.slice(PREFIX.length));
    if (!round || now - round.at > PENDING_HINTS_MAX_AGE) stale.push(key);
  }
  for (const key of stale) store.removeItem(key);
}

/**
 * The hints already taken on a question of a round. Stored values are replayed
 * through `nextHint`, so only a valid progression is restored (the longest
 * valid prefix of a damaged one); anything unreadable counts as none.
 */
export function loadPendingHints(setId: string, questionId: string, answer: string, store: HintStore | null = browserStore()): TrainerHint[] {
  if (!store) return [];
  const stored = readRound(store, setId)?.questions[questionId];
  if (!Array.isArray(stored)) return [];
  const hints: TrainerHint[] = [];
  for (const hint of stored) {
    const expected = nextHint(answer, hints);
    if (expected === null || hint !== expected) break;
    hints.push(expected);
  }
  return hints;
}

/** Records the hints taken so far on an unanswered question. Never throws. */
export function savePendingHints(setId: string, questionId: string, hints: readonly TrainerHint[], now = Date.now(), store: HintStore | null = browserStore()): void {
  if (!store) return;
  try {
    const round = readRound(store, setId) ?? { at: now, questions: {} };
    const questions = { ...round.questions };
    if (hints.length === 0) delete questions[questionId];
    else questions[questionId] = [...hints];
    writeRound(store, setId, { at: now, questions });
    prune(store, now);
  } catch {
    // Full or blocked storage: the hints still apply on this screen; they just won't survive leaving it.
  }
}

/** Forgets one question's pending hints (its answer, with the hints, is now saved). */
export function clearPendingHints(setId: string, questionId: string, store: HintStore | null = browserStore()): void {
  if (!store) return;
  try {
    const round = readRound(store, setId);
    if (!round || !(questionId in round.questions)) return;
    const questions = { ...round.questions };
    delete questions[questionId];
    writeRound(store, setId, { at: round.at, questions });
  } catch {
    // Nothing to do: stale entries are pruned later.
  }
}

/** Forgets everything pending for a round (it has been checked). */
export function clearRoundHints(setId: string, store: HintStore | null = browserStore()): void {
  try {
    store?.removeItem(PREFIX + setId);
  } catch {
    // Pruned later.
  }
}
