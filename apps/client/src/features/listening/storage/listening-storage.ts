import {
  DEFAULT_TARGET_LANGUAGE,
  LISTENING_RECORD_VERSION,
  type AcceptedMediaFile,
  type ListeningSession,
  type YouTubeVideoRef,
} from '@ldg/shared';
import { useEffect, useState } from 'react';
import { StorageError, toStorageError } from '@/lib/storage/indexed-db';
import { IndexedDbListeningRepository } from './indexed-db-listening-repository';
import type { ListeningRepository } from './listening-repository';
import { MemoryListeningRepository } from './memory-listening-repository';

export interface ListeningStorage {
  readonly repository: ListeningRepository;
  /** Why we fell back to memory, when we did. */
  readonly fallbackReason: StorageError | null;
}

let storagePromise: Promise<ListeningStorage> | null = null;

/** Opens IndexedDB once per page; degrades to memory instead of failing the feature. */
export function getListeningStorage(): Promise<ListeningStorage> {
  storagePromise ??= IndexedDbListeningRepository.open().then(
    (repository): ListeningStorage => ({ repository, fallbackReason: null }),
    (error: unknown): ListeningStorage => {
      console.warn('IndexedDB unavailable, keeping Listening data in memory.', error);
      return { repository: new MemoryListeningRepository(), fallbackReason: toStorageError(error) };
    },
  );
  return storagePromise;
}

export function useListeningStorage(): ListeningStorage | null {
  const [storage, setStorage] = useState<ListeningStorage | null>(null);
  useEffect(() => {
    let active = true;
    void getListeningStorage().then((value) => active && setStorage(value));
    return () => {
      active = false;
    };
  }, []);
  return storage;
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

function baseSession(title: string, now: number): Omit<ListeningSession, 'source'> {
  return {
    id: createSessionId(),
    version: LISTENING_RECORD_VERSION,
    language: DEFAULT_TARGET_LANGUAGE,
    title: title.slice(0, 200) || 'Untitled session',
    transcript: null,
    playback: { positionSeconds: 0, playbackRate: 1 },
    loop: null,
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function newFileSession(file: File, accepted: AcceptedMediaFile, now = Date.now()): ListeningSession {
  return {
    ...baseSession(file.name, now),
    source: {
      kind: 'file',
      fileName: file.name,
      fileSize: file.size,
      lastModified: Math.trunc(file.lastModified),
      mimeType: file.type,
      formatExtension: accepted.format.extension,
      mediaKind: accepted.kind,
      mediaStored: false,
    },
  };
}

export function newYouTubeSession(video: YouTubeVideoRef, now = Date.now()): ListeningSession {
  return {
    ...baseSession(`YouTube video ${video.videoId}`, now),
    source: {
      kind: 'youtube',
      videoId: video.videoId,
      ...(video.startSeconds !== undefined ? { startSeconds: video.startSeconds } : {}),
    },
    playback: { positionSeconds: video.startSeconds ?? 0, playbackRate: 1 },
  };
}

export interface StorageEstimateSummary {
  readonly usage: number;
  readonly quota: number;
}

export async function estimateStorage(): Promise<StorageEstimateSummary | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function describeStorageError(error: unknown): string {
  return toStorageError(error).message;
}
