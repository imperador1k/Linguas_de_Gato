import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { BACKUP_LIMITS, BACKUP_STORE_NAMES, type ValidatedBackup } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { loadLearningData } from '@/features/progress/storage/learning-repository';
import { APP_DB_NAME, openAppDatabase } from '@/lib/storage/app-database';
import { openDatabase } from '@/lib/storage/indexed-db';
// Schema-valid records shared with the engine's own tests.
import { NOW, SESSION, dictation, grammarSet, speakingAttempt, vocabularyEntry, writingAttempt } from '../../../../../packages/shared/src/learning/fixtures.test-helpers';
import { MediaTooLargeError, applyImport, createBackup, previewImport, readBackupFile, readEverything } from './backup-service';
import { IndexedDbListeningRepository } from '@/features/listening/storage/indexed-db-listening-repository';
import { newFileSession } from '@/features/listening/storage/listening-storage';
import { IndexedDbSpeakingRepository } from '@/features/speaking/storage/indexed-db-speaking-repository';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
};

function put(database: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

const fileSession = { ...SESSION, id: 'file-1', title: 'Local lecture', source: { kind: 'file' as const, fileName: 'lecture.mp3', fileSize: 5, lastModified: 1, mimeType: 'audio/mpeg', formatExtension: 'mp3', mediaKind: 'audio' as const, mediaStored: true } };
const recordedAttempt = { ...speakingAttempt('a1', NOW, [{ category: 'grammar', subcategory: 'preposition', original: 'depends of' }]), recording: { stored: true, mimeType: 'audio/webm' } };

async function seeded() {
  const database = await openAppDatabase(new IDBFactory());
  await put(database, 'sessions', SESSION);
  await put(database, 'sessions', fileSession);
  await put(database, 'transcripts', { sessionId: 's1', cues: [{ id: '1', startMs: 0, endMs: 1000, text: 'The weather is lovely today' }] });
  await put(database, 'dictation', dictation('1', 'The weather is lovely today', [{ at: NOW, answer: 'The weather is lovly today' }]));
  await put(database, 'speakingAttempts', recordedAttempt);
  await put(database, 'writingAttempts', writingAttempt('w1', NOW, [{ kind: 'error', category: 'grammar', original: 'more better' }]));
  await put(database, 'grammarSets', grammarSet('g1', NOW, 'inversion', ['right', 'wrong']));
  await put(database, 'vocabularyEntries', vocabularyEntry('e1', NOW, [{ at: NOW, rating: 'again' }]));
  await put(database, 'recommendationStates', { id: 'rec:prepositions', version: 1, status: 'dismissed', evidenceAt: NOW, updatedAt: NOW });
  await put(database, 'media', { sessionId: 'file-1', blob: new Blob(['audio'], { type: 'audio/mpeg' }) });
  await put(database, 'speakingRecordings', { attemptId: 'a1', blob: new Blob(['voice'], { type: 'audio/webm' }) });
  return database;
}

async function exported(database: IDBDatabase, includeMedia: boolean): Promise<ValidatedBackup> {
  const storage = memoryStorage();
  storage.setItem('ldg:theme', 'dark');
  const backup = await createBackup(database, { includeMedia, now: NOW, storage });
  const parsed = await readBackupFile(new Blob([backup.json]));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.backup;
}

const counts = async (database: IDBDatabase) => {
  const contents = await readEverything(database);
  return { ...Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, contents.stores[name].length])), media: contents.media.length };
};

describe('export', () => {
  it('exports every store, preferences and counts, and lists omitted media explicitly', async () => {
    const database = await seeded();
    const backup = await createBackup(database, { includeMedia: false, now: NOW, storage: { getItem: (key) => (key === 'ldg:theme' ? 'dark' : null) } });
    const envelope = JSON.parse(backup.json);
    expect(envelope).toMatchObject({ format: 'linguas-de-gato-backup', schemaVersion: 1, exportedAt: NOW, app: { version: '0.1.0', databaseVersion: 6 } });
    expect(Object.keys(envelope.stores).sort()).toEqual([...BACKUP_STORE_NAMES].sort());
    expect(envelope.counts).toMatchObject({ sessions: 2, speakingAttempts: 1, recommendationStates: 1 });
    expect(envelope.preferences).toEqual({ 'ldg:theme': 'dark' });
    expect(envelope.media.included).toBe(false);
    expect(envelope.media.items).toEqual([]);
    expect(envelope.media.omitted.map((item: { key: string; label: string }) => [item.key, item.label])).toEqual(
      expect.arrayContaining([
        ['file-1', 'Listening session “Local lecture”'],
        ['a1', expect.stringContaining('Speaking recording')],
      ]),
    );
    expect(backup.fileName).toMatch(/^linguas-de-gato-backup-.*\.json$/);
  });

  it('embeds media as validated base64 when asked', async () => {
    const backup = await exported(await seeded(), true);
    expect(backup.media.map((item) => [item.store, item.key, item.size])).toEqual(expect.arrayContaining([['media', 'file-1', 5], ['speakingRecordings', 'a1', 5]]));
  });

  it('refuses to embed media beyond the limit and explains', async () => {
    const database = await openAppDatabase(new IDBFactory());
    await put(database, 'sessions', fileSession);
    await put(database, 'media', { sessionId: 'file-1', blob: new Blob([new Uint8Array(BACKUP_LIMITS.maxMediaItemBytes + 1)]) });
    await expect(createBackup(database, { includeMedia: true, storage: null })).rejects.toBeInstanceOf(MediaTooLargeError);
    // The alternative still works.
    await expect(createBackup(database, { includeMedia: false, storage: null })).resolves.toBeTruthy();
  });
});

describe('import', () => {
  it('restores everything into a fresh database, with media and preferences', async () => {
    const source = await seeded();
    const backup = await exported(source, true);
    const target = await openAppDatabase(new IDBFactory());
    const storage = memoryStorage();
    const preview = await previewImport(target, backup, 'merge');
    expect(preview.plan.totals.added).toBe(Object.values(backup.stores).reduce((sum, records) => sum + records.length, 0));
    const report = await applyImport(target, backup, 'merge', { storage });
    expect(report).toMatchObject({ mediaWritten: 2, preferencesApplied: 1, skippedInvalid: 0 });
    expect(await counts(target)).toEqual(await counts(source));
    expect(storage.values.get('ldg:theme')).toBe('dark');
    // The analytics read the restored data exactly as before.
    expect((await loadLearningData(target)).snapshot).toEqual((await loadLearningData(source)).snapshot);
  });

  it('clears media flags when the backup had no media and the fresh database has none', async () => {
    const backup = await exported(await seeded(), false);
    const target = await openAppDatabase(new IDBFactory());
    await applyImport(target, backup, 'merge', { storage: null });
    const contents = await readEverything(target);
    expect(contents.stores.sessions.find((record) => record.id === 'file-1')).toMatchObject({ source: { mediaStored: false } });
    expect(contents.stores.speakingAttempts[0]).toMatchObject({ recording: { stored: false } });
  });

  it('merge keeps newer local work and adds what is missing', async () => {
    const source = await seeded();
    const backup = await exported(source, false);
    const target = await openAppDatabase(new IDBFactory());
    const newerLocal = { ...writingAttempt('w1', NOW + 1000, []), updatedAt: NOW + 1000 };
    await put(target, 'writingAttempts', newerLocal);
    const report = await applyImport(target, backup, 'merge', { storage: null });
    expect(report.kept).toBe(1);
    const contents = await readEverything(target);
    expect(contents.stores.writingAttempts).toEqual([newerLocal]);
    expect(contents.stores.grammarSets).toHaveLength(1);
  });

  it('replace swaps the data, keeping media only for records the backup describes', async () => {
    const backup = await exported(await seeded(), false);
    const target = await seeded();
    await put(target, 'grammarSets', grammarSet('local-only', NOW, 'conditionals', ['right']));
    await put(target, 'sessions', { ...fileSession, id: 'file-2' });
    await put(target, 'media', { sessionId: 'file-2', blob: new Blob(['other']) });
    const preview = await previewImport(target, backup, 'replace');
    expect(preview.mediaToRemove).toBe(1);
    const report = await applyImport(target, backup, 'replace', { storage: null });
    expect(report.mediaRemoved).toBe(1);
    const contents = await readEverything(target);
    expect(contents.stores.grammarSets.map((record) => record.id)).toEqual(['g1']);
    expect(contents.media.map((item) => item.key).sort()).toEqual(['a1', 'file-1']);
    // Their records still claim the bytes, which are still there.
    expect(contents.stores.sessions.find((record) => record.id === 'file-1')).toMatchObject({ source: { mediaStored: true } });
  });

  it('rolls back completely when a write fails, leaving existing data untouched', async () => {
    const target = await seeded();
    const before = await readEverything(target);
    const backup = await exported(await seeded(), true);
    // A media item whose bytes do not match its declared size is rejected before anything is written.
    const damaged: ValidatedBackup = { ...backup, media: backup.media.map((item, index) => (index === 0 ? { ...item, size: item.size + 1 } : item)) };
    await expect(applyImport(target, damaged, 'replace', { storage: null })).rejects.toThrow(/damaged/);
    expect(await readEverything(target)).toEqual(before);

    // A failure inside the transaction aborts it as a whole.
    const unwritable: ValidatedBackup = { ...backup, stores: { ...backup.stores, grammarSets: [{ ...backup.stores.grammarSets[0]!, id: undefined as unknown as string }] } };
    await expect(applyImport(target, unwritable, 'replace', { storage: null })).rejects.toThrow();
    expect(await readEverything(target)).toEqual(before);
  });

  it('rejects corrupt, foreign, oversized and future files without touching the database', async () => {
    expect(await readBackupFile(new Blob(['{not json']))).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(await readBackupFile(new Blob([JSON.stringify({ hello: 'world' })]))).toMatchObject({ ok: false });
    expect(await readBackupFile(new Blob([]))).toMatchObject({ ok: false, error: expect.stringContaining('empty') });
    const huge = { size: BACKUP_LIMITS.maxFileBytes + 1, text: async () => '{}' } as unknown as Blob;
    expect(await readBackupFile(huge)).toMatchObject({ ok: false, error: expect.stringContaining('larger') });
    const future = JSON.parse((await createBackup(await openAppDatabase(new IDBFactory()), { includeMedia: false, storage: null })).json);
    expect(await readBackupFile(new Blob([JSON.stringify({ ...future, schemaVersion: 99 })]))).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
  });
});

describe('database migration v5 → v6', () => {
  it('adds the learning stores without touching existing records', async () => {
    const factory = new IDBFactory();
    const v5 = await openDatabase({
      name: APP_DB_NAME,
      version: 5,
      factory,
      upgrade: (database) => {
        for (const name of ['sessions', 'speakingAttempts', 'speakingTopics', 'writingTasks', 'grammarSets', 'readingTexts', 'vocabularyPracticeSets']) database.createObjectStore(name, { keyPath: 'id' });
        database.createObjectStore('transcripts', { keyPath: 'sessionId' });
        database.createObjectStore('media', { keyPath: 'sessionId' });
        database.createObjectStore('dictation', { keyPath: ['sessionId', 'cueId'] });
        database.createObjectStore('speakingRecordings', { keyPath: 'attemptId' });
        database.createObjectStore('listeningExercises', { keyPath: 'id' }).createIndex('bySession', 'sessionId', { unique: false });
        database.createObjectStore('writingDrafts', { keyPath: 'taskId' });
        database.createObjectStore('writingAttempts', { keyPath: 'id' }).createIndex('byTask', 'taskId', { unique: false });
        database.createObjectStore('readingQuestionSets', { keyPath: 'id' }).createIndex('byText', 'textId', { unique: false });
        database.createObjectStore('vocabularyEntries', { keyPath: 'id' }).createIndex('byKey', 'key', { unique: false });
      },
    });
    await put(v5, 'sessions', SESSION);
    await put(v5, 'speakingAttempts', recordedAttempt);
    await put(v5, 'speakingRecordings', { attemptId: 'a1', blob: new Blob(['voice']) });
    await put(v5, 'writingAttempts', writingAttempt('w1', NOW, []));
    await put(v5, 'grammarSets', grammarSet('g1', NOW, 'inversion', ['right']));
    await put(v5, 'vocabularyEntries', vocabularyEntry('e1', NOW, []));
    v5.close();

    const database = await openAppDatabase(factory);
    expect(database.version).toBe(6);
    expect([...database.objectStoreNames]).toEqual(expect.arrayContaining(['recommendationStates', 'trainingSessions']));
    const data = await loadLearningData(database);
    expect(data.snapshot.listeningSessions).toEqual([SESSION]);
    expect(data.snapshot.speakingAttempts).toEqual([recordedAttempt]);
    expect(data.snapshot.writingAttempts).toHaveLength(1);
    expect(data.snapshot.grammarSets).toHaveLength(1);
    expect(data.snapshot.vocabularyEntries).toHaveLength(1);
    expect(data).toMatchObject({ recommendationStates: [], trainingSessions: [], unreadable: 0 });
    expect((await readEverything(database)).media).toHaveLength(1);
    database.close();
  });
});

describe('media kept by M8 flows', () => {
  const accepted = { format: { extension: 'mp3', label: 'MP3', kind: 'audio', mimeTypes: ['audio/mpeg'], playable: true, transcribable: true }, kind: 'audio' } as const;

  async function keptMedia(factory: IDBFactory) {
    const listening = await IndexedDbListeningRepository.open(factory);
    const speaking = await IndexedDbSpeakingRepository.open(factory);
    const session = newFileSession(new File(['lecture-audio'], 'lecture.mp3', { type: 'audio/mpeg' }), accepted, NOW);
    await listening.createSession(session, undefined, new Blob(['lecture-audio'], { type: 'audio/mpeg' }));
    await speaking.putAttempt(speakingAttempt('kept', NOW, []), new Blob(['my-voice'], { type: 'audio/webm' }));
    return { session, close: () => (listening.close(), speaking.close()) };
  }

  it('round-trips kept audio and recordings: restored sessions play and say so', async () => {
    const sourceFactory = new IDBFactory();
    const { session, close } = await keptMedia(sourceFactory);
    const backup = await exported(await openAppDatabase(sourceFactory), true);
    close();
    expect(backup.media.map((item) => item.store).sort()).toEqual(['media', 'speakingRecordings']);

    const targetFactory = new IDBFactory();
    await applyImport(await openAppDatabase(targetFactory), backup, 'merge', { storage: null });
    const listening = await IndexedDbListeningRepository.open(targetFactory);
    const speaking = await IndexedDbSpeakingRepository.open(targetFactory);
    expect(await listening.reconcileMedia(session.id)).toMatchObject({ present: true, repaired: null, session: { source: { mediaStored: true } } });
    expect(await (await listening.getMedia(session.id))?.text()).toBe('lecture-audio');
    expect(await speaking.reconcileRecording('kept')).toMatchObject({ present: true, repaired: null });
    expect(await (await speaking.getRecording('kept'))?.text()).toBe('my-voice');
    listening.close();
    speaking.close();
  });

  it('lists the left-out media and restores the records as needing the file, never as saved', async () => {
    const sourceFactory = new IDBFactory();
    const { session, close } = await keptMedia(sourceFactory);
    const backup = await exported(await openAppDatabase(sourceFactory), false);
    close();
    expect(backup.media).toEqual([]);

    const targetFactory = new IDBFactory();
    await applyImport(await openAppDatabase(targetFactory), backup, 'merge', { storage: null });
    const listening = await IndexedDbListeningRepository.open(targetFactory);
    const speaking = await IndexedDbSpeakingRepository.open(targetFactory);
    // The import already cleared the flags, so nothing needs repairing and nothing claims to be saved.
    expect(await listening.reconcileMedia(session.id)).toMatchObject({ present: false, repaired: null, session: { source: { mediaStored: false } } });
    expect(await speaking.reconcileRecording('kept')).toMatchObject({ present: false, repaired: null, attempt: { recording: { stored: false } } });
    listening.close();
    speaking.close();
  });

  it('reports the omitted media in the export envelope', async () => {
    const factory = new IDBFactory();
    const { close } = await keptMedia(factory);
    const result = await createBackup(await openAppDatabase(factory), { includeMedia: false, now: NOW, storage: null });
    close();
    expect(result.envelope.media.omitted.map((item) => item.store).sort()).toEqual(['media', 'speakingRecordings']);
    expect(result.envelope.media.omitted.find((item) => item.store === 'media')?.label).toContain('lecture.mp3');
  });
});
