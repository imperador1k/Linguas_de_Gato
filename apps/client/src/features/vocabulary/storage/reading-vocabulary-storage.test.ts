import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  scheduleReview,
  type ModelVocabularyLookup,
  type ReadingQuestionSet,
  type ReadingTextRecord,
  type VocabularyPracticeSet,
} from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { indexedDbGrammarRepository } from '@/features/grammar/storage/grammar-repository';
import { IndexedDbListeningRepository } from '@/features/listening/storage/indexed-db-listening-repository';
import { deleteReadingText, indexedDbReadingRepository, listQuestionSets, memoryReadingRepository } from '@/features/reading/storage/reading-repository';
import { IndexedDbSpeakingRepository } from '@/features/speaking/storage/indexed-db-speaking-repository';
import { indexedDbWritingRepository } from '@/features/writing/storage/writing-repository';
import { APP_DB_NAME, APP_DB_VERSION, openAppDatabase } from '@/lib/storage/app-database';
import { openDatabase } from '@/lib/storage/indexed-db';
import { findEntry, indexedDbVocabularyRepository, memoryVocabularyRepository, saveToCollection } from './vocabulary-repository';

const PARAGRAPHS = [
  'For decades, the corner bookshop seemed doomed. Online retailers offered lower prices.',
  'Rents in city centres have doubled in a decade, and some owners admit they are only breaking even.',
];

const text = (id: string): ReadingTextRecord => ({
  id,
  version: 1,
  language: 'en',
  source: 'imported',
  title: 'Bookshops',
  paragraphs: PARAGRAPHS,
  wordCount: 30,
  estimatedMinutes: 1,
  level: null,
  textType: null,
  category: null,
  objectives: [],
  vocabulary: [],
  model: null,
  progress: { furthestParagraph: 0, completedAt: null, lastOpenedAt: 1 },
  createdAt: 1,
  updatedAt: 1,
});

const questionSet = (id: string, textId: string): ReadingQuestionSet => ({
  id,
  version: 1,
  textId,
  level: 'C1',
  types: ['detail'],
  questions: [
    {
      id: 'q1',
      format: 'short_answer',
      type: 'detail',
      question: 'What has happened to rents?',
      acceptedAnswers: ['They have doubled'],
      explanation: 'Rents doubled in a decade.',
      evidenceQuote: 'Rents in city centres have doubled',
      paragraphIndex: 1,
      start: 0,
      end: 34,
    },
  ],
  discarded: 0,
  model: 'm',
  answers: [],
  submittedAt: null,
  createdAt: 2,
  updatedAt: 2,
});

const lookup: ModelVocabularyLookup = {
  expression: 'breaking even',
  lemma: 'break even',
  kind: 'phrasal_verb',
  partOfSpeech: 'phrasal verb',
  contextualMeaning: 'earning only enough to cover costs',
  dictionaryMeaning: 'to make neither a profit nor a loss',
  contextEvidence: 'only breaking even',
  collocations: ['just break even'],
  synonyms: ['cover your costs'],
  antonyms: [],
  register: 'neutral',
  examples: ['The café broke even.', 'We need 500 sales to break even.'],
  patterns: ['break even on sth'],
  cefrEstimate: 'C1',
  portugueseExplanation: null,
};
const context = { sentence: PARAGRAPHS[1]!, source: { kind: 'reading' as const, textId: 't1', title: 'Bookshops', paragraphIndex: 1 } };

describe.each([
  { name: 'IndexedDB', create: async () => indexedDbReadingRepository(await openAppDatabase(new IDBFactory())) },
  { name: 'memory', create: async () => memoryReadingRepository() },
])('reading repository ($name)', ({ create }) => {
  it('stores texts with progress and deletes a text with its question sets', async () => {
    const repo = await create();
    await repo.texts.put(text('t1'));
    await repo.texts.put(text('t2'));
    await repo.questionSets.put(questionSet('s1', 't1'));
    await repo.questionSets.put({ ...questionSet('s2', 't1'), createdAt: 5 });
    await repo.questionSets.put(questionSet('s3', 't2'));
    expect((await listQuestionSets(repo, 't1')).map((set) => set.id)).toEqual(['s2', 's1']);

    await repo.texts.update('t1', (current) => ({ ...current, progress: { ...current.progress, furthestParagraph: 1, completedAt: 9 } }));
    expect((await repo.texts.get('t1'))?.progress.completedAt).toBe(9);

    await deleteReadingText(repo, 't1');
    expect(await repo.texts.get('t1')).toBeNull();
    expect(await listQuestionSets(repo, 't1')).toEqual([]);
    expect(await listQuestionSets(repo, 't2')).toHaveLength(1);
  });

  it('rejects invalid texts before writing', async () => {
    const repo = await create();
    await expect(repo.texts.put({ ...text('bad'), paragraphs: [] })).rejects.toThrow();
    expect(await repo.texts.get('bad')).toBeNull();
  });
});

describe.each([
  { name: 'IndexedDB', create: async () => indexedDbVocabularyRepository(await openAppDatabase(new IDBFactory())) },
  { name: 'memory', create: async () => memoryVocabularyRepository() },
])('vocabulary repository ($name)', ({ create }) => {
  it('saves without duplicates, adds new meanings to the same entry and finds it by lemma', async () => {
    const repo = await create();
    const first = await saveToCollection(repo, lookup, context, 100);
    expect(first.outcome).toBe('created');
    const again = await saveToCollection(repo, { ...lookup, expression: 'broke even' }, { ...context, sentence: 'They broke even.' }, 200);
    expect(again.outcome).toBe('already_saved');
    const other = await saveToCollection(repo, { ...lookup, dictionaryMeaning: '(of a wave) to collapse evenly', contextualMeaning: 'waves collapsing' }, { sentence: 'Waves were breaking even.', source: { kind: 'manual' } }, 300);
    expect(other.outcome).toBe('added_sense');
    expect(await repo.entries.list()).toHaveLength(1);
    expect((await findEntry(repo, 'Break  Even'))?.senses).toHaveLength(2);
  });

  it('updates review records and deletes entries', async () => {
    const repo = await create();
    const { entry } = await saveToCollection(repo, lookup, context, 100);
    await repo.entries.update(entry.id, (current) => ({ ...current, review: scheduleReview(current.review, 'good', 200), updatedAt: 200 }));
    expect((await repo.entries.get(entry.id))?.review).toMatchObject({ status: 'learning', step: 1, lastReviewedAt: 200 });
    await repo.entries.delete(entry.id);
    expect(await repo.entries.list()).toEqual([]);
  });

  it('stores practice sets', async () => {
    const repo = await create();
    const set: VocabularyPracticeSet = {
      id: 'p1',
      version: 1,
      entryIds: ['e1'],
      types: ['own_sentence'],
      questions: [{ id: 'q1', type: 'own_sentence', itemId: 'e1', prompt: 'Write a sentence with "break even".', explanation: 'Use it about money.' }],
      shuffles: {},
      discarded: 0,
      model: 'm',
      answers: [{ kind: 'text', questionId: 'q1', text: 'The shop broke even.' }],
      reviews: [],
      checkedAt: null,
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    await repo.practiceSets.put(set);
    expect((await repo.practiceSets.get('p1'))?.answers).toHaveLength(1);
    await expect(repo.practiceSets.put({ ...set, questions: [] })).rejects.toThrow();
  });
});

describe('IndexedDB M5 persistence', () => {
  it('keeps the collection after a reload and skips corrupt entries', async () => {
    const factory = new IDBFactory();
    const first = await openAppDatabase(factory);
    await saveToCollection(indexedDbVocabularyRepository(first), lookup, context, 100);
    await new Promise<void>((resolve, reject) => {
      const transaction = first.transaction('vocabularyEntries', 'readwrite');
      transaction.objectStore('vocabularyEntries').put({ id: 'corrupt', key: 'x', senses: 'nope' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    first.close();
    const second = await openAppDatabase(factory);
    const entries = await indexedDbVocabularyRepository(second).entries.list();
    expect(entries.map((entry) => entry.key)).toEqual(['break even']);
    second.close();
  });
});

describe('database migration v4 → v5', () => {
  it('keeps Listening, Speaking, Writing and Grammar records and adds the M5 stores', async () => {
    const factory = new IDBFactory();
    const v4 = await openDatabase({
      name: APP_DB_NAME,
      version: 4,
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
        database.createObjectStore('writingTasks', { keyPath: 'id' });
        database.createObjectStore('writingDrafts', { keyPath: 'taskId' });
        database.createObjectStore('writingAttempts', { keyPath: 'id' }).createIndex('byTask', 'taskId', { unique: false });
        database.createObjectStore('grammarSets', { keyPath: 'id' });
      },
    });

    const session = {
      id: 's1',
      version: 1,
      language: 'en',
      title: 'Lecture',
      source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      transcript: { fileName: 'l.srt', format: 'srt', cueCount: 1, skippedBlocks: 0 },
      playback: { positionSeconds: 3, playbackRate: 1 },
      loop: null,
      durationSeconds: 30,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    };
    const transcript = { sessionId: 's1', cues: [{ id: '1', startMs: 0, endMs: 1000, text: 'Hello there.' }] };
    const dictation = { sessionId: 's1', cueId: '1', referenceText: 'Hello there.', attempts: [{ submittedAt: 2, answer: 'hello there', wordErrorRate: 0, accuracy: 1, referenceWords: 2 }], updatedAt: 2 };
    const topic = { id: 'topic-1', createdAt: 5, prompt: { source: 'custom', promptId: null, title: 'My topic', instructions: 'Talk about it.', points: [], category: 'everyday', level: null } };
    const task = {
      title: 'A complaint',
      instructions: 'Write a formal email.',
      context: 'Your sofa arrived late.',
      sourceText: null,
      wordCount: { target: 200, min: 180, max: 220 },
      requiredElements: ['Explain the problem'],
      evaluationCriteria: ['Register', 'Clarity'],
      objectives: ['Formal register'],
      languageFeatures: [],
      level: 'B2',
      format: 'formal_email',
      register: 'formal',
    };
    const writingTask = { id: 'w1', version: 1, task, category: 'everyday', model: 'm', createdAt: 1, updatedAt: 1 };
    const draft = { taskId: 'w1', version: 1, text: 'Dear Sir or Madam,', timerElapsedMs: 0, createdAt: 1, updatedAt: 2 };
    const grammarSet = {
      id: 'g1',
      version: 1,
      set: {
        title: 'Inversion',
        instructions: 'Complete.',
        level: 'C1',
        topic: 'inversion',
        questions: [{ id: 'q1', type: 'gap_fill', prompt: 'Had she ___ (know), she would have helped.', explanation: 'Inverted conditional.', rule: 'Had + subject + past participle.', acceptedAnswers: ['known'] }],
      },
      types: ['gap_fill'],
      discarded: 0,
      model: 'm',
      answers: [{ kind: 'text', questionId: 'q1', text: 'known' }],
      checkedAt: 3,
      reviews: [],
      history: [{ checkedAt: 3, correct: 1, total: 1 }],
      createdAt: 1,
      updatedAt: 3,
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = v4.transaction(['sessions', 'transcripts', 'dictation', 'speakingTopics', 'writingTasks', 'writingDrafts', 'grammarSets'], 'readwrite');
      transaction.objectStore('sessions').put(session);
      transaction.objectStore('transcripts').put(transcript);
      transaction.objectStore('dictation').put(dictation);
      transaction.objectStore('speakingTopics').put(topic);
      transaction.objectStore('writingTasks').put(writingTask);
      transaction.objectStore('writingDrafts').put(draft);
      transaction.objectStore('grammarSets').put(grammarSet);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v4.close();

    const listening = await IndexedDbListeningRepository.open(factory);
    expect(await listening.getSession('s1')).toEqual(session);
    expect(await listening.getTranscript('s1')).toEqual(transcript);
    expect(await listening.listDictation('s1')).toEqual([dictation]);
    listening.close();

    const speaking = await IndexedDbSpeakingRepository.open(factory);
    expect(await speaking.listTopics()).toEqual([topic]);
    speaking.close();

    const database = await openAppDatabase(factory);
    expect(database.version).toBe(APP_DB_VERSION);
    expect(database.version).toBeGreaterThanOrEqual(5);
    const writing = indexedDbWritingRepository(database);
    expect(await writing.tasks.get('w1')).toEqual(writingTask);
    expect(await writing.drafts.get('w1')).toEqual(draft);
    expect(await indexedDbGrammarRepository(database).sets.get('g1')).toEqual(grammarSet);
    expect([...database.objectStoreNames]).toEqual(expect.arrayContaining(['readingTexts', 'readingQuestionSets', 'vocabularyEntries', 'vocabularyPracticeSets']));
    expect([...database.transaction('readingQuestionSets').objectStore('readingQuestionSets').indexNames]).toEqual(['byText']);
    expect([...database.transaction('vocabularyEntries').objectStore('vocabularyEntries').indexNames]).toEqual(['byKey']);
    await indexedDbReadingRepository(database).texts.put(text('t1'));
    expect(await indexedDbReadingRepository(database).texts.list()).toHaveLength(1);
    database.close();
  });
});
