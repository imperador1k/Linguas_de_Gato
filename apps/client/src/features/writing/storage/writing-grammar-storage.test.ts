import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  checkGrammarSet,
  retryGrammarSet,
  verifyGrammarQuestions,
  withGrammarAnswer,
  type GrammarSetRecord,
  type WritingAttempt,
  type WritingDraft,
  type WritingTask,
  type WritingTaskRecord,
} from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { IndexedDbListeningRepository } from '@/features/listening/storage/indexed-db-listening-repository';
import { IndexedDbSpeakingRepository } from '@/features/speaking/storage/indexed-db-speaking-repository';
import { indexedDbGrammarRepository, memoryGrammarRepository } from '@/features/grammar/storage/grammar-repository';
import { APP_DB_NAME, APP_DB_VERSION, openAppDatabase, WRITING_ATTEMPTS_BY_TASK } from '@/lib/storage/app-database';
import { openDatabase } from '@/lib/storage/indexed-db';
import { deleteWritingTask, indexedDbWritingRepository, memoryWritingRepository, type WritingRepository } from './writing-repository';

const TASK: WritingTask = {
  title: 'A complaint about a late delivery',
  instructions: 'Write a formal email to the company.',
  context: 'Your new sofa arrived three weeks late and damaged.',
  sourceText: null,
  wordCount: { target: 200, min: 180, max: 220 },
  requiredElements: ['Explain the problem', 'Say what you want'],
  evaluationCriteria: ['Register', 'Clarity'],
  objectives: ['Formal register'],
  languageFeatures: ['I am writing to complain about'],
  level: 'B2',
  format: 'formal_email',
  register: 'formal',
};

const taskRecord = (id: string, updatedAt = 1): WritingTaskRecord => ({ id, version: 1, task: TASK, category: 'everyday', model: 'm', createdAt: 1, updatedAt });
const draft = (taskId: string, text: string): WritingDraft => ({ taskId, version: 1, text, timerElapsedMs: 0, createdAt: 1, updatedAt: 2 });
const attempt = (id: string, taskId: string): WritingAttempt => ({
  id,
  version: 1,
  taskId,
  task: TASK,
  text: 'Dear Sir or Madam, I am writing to complain.',
  wordCount: 8,
  timerElapsedMs: 0,
  assessment: null,
  improvement: null,
  submittedAt: 3,
  updatedAt: 3,
});

const grammarRaw = {
  type: 'gap_fill',
  prompt: 'Had she ___ (know), she would have helped.',
  sourceSentence: null,
  keyword: null,
  words: [],
  options: [],
  correctOptionIndex: null,
  acceptedAnswers: ['known'],
  explanation: 'Inverted third conditional.',
  rule: 'Had + subject + past participle.',
  distractorExplanations: [],
};
const grammarSet = (id: string): GrammarSetRecord => ({
  id,
  version: 1,
  set: { title: 'Inversion', instructions: 'Complete.', level: 'C1', topic: 'inversion', questions: verifyGrammarQuestions([grammarRaw], { types: ['gap_fill'], maxQuestions: 4 }).questions },
  types: ['gap_fill'],
  discarded: 0,
  model: 'm',
  answers: [],
  checkedAt: null,
  reviews: [],
  history: [],
  createdAt: 1,
  updatedAt: 1,
});

const writingFactories = [
  { name: 'IndexedDB', create: async () => indexedDbWritingRepository(await openAppDatabase(new IDBFactory())) },
  { name: 'memory', create: async () => memoryWritingRepository() },
];

describe.each(writingFactories)('writing repository ($name)', ({ create }) => {
  it('stores tasks, keeps one draft per task and lists attempts by task', async () => {
    const repo: WritingRepository = await create();
    await repo.tasks.put(taskRecord('t1'));
    await repo.drafts.put(draft('t1', 'First version'));
    await repo.drafts.put(draft('t1', 'Second version'));
    expect(await repo.drafts.list()).toHaveLength(1);
    expect((await repo.drafts.get('t1'))?.text).toBe('Second version');

    await repo.attempts.put(attempt('a1', 't1'));
    await repo.attempts.put(attempt('a2', 't1'));
    await repo.attempts.put(attempt('a3', 't2'));
    expect((await repo.attempts.listBy(WRITING_ATTEMPTS_BY_TASK, 't1')).map((row) => row.id).sort()).toEqual(['a1', 'a2']);
  });

  it('updates atomically and returns null for missing records', async () => {
    const repo = await create();
    await repo.attempts.put(attempt('a1', 't1'));
    const updated = await repo.attempts.update('a1', (current) => ({ ...current, improvement: { model: 'm', createdAt: 4, improvedText: 'Better.', notes: ['n'] }, updatedAt: 4 }));
    expect(updated?.improvement?.improvedText).toBe('Better.');
    expect(await repo.attempts.update('missing', (current) => current)).toBeNull();
  });

  it('deletes a task with its draft but keeps submitted attempts', async () => {
    const repo = await create();
    await repo.tasks.put(taskRecord('t1'));
    await repo.drafts.put(draft('t1', 'Draft'));
    await repo.attempts.put(attempt('a1', 't1'));
    await deleteWritingTask(repo, 't1');
    expect(await repo.tasks.get('t1')).toBeNull();
    expect(await repo.drafts.get('t1')).toBeNull();
    expect(await repo.attempts.get('a1')).not.toBeNull();
    await repo.attempts.delete('a1');
    expect(await repo.attempts.get('a1')).toBeNull();
  });

  it('rejects invalid records before writing', async () => {
    const repo = await create();
    await expect(repo.drafts.put({ ...draft('t1', 'x'), text: 'x'.repeat(13_000) })).rejects.toThrow();
    await expect(repo.tasks.put({ ...taskRecord('t1'), task: { ...TASK, wordCount: { target: 10, min: 50, max: 60 } } })).rejects.toThrow();
    expect(await repo.drafts.get('t1')).toBeNull();
    expect(await repo.tasks.get('t1')).toBeNull();
  });
});

describe.each([
  { name: 'IndexedDB', create: async () => indexedDbGrammarRepository(await openAppDatabase(new IDBFactory())) },
  { name: 'memory', create: async () => memoryGrammarRepository() },
])('grammar repository ($name)', ({ create }) => {
  it('stores answers, checked rounds and retries', async () => {
    const repo = await create();
    await repo.sets.put(grammarSet('g1'));
    await repo.sets.update('g1', (current) => withGrammarAnswer(current, { kind: 'text', questionId: 'q1', text: 'known' }, 2));
    await repo.sets.update('g1', (current) => checkGrammarSet(current, 3));
    let stored = await repo.sets.get('g1');
    expect(stored?.history).toEqual([{ checkedAt: 3, correct: 1, total: 1 }]);
    await repo.sets.update('g1', (current) => retryGrammarSet(current, 4));
    stored = await repo.sets.get('g1');
    expect(stored?.answers).toEqual([]);
    expect(stored?.history).toHaveLength(1);
    await repo.sets.delete('g1');
    expect(await repo.sets.list()).toEqual([]);
  });
});

describe('IndexedDB M4 persistence', () => {
  it('restores a draft after a reload and skips corrupt records', async () => {
    const factory = new IDBFactory();
    const first = await openAppDatabase(factory);
    await indexedDbWritingRepository(first).drafts.put(draft('t1', 'Unfinished thoughts about cars'));
    await new Promise<void>((resolve, reject) => {
      const transaction = first.transaction('writingDrafts', 'readwrite');
      transaction.objectStore('writingDrafts').put({ taskId: 'corrupt', text: 42 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    first.close();

    const second = await openAppDatabase(factory);
    const repo = indexedDbWritingRepository(second);
    expect((await repo.drafts.get('t1'))?.text).toBe('Unfinished thoughts about cars');
    expect(await repo.drafts.get('corrupt')).toBeNull();
    expect((await repo.drafts.list()).map((row) => row.taskId)).toEqual(['t1']);
    second.close();
  });
});

describe('database migration v3 → v4', () => {
  it('keeps M1/M2 listening, M3 speaking and listening-exercise records and adds the M4 stores', async () => {
    const factory = new IDBFactory();
    const v3 = await openDatabase({
      name: APP_DB_NAME,
      version: 3,
      factory,
      upgrade: (database) => {
        database.createObjectStore('sessions', { keyPath: 'id' });
        database.createObjectStore('transcripts', { keyPath: 'sessionId' });
        database.createObjectStore('media', { keyPath: 'sessionId' });
        database.createObjectStore('dictation', { keyPath: ['sessionId', 'cueId'] });
        database.createObjectStore('speakingAttempts', { keyPath: 'id' });
        database.createObjectStore('speakingRecordings', { keyPath: 'attemptId' });
        database.createObjectStore('speakingTopics', { keyPath: 'id' });
        database.createObjectStore('listeningExercises', { keyPath: 'id' }).createIndex('bySession', 'sessionId', { unique: false });
      },
    });
    const session = {
      id: 's1',
      version: 1,
      language: 'en',
      title: 'Lecture',
      source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      transcript: { fileName: 'lecture.srt', format: 'srt', cueCount: 1, skippedBlocks: 0 },
      playback: { positionSeconds: 3, playbackRate: 1 },
      loop: null,
      durationSeconds: 30,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    };
    const transcript = { sessionId: 's1', cues: [{ id: '1', startMs: 0, endMs: 1000, text: 'Hello there.' }] };
    const dictation = { sessionId: 's1', cueId: '1', referenceText: 'Hello there.', attempts: [{ submittedAt: 2, answer: 'hello there', wordErrorRate: 0, accuracy: 1, referenceWords: 2 }], updatedAt: 2 };
    const topic = {
      id: 'topic-1',
      createdAt: 5,
      prompt: { source: 'custom', promptId: null, title: 'My topic', instructions: 'Talk about it.', points: [], category: 'everyday', level: null },
    };
    const exerciseSet = {
      id: 'set-1',
      version: 1,
      sessionId: 's1',
      level: 'C1',
      types: ['detail'],
      questions: [
        { id: 'q1', format: 'short_answer', type: 'detail', difficulty: 'B2', question: 'Who?', acceptedAnswers: ['Them'], explanation: 'E.', evidenceQuote: 'Hello there friend', segmentIds: ['s1'], startMs: 0, endMs: 1000 },
      ],
      discarded: 0,
      transcriptFingerprint: '1-abcdef12',
      truncated: false,
      model: 'm',
      answers: [],
      submittedAt: null,
      createdAt: 6,
      updatedAt: 6,
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = v3.transaction(['sessions', 'transcripts', 'dictation', 'speakingTopics', 'listeningExercises'], 'readwrite');
      transaction.objectStore('sessions').put(session);
      transaction.objectStore('transcripts').put(transcript);
      transaction.objectStore('dictation').put(dictation);
      transaction.objectStore('speakingTopics').put(topic);
      transaction.objectStore('listeningExercises').put(exerciseSet);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v3.close();

    const listening = await IndexedDbListeningRepository.open(factory);
    expect(await listening.getSession('s1')).toEqual(session);
    expect(await listening.getTranscript('s1')).toEqual(transcript);
    expect(await listening.listDictation('s1')).toEqual([dictation]);
    expect(await listening.listExerciseSets('s1')).toEqual([exerciseSet]);
    listening.close();

    const speaking = await IndexedDbSpeakingRepository.open(factory);
    expect(await speaking.listTopics()).toEqual([topic]);
    speaking.close();

    const database = await openAppDatabase(factory);
    // Later versions upgrade further; the v4 stores must exist whatever the current version is.
    expect(database.version).toBe(APP_DB_VERSION);
    expect([...database.objectStoreNames]).toEqual(expect.arrayContaining(['writingTasks', 'writingDrafts', 'writingAttempts', 'grammarSets']));
    expect([...database.transaction('writingAttempts').objectStore('writingAttempts').indexNames]).toEqual(['byTask']);
    const writing = indexedDbWritingRepository(database);
    await writing.tasks.put(taskRecord('t1'));
    expect(await writing.tasks.list()).toHaveLength(1);
    database.close();
  });
});
