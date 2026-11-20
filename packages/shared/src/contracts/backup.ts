import { z, type ZodType } from 'zod';
import { listeningExerciseSetSchema } from './exercise-generation.js';
import { grammarSetRecordSchema } from './grammar.js';
import { recommendationStateSchema, trainingSessionSchema } from './learning.js';
import { dictationRecordSchema, listeningSessionSchema, transcriptRecordSchema } from './listening-records.js';
import { readingQuestionSetSchema, readingTextRecordSchema } from './reading.js';
import { customTopicSchema, speakingAttemptSchema } from './speaking.js';
import { vocabularyEntrySchema, vocabularyPracticeSetSchema } from './vocabulary.js';
import { writingAttemptSchema, writingDraftSchema, writingTaskRecordSchema } from './writing.js';

/**
 * The local-first backup format (M6). A backup is untrusted input on import:
 * the envelope is checked first, then every record against the same Zod
 * schema the app uses to read it. Binary media is a separate, explicit,
 * size-limited section.
 */

export const BACKUP_FORMAT = 'linguas-de-gato-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_LIMITS = {
  /** Without media, a backup is small; with media, base64 adds about a third. */
  maxFileBytes: 160 * 1024 * 1024,
  maxRecordsPerStore: 50_000,
  /** Media is included only up to this total (raw bytes), to stay within browser memory. */
  maxMediaTotalBytes: 100 * 1024 * 1024,
  maxMediaItemBytes: 50 * 1024 * 1024,
  maxPreferenceChars: 2_000,
} as const;

interface StoreSpec {
  readonly schema: ZodType;
  /** The record's key as a string (composite keys joined). */
  readonly key: (record: Record<string, unknown>) => string;
  /** When the record last changed, for merge decisions; null when the record has no such field. */
  readonly updatedAt: (record: Record<string, unknown>) => number | null;
  readonly label: string;
}

const byId = (record: Record<string, unknown>) => String(record.id);
const updated = (record: Record<string, unknown>) => (typeof record.updatedAt === 'number' ? record.updatedAt : null);
const created = (record: Record<string, unknown>) => (typeof record.createdAt === 'number' ? record.createdAt : null);

/** Every data store of the app database (schema v6) except binary media. */
export const BACKUP_STORES = {
  sessions: { schema: listeningSessionSchema, key: byId, updatedAt: updated, label: 'Listening sessions' },
  transcripts: { schema: transcriptRecordSchema, key: (r) => String(r.sessionId), updatedAt: () => null, label: 'Transcripts' },
  dictation: { schema: dictationRecordSchema, key: (r) => `${String(r.sessionId)}\u0000${String(r.cueId)}`, updatedAt: updated, label: 'Dictation records' },
  listeningExercises: { schema: listeningExerciseSetSchema, key: byId, updatedAt: updated, label: 'Listening comprehension sets' },
  speakingAttempts: { schema: speakingAttemptSchema, key: byId, updatedAt: updated, label: 'Speaking attempts and feedback' },
  speakingTopics: { schema: customTopicSchema, key: byId, updatedAt: created, label: 'Speaking topics' },
  writingTasks: { schema: writingTaskRecordSchema, key: byId, updatedAt: updated, label: 'Writing tasks' },
  writingDrafts: { schema: writingDraftSchema, key: (r) => String(r.taskId), updatedAt: updated, label: 'Writing drafts' },
  writingAttempts: { schema: writingAttemptSchema, key: byId, updatedAt: updated, label: 'Writing submissions and feedback' },
  grammarSets: { schema: grammarSetRecordSchema, key: byId, updatedAt: updated, label: 'Grammar sets and results' },
  readingTexts: { schema: readingTextRecordSchema, key: byId, updatedAt: updated, label: 'Reading texts' },
  readingQuestionSets: { schema: readingQuestionSetSchema, key: byId, updatedAt: updated, label: 'Reading comprehension sets' },
  vocabularyEntries: { schema: vocabularyEntrySchema, key: byId, updatedAt: updated, label: 'Vocabulary entries and reviews' },
  vocabularyPracticeSets: { schema: vocabularyPracticeSetSchema, key: byId, updatedAt: updated, label: 'Vocabulary practice sets' },
  recommendationStates: { schema: recommendationStateSchema, key: byId, updatedAt: updated, label: 'Recommendation decisions' },
  trainingSessions: { schema: trainingSessionSchema, key: byId, updatedAt: created, label: 'Personalized training log' },
} satisfies Record<string, StoreSpec>;

export type BackupStoreName = keyof typeof BACKUP_STORES;
export const BACKUP_STORE_NAMES = Object.keys(BACKUP_STORES) as BackupStoreName[];

/** Binary stores: kept apart because they can be large and are optional in a backup. */
export const MEDIA_STORES = {
  media: { keyField: 'sessionId', label: 'Listening media copies' },
  speakingRecordings: { keyField: 'attemptId', label: 'Speaking recordings' },
} as const;
export type MediaStoreName = keyof typeof MEDIA_STORES;

/** localStorage keys that are app preferences (never secrets: the app has none in the browser). */
export const PREFERENCE_KEYS = ['ldg:theme', 'ldg.transcription.options', 'ldg.reading.preferences', 'ldg.vocabulary.explanation'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

const mediaItemSchema = z
  .object({
    store: z.enum(['media', 'speakingRecordings']),
    key: z.string().min(1).max(128),
    mimeType: z.string().max(255),
    size: z.number().int().nonnegative().max(BACKUP_LIMITS.maxMediaItemBytes),
    /** Base64 of the bytes. */
    data: z.string().max(Math.ceil(BACKUP_LIMITS.maxMediaItemBytes / 3) * 4 + 4),
  })
  .strict();
export type BackupMediaItem = z.infer<typeof mediaItemSchema>;

const omittedMediaSchema = z
  .object({ store: z.enum(['media', 'speakingRecordings']), key: z.string().min(1).max(128), size: z.number().int().nonnegative(), label: z.string().max(300) })
  .strict();
export type OmittedMedia = z.infer<typeof omittedMediaSchema>;

/** The envelope: structure and limits only; records are validated one by one afterwards. */
export const backupEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    schemaVersion: z.number().int().positive(),
    exportedAt: z.number().int().nonnegative(),
    app: z.object({ version: z.string().max(40), databaseVersion: z.number().int().positive() }).strict(),
    counts: z.record(z.string().max(60), z.number().int().nonnegative()),
    stores: z.record(z.string().max(60), z.array(z.unknown()).max(BACKUP_LIMITS.maxRecordsPerStore)),
    preferences: z.record(z.string().max(60), z.string().max(BACKUP_LIMITS.maxPreferenceChars)),
    media: z
      .object({
        included: z.boolean(),
        items: z.array(mediaItemSchema).max(10_000),
        omitted: z.array(omittedMediaSchema).max(10_000),
      })
      .strict(),
  })
  .strict();
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
