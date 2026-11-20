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
 */
export const APP_DB_NAME = 'linguas-de-gato';
export const APP_DB_VERSION = 3;

export const LISTENING_EXERCISES_BY_SESSION = 'bySession';

export const STORES = {
  sessions: 'sessions',
  transcripts: 'transcripts',
  media: 'media',
  dictation: 'dictation',
  speakingAttempts: 'speakingAttempts',
  speakingRecordings: 'speakingRecordings',
  speakingTopics: 'speakingTopics',
  listeningExercises: 'listeningExercises',
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
    // Opt-in recordings, kept apart so listing attempts never loads audio.
    database.createObjectStore(STORES.speakingRecordings, { keyPath: 'attemptId' });
    database.createObjectStore(STORES.speakingTopics, { keyPath: 'id' });
  }
  if (oldVersion < 3) {
    const exercises = database.createObjectStore(STORES.listeningExercises, { keyPath: 'id' });
    exercises.createIndex(LISTENING_EXERCISES_BY_SESSION, 'sessionId', { unique: false });
  }
}

export function openAppDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  return openDatabase({ name: APP_DB_NAME, version: APP_DB_VERSION, upgrade: upgradeAppDatabase, factory });
}
