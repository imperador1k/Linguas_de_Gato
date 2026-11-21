import type { ListeningSession } from '@ldg/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageError } from '@/lib/storage/indexed-db';
import { getVolatileMedia } from '@/lib/volatile-media';
import { newFileSession } from './listening-storage';
import { MemoryListeningRepository } from './memory-listening-repository';
import { createSessionWithMedia, keepSessionMedia } from './session-media';
import { forgetSessionMedia, mediaIssueOf, recallSessionMedia } from './session-media-cache';

const accepted = {
  format: { extension: 'mp3', label: 'MP3', kind: 'audio', mimeTypes: ['audio/mpeg'], playable: true, transcribable: true },
  kind: 'audio',
} as const;

function make(name = 'talk.mp3'): { session: ListeningSession; file: File } {
  const file = new File(['audio'], name, { type: 'audio/mpeg' });
  return { session: newFileSession(file, accepted), file };
}

/** A repository whose media writes fail like a full disk. */
function fullDisk(): MemoryListeningRepository {
  const repository = new MemoryListeningRepository();
  const create = repository.createSession.bind(repository);
  repository.createSession = (session, transcript, media) => (media ? Promise.reject(new StorageError('quota')) : create(session, transcript));
  repository.saveMedia = () => Promise.reject(new StorageError('quota'));
  return repository;
}

describe('createSessionWithMedia', () => {
  let opened: string[] = [];
  beforeEach(() => {
    for (const id of opened) forgetSessionMedia(id);
    opened = [];
  });

  it('keeps the copy with the session and does not mark it as at risk', async () => {
    const repository = new MemoryListeningRepository();
    const { session, file } = make();
    opened.push(session.id);
    const created = await createSessionWithMedia(repository, session, { media: file, keep: true });
    expect(created).toMatchObject({ kept: true, issue: null });
    expect(await repository.getMedia(session.id)).toBe(file);
    expect(recallSessionMedia(session.id)).toBe(file);
    expect(getVolatileMedia().some((item) => item.key === `listening:${session.id}`)).toBe(false);
  });

  it('opts out cleanly: the file plays this visit and is flagged as at risk on reload', async () => {
    const repository = new MemoryListeningRepository();
    const { session, file } = make('lecture.mp3');
    opened.push(session.id);
    const created = await createSessionWithMedia(repository, session, { media: file, keep: false });
    expect(created).toMatchObject({ kept: false, issue: null });
    expect(await repository.getMedia(session.id)).toBeNull();
    expect(getVolatileMedia()).toContainEqual({ key: `listening:${session.id}`, kind: 'listening', label: 'lecture.mp3', path: `/listening/session/${session.id}` });
  });

  it('saves the session without the copy when storage is full, and says why', async () => {
    const repository = fullDisk();
    const { session, file } = make();
    opened.push(session.id);
    const created = await createSessionWithMedia(repository, session, { media: file, keep: true });
    expect(created).toMatchObject({ kept: false, issue: 'quota', session: { source: { mediaStored: false } } });
    expect(await repository.getSession(session.id)).not.toBeNull();
    expect(mediaIssueOf(session.id)).toBe('quota');
  });

  it('propagates failures that also prevent saving the session', async () => {
    const repository = new MemoryListeningRepository();
    repository.createSession = () => Promise.reject(new StorageError('unavailable'));
    const { session, file } = make();
    await expect(createSessionWithMedia(repository, session, { media: file, keep: true })).rejects.toBeInstanceOf(StorageError);
  });
});

describe('keepSessionMedia', () => {
  it('keeps a reconnected file and clears the at-risk state', async () => {
    const repository = new MemoryListeningRepository();
    const { session, file } = make();
    await createSessionWithMedia(repository, session, { media: file, keep: false });
    const outcome = await keepSessionMedia(repository, session, file);
    expect(outcome.session?.source).toMatchObject({ mediaStored: true });
    expect(outcome.issue).toBeNull();
    expect(getVolatileMedia().some((item) => item.key === `listening:${session.id}`)).toBe(false);
    forgetSessionMedia(session.id);
  });

  it('reports a full disk without throwing, and keeps the file playable this visit', async () => {
    const repository = fullDisk();
    const { session, file } = make();
    await createSessionWithMedia(repository, session, { media: file, keep: false });
    const outcome = await keepSessionMedia(repository, session, file);
    expect(outcome).toEqual({ session: null, issue: 'quota' });
    expect(recallSessionMedia(session.id)).toBe(file);
    expect(getVolatileMedia().some((item) => item.key === `listening:${session.id}`)).toBe(true);
    forgetSessionMedia(session.id);
  });
});
