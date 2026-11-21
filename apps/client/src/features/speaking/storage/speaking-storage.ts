import type { SpeakingAttempt } from '@ldg/shared';
import { useEffect, useState } from 'react';
import { StorageError, toStorageError } from '@/lib/storage/indexed-db';
import { clearVolatileMedia, setVolatileMedia } from '@/lib/volatile-media';
import { IndexedDbSpeakingRepository } from './indexed-db-speaking-repository';
import { MemorySpeakingRepository } from './memory-speaking-repository';
import { withRecordingStored, type SpeakingRepository } from './speaking-repository';

export interface SpeakingStorage {
  readonly repository: SpeakingRepository;
  readonly fallbackReason: StorageError | null;
}

let storagePromise: Promise<SpeakingStorage> | null = null;

/** Opens IndexedDB once per page; degrades to memory instead of failing the feature. */
export function getSpeakingStorage(): Promise<SpeakingStorage> {
  storagePromise ??= IndexedDbSpeakingRepository.open().then(
    (repository): SpeakingStorage => ({ repository, fallbackReason: null }),
    (error: unknown): SpeakingStorage => {
      console.warn('IndexedDB unavailable, keeping Speaking data in memory.', error);
      return { repository: new MemorySpeakingRepository(), fallbackReason: toStorageError(error) };
    },
  );
  return storagePromise;
}

export function useSpeakingStorage(): SpeakingStorage | null {
  const [storage, setStorage] = useState<SpeakingStorage | null>(null);
  useEffect(() => {
    let active = true;
    void getSpeakingStorage().then((value) => active && setStorage(value));
    return () => {
      active = false;
    };
  }, []);
  return storage;
}

export function describeSpeakingStorageError(error: unknown): string {
  return toStorageError(error).message;
}

/**
 * Recordings open during this page lifetime, keyed by attempt id. Kept
 * recordings live in IndexedDB; one that isn't kept exists only here, so it is
 * registered as volatile and a reload warns before losing it (it can't be
 * recovered: the learner's voice exists nowhere else).
 */
const recordings = new Map<string, Blob>();

export type RecordingIssue = 'quota' | 'write-failed' | 'recording-missing';
const recordingIssues = new Map<string, RecordingIssue>();

function trackRecording(attemptId: string, info: { saved: boolean; label: string }) {
  const key = `speaking:${attemptId}`;
  if (info.saved) clearVolatileMedia(key);
  else setVolatileMedia({ key, kind: 'speaking', label: `Recording: ${info.label}`, path: `/speaking/attempts/${attemptId}` });
}

export function rememberRecording(attemptId: string, recording: Blob, info: { saved: boolean; label: string }): void {
  recordings.set(attemptId, recording);
  trackRecording(attemptId, info);
}

export function markRecordingSaved(attemptId: string, info: { saved: boolean; label: string }): void {
  if (recordings.has(attemptId)) trackRecording(attemptId, info);
}

export function recallRecording(attemptId: string): Blob | null {
  return recordings.get(attemptId) ?? null;
}

export function forgetRecording(attemptId: string): void {
  recordings.delete(attemptId);
  recordingIssues.delete(attemptId);
  clearVolatileMedia(`speaking:${attemptId}`);
}

export function noteRecordingIssue(attemptId: string, issue: RecordingIssue | null): void {
  if (issue) recordingIssues.set(attemptId, issue);
  else recordingIssues.delete(attemptId);
}

export function recordingIssueOf(attemptId: string): RecordingIssue | null {
  return recordingIssues.get(attemptId) ?? null;
}

/**
 * Saves a new attempt, keeping its recording in the same transaction when
 * asked. If the recording doesn't fit, the attempt (transcript, the expensive
 * part) is saved without it and the issue is reported.
 */
export async function saveAttemptWithRecording(
  repository: SpeakingRepository,
  attempt: SpeakingAttempt,
  recording: Blob,
  keep: boolean,
): Promise<{ attempt: SpeakingAttempt; kept: boolean; issue: RecordingIssue | null }> {
  let issue: RecordingIssue | null = null;
  if (keep) {
    try {
      await repository.putAttempt(attempt, recording);
      rememberRecording(attempt.id, recording, { saved: true, label: attempt.prompt.title });
      noteRecordingIssue(attempt.id, null);
      return { attempt: withRecordingStored(attempt, true, attempt.updatedAt), kept: true, issue: null };
    } catch (error) {
      issue = error instanceof StorageError && error.kind === 'quota' ? 'quota' : 'write-failed';
    }
  }
  await repository.putAttempt(attempt);
  rememberRecording(attempt.id, recording, { saved: false, label: attempt.prompt.title });
  noteRecordingIssue(attempt.id, issue);
  return { attempt, kept: false, issue };
}
