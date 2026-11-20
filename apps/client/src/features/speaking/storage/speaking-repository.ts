import type { CustomTopic, SpeakingAttempt } from '@ldg/shared';

/**
 * Persistence boundary for the Speaking Lab. Same pattern as Listening: an
 * IndexedDB implementation when the browser allows it, an in-memory one
 * otherwise. All methods reject with `StorageError` on failure.
 *
 * Privacy: by default an attempt keeps its transcript and feedback only; the
 * audio is stored solely when the learner opts in (`saveRecording`).
 */
export interface SpeakingRepository {
  readonly persistent: boolean;

  /** Newest first. Corrupt records are skipped. */
  listAttempts(): Promise<SpeakingAttempt[]>;
  getAttempt(id: string): Promise<SpeakingAttempt | null>;
  /** Insert or replace. */
  putAttempt(attempt: SpeakingAttempt): Promise<void>;
  /** Read-modify-write in one transaction. Resolves null if the attempt no longer exists. */
  updateAttempt(id: string, update: (attempt: SpeakingAttempt) => SpeakingAttempt): Promise<SpeakingAttempt | null>;
  /** Removes the attempt and its recording, if any. */
  deleteAttempt(id: string): Promise<void>;

  getRecording(attemptId: string): Promise<Blob | null>;
  /** Stores the audio and marks the attempt; resolves the updated attempt. */
  saveRecording(attemptId: string, recording: Blob): Promise<SpeakingAttempt | null>;
  /** Deletes only the audio; the transcript and feedback stay. */
  deleteRecording(attemptId: string): Promise<SpeakingAttempt | null>;

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
