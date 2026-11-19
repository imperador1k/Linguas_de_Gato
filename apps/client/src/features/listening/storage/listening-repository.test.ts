import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { DictationRecord, ListeningSession, SubtitleCue } from '@ldg/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, StorageError, toStorageError } from '@/lib/storage/indexed-db';
import { IndexedDbListeningRepository, LISTENING_DB_NAME, LISTENING_DB_VERSION } from './indexed-db-listening-repository';
import type { ListeningRepository } from './listening-repository';
import { newFileSession, newYouTubeSession } from './listening-storage';
import { MemoryListeningRepository } from './memory-listening-repository';

const accepted = {
  format: { extension: 'mp3', label: 'MP3', kind: 'audio', mimeTypes: ['audio/mpeg'], playable: true, transcribable: true },
  kind: 'audio',
} as const;

function fileSession(name = 'episode.mp3', now = 1000): ListeningSession {
  const file = new File(['audio-bytes'], name, { type: 'audio/mpeg', lastModified: 42 });
  return newFileSession(file, accepted, now);
}

const cues: SubtitleCue[] = [
  { id: '1', startMs: 0, endMs: 1000, text: 'Hello there.' },
  { id: '2', startMs: 1000, endMs: 2500, text: 'How are you?' },
];

const srtSummary = { fileName: 'episode.srt', format: 'srt' as const, cueCount: 2, skippedBlocks: 0 };

function dictation(sessionId: string, cueId: string): DictationRecord {
  return {
    sessionId,
    cueId,
    referenceText: 'Hello there.',
    attempts: [{ submittedAt: 5, answer: 'hello there', wordErrorRate: 0, accuracy: 1, referenceWords: 2 }],
    updatedAt: 5,
  };
}

type Factory = { name: string; create: () => Promise<ListeningRepository>; dispose?: (repo: ListeningRepository) => void };

const factories: Factory[] = [
  {
    name: 'IndexedDbListeningRepository',
    create: () => IndexedDbListeningRepository.open(new IDBFactory()),
    dispose: (repo) => (repo as IndexedDbListeningRepository).close(),
  },
  { name: 'MemoryListeningRepository', create: async () => new MemoryListeningRepository() },
];

describe.each(factories)('$name contract', ({ create, dispose }) => {
  let repo: ListeningRepository;

  beforeEach(async () => {
    repo = await create();
  });

  afterEach(() => dispose?.(repo));

  it('creates, reads and lists sessions by most recently opened', async () => {
    const older = fileSession('a.mp3', 1000);
    const newer = { ...newYouTubeSession({ videoId: 'dQw4w9WgXcQ' }, 2000) };
    await repo.createSession(older);
    await repo.createSession(newer);

    expect(await repo.getSession(older.id)).toEqual(older);
    expect((await repo.listSessions()).map((session) => session.id)).toEqual([newer.id, older.id]);
    expect(await repo.getSession('missing')).toBeNull();
  });

  it('creates a session together with its transcript and provider timings', async () => {
    const session = { ...fileSession(), transcript: srtSummary };
    const words = [{ text: 'Hello', startMs: 0, endMs: 400 }];
    const segments = [{ id: '1', startMs: 0, endMs: 2500, text: 'Hello there. How are you?', avgLogprob: null, noSpeechProb: null }];

    await repo.createSession(session, { cues, words, segments });

    expect((await repo.getSession(session.id))?.transcript?.cueCount).toBe(2);
    expect(await repo.getTranscript(session.id)).toEqual({ sessionId: session.id, cues, words, segments });
  });

  it('updates a session atomically and returns the stored value', async () => {
    const session = fileSession();
    await repo.createSession(session);

    const updated = await repo.updateSession(session.id, (current) => ({
      ...current,
      title: 'Renamed',
      playback: { positionSeconds: 12.5, playbackRate: 0.75 },
    }));

    expect(updated?.title).toBe('Renamed');
    expect(await repo.getSession(session.id)).toMatchObject({ title: 'Renamed', playback: { positionSeconds: 12.5 } });
    expect(await repo.updateSession('missing', (current) => current)).toBeNull();
  });

  it('does not lose concurrent updates to different fields', async () => {
    const session = fileSession();
    await repo.createSession(session);
    await Promise.all([
      repo.updateSession(session.id, (current) => ({ ...current, title: 'New title' })),
      repo.updateSession(session.id, (current) => ({ ...current, playback: { positionSeconds: 30, playbackRate: 1 } })),
    ]);
    expect(await repo.getSession(session.id)).toMatchObject({ title: 'New title', playback: { positionSeconds: 30 } });
  });

  it('stores and replaces transcripts, clearing stale dictation history', async () => {
    const session = fileSession();
    await repo.createSession(session);
    const withTranscript = { ...session, transcript: srtSummary };

    await repo.replaceTranscript(withTranscript, { cues });
    await repo.putDictation(dictation(session.id, '1'));
    expect((await repo.getTranscript(session.id))?.cues).toEqual(cues);
    expect(await repo.listDictation(session.id)).toHaveLength(1);
    expect((await repo.getSession(session.id))?.transcript?.cueCount).toBe(2);

    await repo.replaceTranscript({ ...withTranscript, transcript: null }, null);
    expect(await repo.getTranscript(session.id)).toBeNull();
    expect(await repo.listDictation(session.id)).toEqual([]);
  });

  it('keeps dictation records separate per session', async () => {
    const a = fileSession('a.mp3');
    const b = fileSession('b.mp3');
    await repo.createSession(a);
    await repo.createSession(b);
    await repo.putDictation(dictation(a.id, '1'));
    await repo.putDictation(dictation(a.id, '2'));
    await repo.putDictation(dictation(b.id, '1'));

    expect((await repo.listDictation(a.id)).map((record) => record.cueId).sort()).toEqual(['1', '2']);
    expect(await repo.listDictation(b.id)).toHaveLength(1);

    // Overwrites the same (session, cue) key instead of duplicating it.
    await repo.putDictation({ ...dictation(a.id, '1'), updatedAt: 99 });
    expect(await repo.listDictation(a.id)).toHaveLength(2);
  });

  it('saves and deletes a media copy, keeping the session flag in sync', async () => {
    const session = fileSession();
    await repo.createSession(session);

    const saved = await repo.saveMedia(session.id, new Blob(['bytes'], { type: 'audio/mpeg' }));
    expect(saved?.source).toMatchObject({ kind: 'file', mediaStored: true });
    const media = await repo.getMedia(session.id);
    expect(media).toBeInstanceOf(Blob);
    expect(await media?.text()).toBe('bytes');

    const removed = await repo.deleteMedia(session.id);
    expect(removed?.source).toMatchObject({ mediaStored: false });
    expect(await repo.getMedia(session.id)).toBeNull();
  });

  it('deletes a session with its transcript, media and dictation', async () => {
    const keep = fileSession('keep.mp3');
    const drop = fileSession('drop.mp3');
    await repo.createSession(keep);
    await repo.createSession(drop);
    await repo.replaceTranscript({ ...drop, transcript: { ...srtSummary, fileName: 'x.srt' } }, { cues });
    await repo.saveMedia(drop.id, new Blob(['x']));
    await repo.putDictation(dictation(drop.id, '1'));
    await repo.putDictation(dictation(keep.id, '1'));

    await repo.deleteSession(drop.id);

    expect(await repo.getSession(drop.id)).toBeNull();
    expect(await repo.getTranscript(drop.id)).toBeNull();
    expect(await repo.getMedia(drop.id)).toBeNull();
    expect(await repo.listDictation(drop.id)).toEqual([]);
    expect(await repo.listDictation(keep.id)).toHaveLength(1);
    expect((await repo.listSessions()).map((session) => session.id)).toEqual([keep.id]);
  });
});

describe('IndexedDbListeningRepository persistence', () => {
  it('restores data after the connection is closed and reopened (a page reload)', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbListeningRepository.open(factory);
    const session = fileSession();
    await first.createSession(session);
    await first.replaceTranscript({ ...session, transcript: { ...srtSummary, fileName: 'a.vtt', format: 'vtt' } }, { cues });
    await first.putDictation(dictation(session.id, '2'));
    first.close();

    const second = await IndexedDbListeningRepository.open(factory);
    expect((await second.listSessions()).map((item) => item.id)).toEqual([session.id]);
    expect((await second.getTranscript(session.id))?.cues).toEqual(cues);
    expect((await second.listDictation(session.id))[0]?.cueId).toBe('2');
    second.close();
  });

  it('reads M1 records (no M2 fields) unchanged', async () => {
    const factory = new IDBFactory();
    const repo = await IndexedDbListeningRepository.open(factory);
    const session = { ...fileSession(), transcript: srtSummary };
    await repo.createSession(session, { cues });
    expect(await repo.getTranscript(session.id)).toEqual({ sessionId: session.id, cues });
    expect((await repo.getSession(session.id))?.transcript).toEqual(srtSummary);
    repo.close();
  });

  it('writes nothing when the transcript of a new session is invalid', async () => {
    const repo = await IndexedDbListeningRepository.open(new IDBFactory());
    const session = fileSession();
    const badCues = [{ id: '', startMs: -1, endMs: 0, text: 'x' }] as unknown as SubtitleCue[];
    await expect(repo.createSession(session, { cues: badCues })).rejects.toThrow();
    expect(await repo.getSession(session.id)).toBeNull();
    repo.close();
  });

  it('skips corrupt records instead of failing the whole list', async () => {
    const factory = new IDBFactory();
    const repo = await IndexedDbListeningRepository.open(factory);
    const good = fileSession();
    await repo.createSession(good);
    repo.close();

    // Write a malformed record directly, as an older or broken build might have.
    const raw = await openDatabase({ name: LISTENING_DB_NAME, version: LISTENING_DB_VERSION, upgrade: () => undefined, factory });
    await new Promise<void>((resolve, reject) => {
      const transaction = raw.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put({ id: 'broken', title: 42 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    raw.close();

    const reopened = await IndexedDbListeningRepository.open(factory);
    expect((await reopened.listSessions()).map((session) => session.id)).toEqual([good.id]);
    expect(await reopened.getSession('broken')).toBeNull();
    reopened.close();
  });

  it('rejects invalid sessions before writing them', async () => {
    const repo = await IndexedDbListeningRepository.open(new IDBFactory());
    const session = fileSession();
    await repo.createSession(session);
    await expect(repo.updateSession(session.id, (current) => ({ ...current, title: '' }))).rejects.toThrow();
    // The aborted transaction leaves the stored value untouched.
    expect((await repo.getSession(session.id))?.title).toBe(session.title);
    repo.close();
  });

  it('reports a blocked upgrade while another connection holds an older version', async () => {
    const factory = new IDBFactory();
    const old = await openDatabase({ name: 'blocking-test', version: 1, upgrade: () => undefined, factory });
    old.onversionchange = null; // Simulate a tab that does not yield.
    await expect(openDatabase({ name: 'blocking-test', version: 2, upgrade: () => undefined, factory })).rejects.toMatchObject({
      kind: 'blocked',
    });
    old.close();
  });

  it('reports unavailable storage when IndexedDB is missing', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate a browser without IndexedDB
    delete globalThis.indexedDB;
    try {
      await expect(openDatabase({ name: 'x', version: 1, upgrade: () => undefined })).rejects.toMatchObject({
        kind: 'unavailable',
      });
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

describe('toStorageError', () => {
  it('maps quota errors from every browser', () => {
    expect(toStorageError(new DOMException('full', 'QuotaExceededError')).kind).toBe('quota');
    expect(toStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }).kind).toBe('quota');
  });

  it('maps version, security and unknown errors', () => {
    expect(toStorageError(new DOMException('newer', 'VersionError')).kind).toBe('version');
    expect(toStorageError(new DOMException('denied', 'SecurityError')).kind).toBe('unavailable');
    expect(toStorageError(new Error('boom')).kind).toBe('unknown');
  });

  it('passes StorageError through unchanged', () => {
    const error = new StorageError('blocked');
    expect(toStorageError(error)).toBe(error);
  });
});
