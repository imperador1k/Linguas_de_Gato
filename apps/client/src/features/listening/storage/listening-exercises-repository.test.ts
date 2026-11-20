import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { withListeningAnswer, type ListeningExerciseSet, type ListeningSession, type SubtitleCue } from '@ldg/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_DB_NAME, APP_DB_VERSION, openAppDatabase } from '@/lib/storage/app-database';
import { openDatabase } from '@/lib/storage/indexed-db';
import { IndexedDbSpeakingRepository } from '@/features/speaking/storage/indexed-db-speaking-repository';
import { IndexedDbListeningRepository } from './indexed-db-listening-repository';
import type { ListeningRepository } from './listening-repository';
import { newYouTubeSession } from './listening-storage';
import { MemoryListeningRepository } from './memory-listening-repository';

const cues: SubtitleCue[] = [{ id: '1', startMs: 0, endMs: 4000, text: 'The council turned three car parks into gardens.' }];

function exerciseSet(id: string, sessionId: string, createdAt = 10): ListeningExerciseSet {
  return {
    id,
    version: 1,
    sessionId,
    level: 'C1',
    types: ['detail'],
    questions: [
      {
        id: 'q1',
        format: 'multiple_choice',
        type: 'detail',
        difficulty: 'B2',
        question: 'How many car parks were converted?',
        options: ['Two', 'Three', 'Four'],
        correctOptionIndex: 1,
        explanation: 'Three were turned into gardens.',
        evidenceQuote: 'turned three car parks into gardens',
        segmentIds: ['s1'],
        startMs: 0,
        endMs: 4000,
      },
      {
        id: 'q2',
        format: 'short_answer',
        type: 'detail',
        difficulty: 'C1',
        question: 'What did the car parks become?',
        acceptedAnswers: ['gardens'],
        explanation: 'They became gardens.',
        evidenceQuote: 'car parks into gardens',
        segmentIds: ['s1'],
        startMs: 0,
        endMs: 4000,
      },
    ],
    discarded: 1,
    transcriptFingerprint: '1-abcdef12',
    truncated: false,
    model: 'openai/gpt-oss-120b',
    answers: [],
    submittedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

const session = (id: string): ListeningSession => ({ ...newYouTubeSession({ videoId: 'dQw4w9WgXcQ' }, 1000), id });

const factories = [
  {
    name: 'IndexedDbListeningRepository',
    create: (): Promise<ListeningRepository> => IndexedDbListeningRepository.open(new IDBFactory()),
    dispose: (repo: ListeningRepository) => (repo as IndexedDbListeningRepository).close(),
  },
  { name: 'MemoryListeningRepository', create: async (): Promise<ListeningRepository> => new MemoryListeningRepository(), dispose: () => undefined },
];

describe.each(factories)('$name exercise sets', ({ create, dispose }) => {
  let repo: ListeningRepository;
  beforeEach(async () => {
    repo = await create();
  });
  afterEach(() => dispose(repo));

  it('stores, lists newest first per session, and deletes sets', async () => {
    await repo.createSession(session('a'));
    await repo.createSession(session('b'));
    await repo.putExerciseSet(exerciseSet('old', 'a', 10));
    await repo.putExerciseSet(exerciseSet('new', 'a', 20));
    await repo.putExerciseSet(exerciseSet('other', 'b', 30));

    expect((await repo.listExerciseSets('a')).map((set) => set.id)).toEqual(['new', 'old']);
    expect(await repo.getExerciseSet('other')).toEqual(exerciseSet('other', 'b', 30));

    await repo.deleteExerciseSet('old');
    expect((await repo.listExerciseSets('a')).map((set) => set.id)).toEqual(['new']);
    expect(await repo.getExerciseSet('old')).toBeNull();
  });

  it('saves answers and results', async () => {
    await repo.createSession(session('a'));
    let set = exerciseSet('s', 'a');
    set = withListeningAnswer(set, { format: 'multiple_choice', questionId: 'q1', selectedIndex: 1 }, 11);
    set = withListeningAnswer(set, { format: 'short_answer', questionId: 'q2', text: 'Gardens', selfAssessment: null }, 12);
    await repo.putExerciseSet({ ...set, submittedAt: 13 });
    const stored = await repo.getExerciseSet('s');
    expect(stored?.answers).toHaveLength(2);
    expect(stored?.submittedAt).toBe(13);
  });

  it('rejects invalid sets before writing', async () => {
    await expect(repo.putExerciseSet({ ...exerciseSet('bad', 'a'), questions: [] })).rejects.toThrow();
    expect(await repo.getExerciseSet('bad')).toBeNull();
  });

  it('keeps sets (and answers) when the transcript is replaced', async () => {
    const owner = session('a');
    await repo.createSession(owner);
    await repo.putExerciseSet(exerciseSet('s', 'a'));
    await repo.replaceTranscript({ ...owner, transcript: { fileName: 'x.srt', format: 'srt', cueCount: 1, skippedBlocks: 0 } }, { cues });
    expect(await repo.listExerciseSets('a')).toHaveLength(1);
  });

  it('deletes a session\'s sets with the session, leaving other sessions alone', async () => {
    await repo.createSession(session('a'));
    await repo.createSession(session('b'));
    await repo.putExerciseSet(exerciseSet('a1', 'a'));
    await repo.putExerciseSet(exerciseSet('a2', 'a'));
    await repo.putExerciseSet(exerciseSet('b1', 'b'));
    await repo.deleteSession('a');
    expect(await repo.listExerciseSets('a')).toEqual([]);
    expect(await repo.getExerciseSet('a1')).toBeNull();
    expect(await repo.listExerciseSets('b')).toHaveLength(1);
  });
});

describe('IndexedDB listening exercise sets', () => {
  it('survive a reload and skip corrupt records', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbListeningRepository.open(factory);
    await first.putExerciseSet(exerciseSet('ok', 'a'));
    first.close();

    const raw = await openAppDatabase(factory);
    await new Promise<void>((resolve, reject) => {
      const transaction = raw.transaction('listeningExercises', 'readwrite');
      transaction.objectStore('listeningExercises').put({ id: 'corrupt', sessionId: 'a', questions: 'nope' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    raw.close();

    const second = await IndexedDbListeningRepository.open(factory);
    expect((await second.listExerciseSets('a')).map((set) => set.id)).toEqual(['ok']);
    second.close();
  });
});

describe('database migration v2 → v3', () => {
  it('keeps M1/M2 listening and M3 speaking records intact and adds the exercise store', async () => {
    const factory = new IDBFactory();

    // Recreate the database exactly as the M3 build left it (version 2).
    const v2 = await openDatabase({
      name: APP_DB_NAME,
      version: 2,
      factory,
      upgrade: (database) => {
        database.createObjectStore('sessions', { keyPath: 'id' });
        database.createObjectStore('transcripts', { keyPath: 'sessionId' });
        database.createObjectStore('media', { keyPath: 'sessionId' });
        database.createObjectStore('dictation', { keyPath: ['sessionId', 'cueId'] });
        database.createObjectStore('speakingAttempts', { keyPath: 'id' });
        database.createObjectStore('speakingRecordings', { keyPath: 'attemptId' });
        database.createObjectStore('speakingTopics', { keyPath: 'id' });
      },
    });
    const listeningSession = session('s1');
    const transcript = { sessionId: 's1', cues };
    const dictation = {
      sessionId: 's1',
      cueId: '1',
      referenceText: cues[0]!.text,
      attempts: [{ submittedAt: 2, answer: 'the council', wordErrorRate: 0.5, accuracy: 0.5, referenceWords: 8 }],
      updatedAt: 2,
    };
    // An M3 manual topic: no `generated` field.
    const topic = {
      id: 'topic-1',
      createdAt: 5,
      prompt: { source: 'custom', promptId: null, title: 'My topic', instructions: 'Talk about it.', points: [], category: 'everyday', level: null },
    };
    const recording = { attemptId: 'attempt-1', blob: new Blob(['audio'], { type: 'audio/webm' }), mimeType: 'audio/webm' };
    await new Promise<void>((resolve, reject) => {
      const transaction = v2.transaction(['sessions', 'transcripts', 'dictation', 'speakingTopics', 'speakingRecordings'], 'readwrite');
      transaction.objectStore('sessions').put(listeningSession);
      transaction.objectStore('transcripts').put(transcript);
      transaction.objectStore('dictation').put(dictation);
      transaction.objectStore('speakingTopics').put(topic);
      transaction.objectStore('speakingRecordings').put(recording);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v2.close();

    const listening = await IndexedDbListeningRepository.open(factory);
    expect(await listening.getSession('s1')).toEqual(listeningSession);
    expect(await listening.getTranscript('s1')).toEqual(transcript);
    expect(await listening.listDictation('s1')).toEqual([dictation]);
    expect(await listening.listExerciseSets('s1')).toEqual([]);
    await listening.putExerciseSet(exerciseSet('set-1', 's1'));
    expect(await listening.listExerciseSets('s1')).toHaveLength(1);
    listening.close();

    const speaking = await IndexedDbSpeakingRepository.open(factory);
    expect(await speaking.listTopics()).toEqual([topic]);
    expect(await speaking.getRecording('attempt-1')).not.toBeNull();
    speaking.close();

    const raw = await openAppDatabase(factory);
    expect(raw.version).toBe(APP_DB_VERSION);
    expect(raw.version).toBe(3);
    expect([...raw.transaction('listeningExercises', 'readonly').objectStore('listeningExercises').indexNames]).toEqual(['bySession']);
    raw.close();
  });
});
