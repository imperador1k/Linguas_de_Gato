import type {
  DictationRecord,
  ListeningExerciseSet,
  ListeningSession,
  SubtitleCue,
  TimedWord,
  TranscriptRecord,
  TranscriptSegment,
} from '@ldg/shared';

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
  /** Creates a session, and its transcript in the same transaction when given. */
  createSession(session: ListeningSession, transcript?: TranscriptContent): Promise<void>;
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
