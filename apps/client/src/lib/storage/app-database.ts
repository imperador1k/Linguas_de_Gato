import { openDatabase } from './indexed-db';

/**
 * The single IndexedDB database of the app, and its migrations. Every feature
 * repository opens it through here, so there is exactly one place that knows
 * the schema version.
 *
 * Version history (never edit a released step; add a new one):
 * - v1 (M1): sessions, transcripts, media, dictation. M2 added optional fields
 *   to transcript records only (no schema change).
 * - v2 (M3): speakingAttempts, speakingRecordings, speakingTopics. Existing
 *   stores and their records are left untouched.
 * - v3 (AI exercise generation): listeningExercises, indexed by session.
 *   Generated speaking topics reuse speakingTopics (an optional field, no
 *   schema change). Existing stores and their records are left untouched.
 * - v4 (M4 Writing & Grammar): writingTasks, writingDrafts (one per task),
 *   writingAttempts (indexed by task), grammarSets. Existing stores and their
 *   records are left untouched.
 * - v5 (M5 Reading & Vocabulary): readingTexts, readingQuestionSets (indexed
 *   by text), vocabularyEntries (indexed by key), vocabularyPracticeSets.
 *   Existing stores and their records are left untouched.
 * - v6 (M6 Personal Learning Engine): recommendationStates (the learner's
 *   dismiss/complete decisions) and trainingSessions (a log of generated
 *   targeted practice). All analytics are derived from the module stores on
 *   demand, so nothing else changes. Existing stores are left untouched.
 */
export const APP_DB_NAME = 'linguas-de-gato';
export const APP_DB_VERSION = 6;

export const LISTENING_EXERCISES_BY_SESSION = 'bySession';
export const WRITING_ATTEMPTS_BY_TASK = 'byTask';
export const READING_QUESTIONS_BY_TEXT = 'byText';
export const VOCABULARY_BY_KEY = 'byKey';

export const STORES = {
  sessions: 'sessions',
  transcripts: 'transcripts',
  media: 'media',
  dictation: 'dictation',
  speakingAttempts: 'speakingAttempts',
  speakingRecordings: 'speakingRecordings',
  speakingTopics: 'speakingTopics',
  listeningExercises: 'listeningExercises',
  writingTasks: 'writingTasks',
  writingDrafts: 'writingDrafts',
  writingAttempts: 'writingAttempts',
  grammarSets: 'grammarSets',
  readingTexts: 'readingTexts',
  readingQuestionSets: 'readingQuestionSets',
  vocabularyEntries: 'vocabularyEntries',
  vocabularyPracticeSets: 'vocabularyPracticeSets',
  recommendationStates: 'recommendationStates',
  trainingSessions: 'trainingSessions',
} as const;

export function upgradeAppDatabase(database: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    database.createObjectStore(STORES.sessions, { keyPath: 'id' });
    database.createObjectStore(STORES.transcripts, { keyPath: 'sessionId' });
    database.createObjectStore(STORES.media, { keyPath: 'sessionId' });
    database.createObjectStore(STORES.dictation, { keyPath: ['sessionId', 'cueId'] });
  }
  if (oldVersion < 2) {
    database.createObjectStore(STORES.speakingAttempts, { keyPath: 'id' });
    // Kept recordings, apart from attempts so listing attempts never loads audio.
    database.createObjectStore(STORES.speakingRecordings, { keyPath: 'attemptId' });
    database.createObjectStore(STORES.speakingTopics, { keyPath: 'id' });
  }
  if (oldVersion < 3) {
    const exercises = database.createObjectStore(STORES.listeningExercises, { keyPath: 'id' });
    exercises.createIndex(LISTENING_EXERCISES_BY_SESSION, 'sessionId', { unique: false });
  }
  if (oldVersion < 4) {
    database.createObjectStore(STORES.writingTasks, { keyPath: 'id' });
    // Keyed by task: exactly one working draft per task, never duplicated copies.
    database.createObjectStore(STORES.writingDrafts, { keyPath: 'taskId' });
    const attempts = database.createObjectStore(STORES.writingAttempts, { keyPath: 'id' });
    attempts.createIndex(WRITING_ATTEMPTS_BY_TASK, 'taskId', { unique: false });
    database.createObjectStore(STORES.grammarSets, { keyPath: 'id' });
  }
  if (oldVersion < 5) {
    database.createObjectStore(STORES.readingTexts, { keyPath: 'id' });
    database.createObjectStore(STORES.readingQuestionSets, { keyPath: 'id' }).createIndex(READING_QUESTIONS_BY_TEXT, 'textId', { unique: false });
    // One entry per expression is enforced by the app (merging senses); the index makes the lookup cheap.
    database.createObjectStore(STORES.vocabularyEntries, { keyPath: 'id' }).createIndex(VOCABULARY_BY_KEY, 'key', { unique: false });
    database.createObjectStore(STORES.vocabularyPracticeSets, { keyPath: 'id' });
  }
  if (oldVersion < 6) {
    database.createObjectStore(STORES.recommendationStates, { keyPath: 'id' });
    database.createObjectStore(STORES.trainingSessions, { keyPath: 'id' });
  }
}

export function openAppDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  return openDatabase({ name: APP_DB_NAME, version: APP_DB_VERSION, upgrade: upgradeAppDatabase, factory });
}
