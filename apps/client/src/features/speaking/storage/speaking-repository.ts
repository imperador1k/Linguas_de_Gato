import { MAX_STORED_RECORDING_BYTES, formatBytes, type CustomTopic, type SpeakingAttempt } from '@ldg/shared';
import { StorageError } from '@/lib/storage/indexed-db';

/**
 * Persistence boundary for the Speaking Lab. Same pattern as Listening: an
 * IndexedDB implementation when the browser allows it, an in-memory one
 * otherwise. All methods reject with `StorageError` on failure.
 *
 * Privacy: recordings stay on this device. They are kept with the attempt
 * when the learner agrees (the default since M8), and can be deleted on their
 * own while the transcript and feedback stay.
 */
export interface SpeakingRepository {
  readonly persistent: boolean;

  /** Newest first. Corrupt records are skipped. */
  listAttempts(): Promise<SpeakingAttempt[]>;
  getAttempt(id: string): Promise<SpeakingAttempt | null>;
  /**
   * Insert or replace. With a recording, the audio is stored in the same
   * transaction and the attempt is marked `recording.stored`; if either part
   * fails, neither is written. Without one, an existing recording is untouched.
   */
  putAttempt(attempt: SpeakingAttempt, recording?: Blob): Promise<void>;
  /** Read-modify-write in one transaction. Resolves null if the attempt no longer exists. */
  updateAttempt(id: string, update: (attempt: SpeakingAttempt) => SpeakingAttempt): Promise<SpeakingAttempt | null>;
  /** Removes the attempt and its recording, if any. */
  deleteAttempt(id: string): Promise<void>;

  getRecording(attemptId: string): Promise<Blob | null>;
  /** Stores the audio and marks the attempt; resolves the updated attempt. */
  saveRecording(attemptId: string, recording: Blob): Promise<SpeakingAttempt | null>;
  /** Deletes only the audio; the transcript and feedback stay. */
  deleteRecording(attemptId: string): Promise<SpeakingAttempt | null>;
  /** Makes `recording.stored` match what is really stored, without reading the audio. Never deletes audio. */
  reconcileRecording(attemptId: string): Promise<RecordingReconciliation | null>;
  /** Ids of the attempts that have a stored recording. */
  listRecordingKeys(): Promise<string[]>;

  listTopics(): Promise<CustomTopic[]>;
  putTopic(topic: CustomTopic): Promise<void>;
  deleteTopic(id: string): Promise<void>;
}

export function sortNewestFirst<T extends { readonly createdAt: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export function withRecordingStored(attempt: SpeakingAttempt, stored: boolean, now: number): SpeakingAttempt {
  return { ...attempt, recording: { ...attempt.recording, stored }, updatedAt: now };
}

export interface RecordingReconciliation {
  readonly attempt: SpeakingAttempt;
  readonly present: boolean;
  readonly repaired: 'flag-cleared' | 'flag-set' | null;
}

export function recordingRepair(attempt: SpeakingAttempt, present: boolean): RecordingReconciliation['repaired'] {
  if (attempt.recording.stored === present) return null;
  return present ? 'flag-set' : 'flag-cleared';
}

export function assertStorableRecording(recording: Blob): void {
  if (recording.size <= 0) throw new StorageError('unknown', 'The recording is empty, so there is nothing to keep.');
  if (recording.size > MAX_STORED_RECORDING_BYTES) throw new StorageError('unknown', `Recordings over ${formatBytes(MAX_STORED_RECORDING_BYTES)} can't be kept in this browser.`);
}
