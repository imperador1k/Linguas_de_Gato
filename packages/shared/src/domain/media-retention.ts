/*
 * Media retention policy (M8). Transcripts and progress are always saved; the
 * audio itself is kept in the browser's database when the learner agrees,
 * which is the default for reasonably sized files. These rules are pure so
 * the creation panel, the reconnect card and the session page decide alike.
 */

/** Files up to this size are kept automatically (the learner can opt out). */
export const AUTO_KEEP_MEDIA_MAX_BYTES = 100 * 1024 ** 2;
/** Hard cap for a kept copy of an imported file. */
export const MAX_STORED_MEDIA_BYTES = 500 * 1024 ** 2;
/** Hard cap for a kept Speaking recording (a 3-minute recording is a few MB). */
export const MAX_STORED_RECORDING_BYTES = 50 * 1024 ** 2;
/** Free space left untouched, so a copy never takes the bytes transcripts and progress need. */
export const MEDIA_QUOTA_HEADROOM_BYTES = 50 * 1024 ** 2;

export interface StorageEstimateLike {
  readonly usage: number;
  readonly quota: number;
}

export type RetentionBlocker = 'not-persistent' | 'too-large' | 'storage-full' | 'empty';

export interface RetentionPlan {
  /** Whether keeping a copy is possible at all. */
  readonly allowed: boolean;
  /** What the option should start as. */
  readonly defaultKeep: boolean;
  /** Why keeping is impossible (when `allowed` is false). */
  readonly blocker: RetentionBlocker | null;
  /** Free bytes reported by the browser, when known. */
  readonly freeBytes: number | null;
}

export interface RetentionInput {
  readonly size: number;
  /** False when the app runs on the in-memory fallback (private mode, blocked storage). */
  readonly persistent: boolean;
  /** `navigator.storage.estimate()`, or null when the browser doesn't report it. */
  readonly estimate: StorageEstimateLike | null;
  readonly maxBytes?: number;
  readonly autoKeepMaxBytes?: number;
}

export function planMediaRetention({ size, persistent, estimate, maxBytes = MAX_STORED_MEDIA_BYTES, autoKeepMaxBytes = AUTO_KEEP_MEDIA_MAX_BYTES }: RetentionInput): RetentionPlan {
  const freeBytes = estimate ? Math.max(0, estimate.quota - estimate.usage) : null;
  const blocked = (blocker: RetentionBlocker): RetentionPlan => ({ allowed: false, defaultKeep: false, blocker, freeBytes });
  if (!persistent) return blocked('not-persistent');
  if (!Number.isFinite(size) || size <= 0) return blocked('empty');
  if (size > maxBytes) return blocked('too-large');
  // An unknown estimate is not a reason to refuse: the write itself reports a full disk.
  if (freeBytes !== null && freeBytes < size + MEDIA_QUOTA_HEADROOM_BYTES) return blocked('storage-full');
  return { allowed: true, defaultKeep: size <= autoKeepMaxBytes, blocker: null, freeBytes };
}

/**
 * What a Listening session's media looks like to the learner.
 * - `saved`: a copy is in the browser database, so it plays after a reload.
 * - `this-visit`: the file is open in this tab only; a reload asks for it again.
 * - `needs-file`: nothing to play until the original file is chosen again.
 * - `not-applicable`: YouTube (nothing is ever stored).
 */
export type ListeningMediaState = 'saved' | 'this-visit' | 'needs-file' | 'not-applicable';

export function listeningMediaState(source: { readonly kind: string; readonly mediaStored?: boolean }, facts: { readonly stored: boolean; readonly inMemory: boolean }): ListeningMediaState {
  if (source.kind !== 'file') return 'not-applicable';
  // The flag alone is not enough: only a copy that really exists counts as saved.
  if (source.mediaStored && facts.stored) return 'saved';
  return facts.inMemory ? 'this-visit' : 'needs-file';
}

/** A Speaking attempt's recording, from the learner's point of view. */
export type RecordingState = 'saved' | 'this-visit' | 'not-kept';

export function recordingState(recording: { readonly stored: boolean }, facts: { readonly stored: boolean; readonly inMemory: boolean }): RecordingState {
  if (recording.stored && facts.stored) return 'saved';
  return facts.inMemory ? 'this-visit' : 'not-kept';
}
