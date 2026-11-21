import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MAX_STORED_RECORDING_BYTES, type CustomTopic, type SpeakingAttempt } from '@ldg/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DB_NAME, APP_DB_VERSION, openAppDatabase } from '@/lib/storage/app-database';
import { openDatabase, StorageError } from '@/lib/storage/indexed-db';
import { IndexedDbListeningRepository } from '../../listening/storage/indexed-db-listening-repository';
import { IndexedDbSpeakingRepository } from './indexed-db-speaking-repository';
import { MemorySpeakingRepository } from './memory-speaking-repository';
import type { SpeakingRepository } from './speaking-repository';

function attempt(id: string, createdAt = 1000): SpeakingAttempt {
  return {
    id,
    version: 1,
    language: 'en',
    prompt: {
      source: 'library',
      promptId: 'work-remote',
      title: 'Remote or office work?',
      instructions: 'Give your opinion with reasons.',
      points: ['Productivity'],
      category: 'work',
      level: 'B2',
    },
    mode: 'guided',
    targetDurationSeconds: 60,
    recordingDurationMs: 58_000,
    transcript: {
      segments: [{ id: '1', startMs: 0, endMs: 5000, recognizedText: 'I think remote work is good.', text: 'I think remote work is good.' }],
      words: [{ text: 'I', startMs: 0, endMs: 200 }],
      model: 'whisper-large-v3-turbo',
      detectedLanguage: 'English',
    },
    fluency: {
      wordCount: 6,
      speakingTimeMs: 5000,
      recordingDurationMs: 58_000,
      wordsPerMinute: 72,
      timingSource: 'words',
      pauses: { thresholdMs: 1000, longThresholdMs: 2500, count: 0, longCount: 0, totalMs: 0, longestMs: 0, longest: [] },
      repetitions: { count: 0, examples: [] },
      fillers: { count: 0, items: [] },
    },
    assessment: null,
    exerciseResponses: [],
    recording: { stored: false, mimeType: 'audio/webm' },
    createdAt,
    updatedAt: createdAt,
  };
}

const topic = (id: string, createdAt: number): CustomTopic => ({
  id,
  createdAt,
  prompt: { source: 'custom', promptId: null, title: 'My job interview', instructions: 'Describe your strengths.', points: [], category: 'work', level: null },
});

type Factory = { name: string; create: () => Promise<SpeakingRepository>; dispose?: (repo: SpeakingRepository) => void };

const factories: Factory[] = [
  {
    name: 'IndexedDbSpeakingRepository',
    create: () => IndexedDbSpeakingRepository.open(new IDBFactory()),
    dispose: (repo) => (repo as IndexedDbSpeakingRepository).close(),
  },
  { name: 'MemorySpeakingRepository', create: async () => new MemorySpeakingRepository() },
];

describe.each(factories)('$name contract', ({ create, dispose }) => {
  let repo: SpeakingRepository;

  beforeEach(async () => {
    repo = await create();
  });
  afterEach(() => dispose?.(repo));

  it('stores attempts and lists them newest first', async () => {
    await repo.putAttempt(attempt('a', 1000));
    await repo.putAttempt(attempt('b', 2000));
    expect((await repo.listAttempts()).map((item) => item.id)).toEqual(['b', 'a']);
    expect(await repo.getAttempt('a')).toEqual(attempt('a', 1000));
    expect(await repo.getAttempt('missing')).toBeNull();
  });

  it('updates an attempt atomically', async () => {
    await repo.putAttempt(attempt('a'));
    const updated = await repo.updateAttempt('a', (current) => ({
      ...current,
      exerciseResponses: [{ exerciseId: 'e1', answer: 'Yesterday I went.', revealed: true, updatedAt: 5 }],
    }));
    expect(updated?.exerciseResponses).toHaveLength(1);
    expect((await repo.getAttempt('a'))?.exerciseResponses[0]?.answer).toBe('Yesterday I went.');
    expect(await repo.updateAttempt('missing', (current) => current)).toBeNull();
  });

  it('stores recordings only when given, and deletes them separately', async () => {
    await repo.putAttempt(attempt('a'));
    expect(await repo.getRecording('a')).toBeNull();

    const saved = await repo.saveRecording('a', new Blob(['audio'], { type: 'audio/webm' }));
    expect(saved?.recording.stored).toBe(true);
    expect(await (await repo.getRecording('a'))?.text()).toBe('audio');

    const removed = await repo.deleteRecording('a');
    expect(removed?.recording.stored).toBe(false);
    expect(await repo.getRecording('a')).toBeNull();
    // The transcript and feedback survive deleting the audio.
    expect((await repo.getAttempt('a'))?.transcript.segments).toHaveLength(1);
  });

  it('saves an attempt and its recording together (M8)', async () => {
    await repo.putAttempt(attempt('a'), new Blob(['voice'], { type: 'audio/webm' }));
    expect((await repo.getAttempt('a'))?.recording.stored).toBe(true);
    expect(await (await repo.getRecording('a'))?.text()).toBe('voice');
    expect(await repo.listRecordingKeys()).toEqual(['a']);
  });

  it('never touches an existing recording when the attempt is updated without one', async () => {
    await repo.putAttempt(attempt('a'), new Blob(['voice']));
    const stored = await repo.getAttempt('a');
    if (!stored) throw new Error('missing');
    await repo.putAttempt({ ...stored, exerciseResponses: [] });
    expect(await (await repo.getRecording('a'))?.text()).toBe('voice');
  });

  it('refuses recordings over the cap and writes nothing', async () => {
    const huge = { size: MAX_STORED_RECORDING_BYTES + 1 } as Blob;
    await expect(repo.putAttempt(attempt('a'), huge)).rejects.toBeInstanceOf(StorageError);
    expect(await repo.getAttempt('a')).toBeNull();
  });

  it('reconciles the recording flag with what is stored, never deleting audio', async () => {
    await repo.putAttempt({ ...attempt('flagged'), recording: { stored: true, mimeType: 'audio/webm' } });
    expect(await repo.reconcileRecording('flagged')).toMatchObject({ present: false, repaired: 'flag-cleared', attempt: { recording: { stored: false } } });
    await repo.putAttempt(attempt('orphan'), new Blob(['voice']));
    const orphan = await repo.getAttempt('orphan');
    if (!orphan) throw new Error('missing');
    await repo.putAttempt({ ...orphan, recording: { ...orphan.recording, stored: false } });
    expect(await repo.reconcileRecording('orphan')).toMatchObject({ present: true, repaired: 'flag-set' });
    expect(await (await repo.getRecording('orphan'))?.text()).toBe('voice');
    expect(await repo.reconcileRecording('gone')).toBeNull();
  });

  it('deletes an attempt together with its recording', async () => {
    await repo.putAttempt(attempt('a'));
    await repo.putAttempt(attempt('b'));
    await repo.saveRecording('a', new Blob(['audio']));
    await repo.deleteAttempt('a');
    expect(await repo.getAttempt('a')).toBeNull();
    expect(await repo.getRecording('a')).toBeNull();
    expect((await repo.listAttempts()).map((item) => item.id)).toEqual(['b']);
  });

  it('stores and deletes custom topics', async () => {
    await repo.putTopic(topic('t1', 1));
    await repo.putTopic(topic('t2', 2));
    expect((await repo.listTopics()).map((item) => item.id)).toEqual(['t2', 't1']);
    await repo.deleteTopic('t1');
    expect((await repo.listTopics()).map((item) => item.id)).toEqual(['t2']);
  });
});

describe('IndexedDbSpeakingRepository persistence', () => {
  it('restores attempts after a reload', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbSpeakingRepository.open(factory);
    await first.putAttempt(attempt('a'));
    await first.saveRecording('a', new Blob(['audio']));
    first.close();

    const second = await IndexedDbSpeakingRepository.open(factory);
    expect((await second.getAttempt('a'))?.recording.stored).toBe(true);
    expect(await second.getRecording('a')).toBeInstanceOf(Blob);
    second.close();
  });

  it('keeps a saved recording across a reload (M8)', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbSpeakingRepository.open(factory);
    await first.putAttempt(attempt('a'), new Blob(['voice'], { type: 'audio/webm' }));
    first.close();
    const second = await IndexedDbSpeakingRepository.open(factory);
    expect(await second.reconcileRecording('a')).toMatchObject({ present: true, repaired: null, attempt: { recording: { stored: true } } });
    expect(await (await second.getRecording('a'))?.text()).toBe('voice');
    second.close();
  });

  it('writes nothing when the recording part fails', async () => {
    const repo = await IndexedDbSpeakingRepository.open(new IDBFactory());
    const broken = { size: 10, type: 'audio/webm', bad: () => undefined } as unknown as Blob;
    await expect(repo.putAttempt(attempt('a'), broken)).rejects.toBeInstanceOf(StorageError);
    expect(await repo.getAttempt('a')).toBeNull();
    repo.close();
  });

  it('rejects invalid attempts before writing', async () => {
    const repo = await IndexedDbSpeakingRepository.open(new IDBFactory());
    await expect(repo.putAttempt({ ...attempt('a'), targetDurationSeconds: 45 as never })).rejects.toThrow();
    expect(await repo.getAttempt('a')).toBeNull();
    repo.close();
  });
});

describe('database migration v1 → v2', () => {
  it('keeps M1 listening and M2 transcript records intact and adds the speaking stores', async () => {
    const factory = new IDBFactory();

    // Recreate the database exactly as the M1/M2 build left it (version 1).
    const v1 = await openDatabase({
      name: APP_DB_NAME,
      version: 1,
      factory,
      upgrade: (database) => {
        database.createObjectStore('sessions', { keyPath: 'id' });
        database.createObjectStore('transcripts', { keyPath: 'sessionId' });
        database.createObjectStore('media', { keyPath: 'sessionId' });
        database.createObjectStore('dictation', { keyPath: ['sessionId', 'cueId'] });
      },
    });
    const session = {
      id: 's1',
      version: 1,
      language: 'en',
      title: 'Lecture',
      source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      transcript: {
        fileName: 'lecture.mp3',
        format: 'whisper',
        cueCount: 1,
        skippedBlocks: 0,
        generated: { provider: 'groq', model: 'whisper-large-v3-turbo', requestedLanguage: 'en', detectedLanguage: 'English', createdAt: 1 },
      },
      playback: { positionSeconds: 12, playbackRate: 0.9 },
      loop: { startMs: 1000, endMs: 3000 },
      durationSeconds: 30,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    };
    const transcript = {
      sessionId: 's1',
      cues: [{ id: '1', startMs: 0, endMs: 1000, text: 'Hello there.' }],
      words: [{ text: 'Hello', startMs: 0, endMs: 400 }],
      segments: [{ id: '1', startMs: 0, endMs: 1000, text: 'Hello there.', avgLogprob: -0.2, noSpeechProb: 0.01 }],
    };
    const dictation = {
      sessionId: 's1',
      cueId: '1',
      referenceText: 'Hello there.',
      attempts: [{ submittedAt: 2, answer: 'hello there', wordErrorRate: 0, accuracy: 1, referenceWords: 2 }],
      updatedAt: 2,
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = v1.transaction(['sessions', 'transcripts', 'dictation'], 'readwrite');
      transaction.objectStore('sessions').put(session);
      transaction.objectStore('transcripts').put(transcript);
      transaction.objectStore('dictation').put(dictation);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v1.close();

    // Opening with the M3 build upgrades to v2.
    const listening = await IndexedDbListeningRepository.open(factory);
    expect(await listening.getSession('s1')).toEqual(session);
    expect(await listening.getTranscript('s1')).toEqual(transcript);
    expect(await listening.listDictation('s1')).toEqual([dictation]);
    listening.close();

    const raw = await openAppDatabase(factory);
    expect(raw.version).toBe(APP_DB_VERSION);
    expect([...raw.objectStoreNames]).toEqual(
      expect.arrayContaining(['dictation', 'media', 'sessions', 'speakingAttempts', 'speakingRecordings', 'speakingTopics', 'transcripts']),
    );
    raw.close();

    const speaking = await IndexedDbSpeakingRepository.open(factory);
    await speaking.putAttempt(attempt('a'));
    expect(await speaking.listAttempts()).toHaveLength(1);
    speaking.close();
  });
});
