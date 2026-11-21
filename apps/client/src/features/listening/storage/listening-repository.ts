import {
  MAX_STORED_MEDIA_BYTES,
  formatBytes,
  type DictationRecord,
  type ListeningExerciseSet,
  type ListeningSession,
  type SubtitleCue,
  type TimedWord,
  type TranscriptRecord,
  type TranscriptSegment,
} from '@ldg/shared';
import { StorageError } from '@/lib/storage/indexed-db';

/** What a transcript write carries: cues always; provider timing when the transcript was generated. */
export interface TranscriptContent {
  readonly cues: readonly SubtitleCue[];
  readonly segments?: readonly TranscriptSegment[];
  readonly words?: readonly TimedWord[];
}

/**
 * Persistence boundary for the Listening module. The UI depends only on this
 * interface; an IndexedDB implementation is used when the browser allows it,
 * and an in-memory one otherwise (data then lasts until the tab closes).
 *
 * All methods reject with `StorageError` on failure.
 */
export interface ListeningRepository {
  /** False for the in-memory fallback. */
  readonly persistent: boolean;

  /** All valid sessions, most recently opened first. Corrupt records are skipped. */
  listSessions(): Promise<ListeningSession[]>;
  getSession(id: string): Promise<ListeningSession | null>;
  /**
   * Creates a session, with its transcript and a copy of its media in the same
   * transaction when given. With media, the stored session has
   * `source.mediaStored: true`; if any part fails (a full disk, for one),
   * nothing is written.
   */
  createSession(session: ListeningSession, transcript?: TranscriptContent, media?: Blob): Promise<void>;
  /**
   * Read-modify-write in one transaction, so concurrent updates (e.g. playback
   * position and a renamed title) never overwrite each other.
   * Resolves with the stored session, or null if it no longer exists.
   */
  updateSession(id: string, update: (session: ListeningSession) => ListeningSession): Promise<ListeningSession | null>;
  /** Removes a session and everything that belongs to it. */
  deleteSession(id: string): Promise<void>;

  getTranscript(sessionId: string): Promise<TranscriptRecord | null>;
  /**
   * Stores (or with `null`, removes) the transcript and writes the session's
   * summary. Dictation history is cleared because cue identities change.
   */
  replaceTranscript(session: ListeningSession, transcript: TranscriptContent | null): Promise<void>;

  getMedia(sessionId: string): Promise<Blob | null>;
  /** Keeps a copy of the media file and marks the session accordingly. */
  saveMedia(sessionId: string, media: Blob): Promise<ListeningSession | null>;
  deleteMedia(sessionId: string): Promise<ListeningSession | null>;
  /**
   * Makes the session's `mediaStored` flag match what is really stored, in
   * one transaction, without reading the media. Never deletes media.
   * Resolves null if the session no longer exists.
   */
  reconcileMedia(sessionId: string): Promise<MediaReconciliation | null>;
  /** Ids of the sessions that have a stored media copy. */
  listMediaKeys(): Promise<string[]>;

  listDictation(sessionId: string): Promise<DictationRecord[]>;
  putDictation(record: DictationRecord): Promise<void>;

  /**
   * AI-generated exercise sets of a session, newest first. They survive a
   * transcript replacement (with the learner's answers) and are flagged as
   * based on an earlier transcript through their fingerprint.
   */
  listExerciseSets(sessionId: string): Promise<ListeningExerciseSet[]>;
  getExerciseSet(id: string): Promise<ListeningExerciseSet | null>;
  putExerciseSet(set: ListeningExerciseSet): Promise<void>;
  deleteExerciseSet(id: string): Promise<void>;
}

export interface MediaReconciliation {
  readonly session: ListeningSession;
  /** Whether a media copy exists. */
  readonly present: boolean;
  /** What was corrected: a flag claiming a missing copy, or an unflagged copy. */
  readonly repaired: 'flag-cleared' | 'flag-set' | null;
}

/** A copy larger than the policy allows is refused before anything is written. */
export function assertStorableMedia(media: Blob): void {
  if (media.size <= 0) throw new StorageError('unknown', 'The file is empty, so there is nothing to keep.');
  if (media.size > MAX_STORED_MEDIA_BYTES) throw new StorageError('unknown', `Files over ${formatBytes(MAX_STORED_MEDIA_BYTES)} can't be kept in this browser.`);
}

export function sortSetsNewestFirst(sets: ListeningExerciseSet[]): ListeningExerciseSet[] {
  return sets.sort((a, b) => b.createdAt - a.createdAt);
}

export function toTranscriptRecord(sessionId: string, transcript: TranscriptContent): TranscriptRecord {
  return {
    sessionId,
    cues: [...transcript.cues],
    ...(transcript.segments ? { segments: [...transcript.segments] } : {}),
    ...(transcript.words ? { words: [...transcript.words] } : {}),
  };
}

export function sortByLastOpened(sessions: ListeningSession[]): ListeningSession[] {
  return sessions.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function withMediaStored(session: ListeningSession, mediaStored: boolean, now: number): ListeningSession {
  if (session.source.kind !== 'file') return session;
  return { ...session, source: { ...session.source, mediaStored }, updatedAt: now };
}

/** The flag correction `reconcileMedia` applies, given whether a copy exists. */
export function mediaRepair(session: ListeningSession, present: boolean): MediaReconciliation['repaired'] {
  if (session.source.kind !== 'file' || session.source.mediaStored === present) return null;
  return present ? 'flag-set' : 'flag-cleared';
}
