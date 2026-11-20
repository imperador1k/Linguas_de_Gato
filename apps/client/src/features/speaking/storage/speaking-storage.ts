import { useEffect, useState } from 'react';
import { StorageError, toStorageError } from '@/lib/storage/indexed-db';
import { IndexedDbSpeakingRepository } from './indexed-db-speaking-repository';
import { MemorySpeakingRepository } from './memory-speaking-repository';
import type { SpeakingRepository } from './speaking-repository';

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
 * Recordings made during this page lifetime, keyed by attempt id. Not saved
 * unless the learner opts in, so a reload keeps the transcript and feedback
 * but not the audio.
 */
const recordings = new Map<string, Blob>();

export function rememberRecording(attemptId: string, recording: Blob): void {
  recordings.set(attemptId, recording);
}

export function recallRecording(attemptId: string): Blob | null {
  return recordings.get(attemptId) ?? null;
}

export function forgetRecording(attemptId: string): void {
  recordings.delete(attemptId);
}
