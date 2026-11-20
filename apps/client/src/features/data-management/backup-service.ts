import {
  BACKUP_FORMAT,
  BACKUP_LIMITS,
  BACKUP_SCHEMA_VERSION,
  BACKUP_STORE_NAMES,
  BACKUP_STORES,
  MEDIA_STORES,
  PREFERENCE_KEYS,
  base64ToBytes,
  bytesToBase64,
  planImport,
  reconcileMediaFlags,
  validateBackup,
  type BackupEnvelope,
  type BackupMediaItem,
  type BackupStoreName,
  type ImportMode,
  type ImportPlan,
  type MediaStoreName,
  type OmittedMedia,
  type StoreRecords,
  type ValidatedBackup,
} from '@ldg/shared';
import { APP_DB_VERSION } from '@/lib/storage/app-database';
import { requestToPromise, runInTransaction, StorageError } from '@/lib/storage/indexed-db';

/**
 * Local backups: a full JSON export of every store and the app preferences,
 * and a validated, atomic import. A backup never leaves the browser except
 * as a file the learner downloads; it is never sent to the server or Groq.
 */

export const APP_VERSION = '0.1.0';
const MEDIA_NAMES = Object.keys(MEDIA_STORES) as MediaStoreName[];

interface RawMedia {
  readonly store: MediaStoreName;
  readonly key: string;
  readonly blob: Blob;
}

interface DatabaseContents {
  readonly stores: Record<BackupStoreName, Record<string, unknown>[]>;
  readonly media: RawMedia[];
}

function readTransaction(database: IDBDatabase, names: string[], mode: IDBTransactionMode): IDBTransaction {
  try {
    return database.transaction(names, mode);
  } catch (error) {
    throw new StorageError('blocked', undefined, { cause: error });
  }
}

/** Reads every store in one transaction, so an export is a consistent snapshot. Records are exported as stored. */
export async function readEverything(database: IDBDatabase): Promise<DatabaseContents> {
  const transaction = readTransaction(database, [...BACKUP_STORE_NAMES, ...MEDIA_NAMES], 'readonly');
  const storeRows = BACKUP_STORE_NAMES.map((name) => requestToPromise(transaction.objectStore(name).getAll() as IDBRequest<Record<string, unknown>[]>));
  const mediaRows = MEDIA_NAMES.map((name) => requestToPromise(transaction.objectStore(name).getAll() as IDBRequest<Array<Record<string, unknown>>>));
  const [stores, media] = await Promise.all([Promise.all(storeRows), Promise.all(mediaRows)]);
  return {
    stores: Object.fromEntries(BACKUP_STORE_NAMES.map((name, index) => [name, stores[index] ?? []])) as DatabaseContents['stores'],
    media: MEDIA_NAMES.flatMap((store, index) =>
      (media[index] ?? []).flatMap((row) => {
        const key = row[MEDIA_STORES[store].keyField];
        return typeof key === 'string' && row.blob instanceof Blob ? [{ store, key, blob: row.blob }] : [];
      }),
    ),
  };
}

function mediaLabel(store: MediaStoreName, key: string, stores: DatabaseContents['stores']): string {
  if (store === 'media') {
    const session = stores.sessions.find((record) => record.id === key);
    return `Listening session “${String(session?.title ?? key)}”`.slice(0, 300);
  }
  const attempt = stores.speakingAttempts.find((record) => record.id === key) as { prompt?: { title?: string }; createdAt?: number } | undefined;
  return `Speaking recording for “${attempt?.prompt?.title ?? key}”`.slice(0, 300);
}

export interface MediaSummary {
  readonly count: number;
  readonly totalBytes: number;
  readonly largestBytes: number;
  /** Media can be embedded only within the limits; otherwise the export must exclude it. */
  readonly fitsInBackup: boolean;
  readonly items: OmittedMedia[];
}

export function summarizeMedia(contents: DatabaseContents): MediaSummary {
  const items = contents.media.map((item) => ({ store: item.store, key: item.key, size: item.blob.size, label: mediaLabel(item.store, item.key, contents.stores) }));
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const largestBytes = items.reduce((max, item) => Math.max(max, item.size), 0);
  return { count: items.length, totalBytes, largestBytes, fitsInBackup: totalBytes <= BACKUP_LIMITS.maxMediaTotalBytes && largestBytes <= BACKUP_LIMITS.maxMediaItemBytes, items };
}

function readPreferences(storage: Pick<Storage, 'getItem'> | null): Record<string, string> {
  const preferences: Record<string, string> = {};
  for (const key of PREFERENCE_KEYS) {
    try {
      const value = storage?.getItem(key);
      if (typeof value === 'string' && value.length <= BACKUP_LIMITS.maxPreferenceChars) preferences[key] = value;
    } catch {
      // Storage blocked: preferences are simply not included.
    }
  }
  return preferences;
}

export interface ExportResult {
  readonly json: string;
  readonly envelope: Omit<BackupEnvelope, 'stores' | 'media'> & { media: { included: boolean; itemCount: number; omitted: OmittedMedia[] } };
  readonly fileName: string;
}

export class MediaTooLargeError extends Error {
  constructor(readonly summary: MediaSummary) {
    super('The saved media is too large to include in a backup file.');
    this.name = 'MediaTooLargeError';
  }
}

export async function createBackup(database: IDBDatabase, options: { includeMedia: boolean; now?: number; storage?: Pick<Storage, 'getItem'> | null }): Promise<ExportResult> {
  const contents = await readEverything(database);
  const summary = summarizeMedia(contents);
  if (options.includeMedia && !summary.fitsInBackup) throw new MediaTooLargeError(summary);

  const items: BackupMediaItem[] = [];
  if (options.includeMedia) {
    // Sequential: only one item's bytes are held twice (bytes + base64) at a time.
    for (const item of contents.media) {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      items.push({ store: item.store, key: item.key, mimeType: item.blob.type.slice(0, 255), size: bytes.byteLength, data: bytesToBase64(bytes) });
    }
  }
  const now = options.now ?? Date.now();
  const counts = Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, contents.stores[name].length]));
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    app: { version: APP_VERSION, databaseVersion: APP_DB_VERSION },
    counts,
    stores: contents.stores,
    preferences: readPreferences(options.storage === undefined ? safeLocalStorage() : options.storage),
    media: { included: options.includeMedia, items, omitted: options.includeMedia ? [] : summary.items },
  };
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return {
    json: JSON.stringify(envelope),
    envelope: { ...envelope, media: { included: envelope.media.included, itemCount: items.length, omitted: envelope.media.omitted } },
    fileName: `linguas-de-gato-backup-${stamp}${options.includeMedia ? '-with-media' : ''}.json`,
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function downloadText(json: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the bytes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- Import --------------------------------------------------------------------------------------

export type ParsedBackup = { readonly ok: true; readonly backup: ValidatedBackup } | { readonly ok: false; readonly error: string };

/** Reads and validates a selected file. Nothing is written. The JSON is parsed as data only. */
export async function readBackupFile(file: Blob): Promise<ParsedBackup> {
  if (file.size === 0) return { ok: false, error: 'The selected file is empty.' };
  if (file.size > BACKUP_LIMITS.maxFileBytes) return { ok: false, error: `The file is larger than ${Math.round(BACKUP_LIMITS.maxFileBytes / 1024 / 1024)} MB, the most the app can import safely.` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'The file is not valid JSON, so it cannot be a Linguas de Gato backup.' };
  }
  return validateBackup(parsed);
}

export interface ImportPreview {
  readonly plan: ImportPlan;
  /** Media in the backup that will be written. */
  readonly mediaToWrite: number;
  /** Replace mode: existing media that will be removed because its record is not in the backup. */
  readonly mediaToRemove: number;
  readonly existingCounts: Record<BackupStoreName, number>;
}

async function existingMediaKeys(database: IDBDatabase): Promise<Record<MediaStoreName, string[]>> {
  const transaction = readTransaction(database, MEDIA_NAMES, 'readonly');
  const keys = await Promise.all(MEDIA_NAMES.map((name) => requestToPromise(transaction.objectStore(name).getAllKeys())));
  return Object.fromEntries(MEDIA_NAMES.map((name, index) => [name, (keys[index] ?? []).map(String)])) as Record<MediaStoreName, string[]>;
}

/**
 * Which media to write and remove.
 * - Media is written only for a record that is in the backup. In merge mode
 *   it must also be new locally, or belong to a record the merge updates
 *   (local recordings are never overwritten by an older copy).
 * - Replace mode removes local media whose record is not in the backup and
 *   keeps local media for records that are (so a backup without media does
 *   not throw away recordings it still describes).
 */
function mediaDecisions(backup: ValidatedBackup, plan: ImportPlan, existingMedia: Record<MediaStoreName, string[]>, mode: ImportMode) {
  const idsIn = (records: readonly Record<string, unknown>[]) => new Set(records.map((record) => String(record.id)));
  const inBackup = { media: idsIn(backup.stores.sessions), speakingRecordings: idsIn(backup.stores.speakingAttempts) };
  const written = { media: idsIn(plan.stores.sessions.write), speakingRecordings: idsIn(plan.stores.speakingAttempts.write) };

  const write = backup.media.filter((item) => {
    if (!inBackup[item.store].has(item.key)) return false;
    return mode === 'replace' || written[item.store].has(item.key) || !existingMedia[item.store].includes(item.key);
  });
  const remove: Array<{ store: MediaStoreName; key: string }> =
    mode === 'replace' ? MEDIA_NAMES.flatMap((store) => existingMedia[store].filter((key) => !inBackup[store].has(key)).map((key) => ({ store, key }))) : [];
  return { write, remove };
}

export async function previewImport(database: IDBDatabase, backup: ValidatedBackup, mode: ImportMode): Promise<ImportPreview> {
  const existing = await readEverything(database);
  const plan = planImport(existing.stores as StoreRecords, backup.stores, mode);
  const media = mediaDecisions(backup, plan, await existingMediaKeys(database), mode);
  return {
    plan,
    mediaToWrite: media.write.length,
    mediaToRemove: media.remove.length,
    existingCounts: Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, existing.stores[name].length])) as Record<BackupStoreName, number>,
  };
}

export interface ImportReport {
  readonly mode: ImportMode;
  readonly added: number;
  readonly updated: number;
  readonly kept: number;
  readonly skippedDuplicates: number;
  readonly skippedInvalid: number;
  readonly mediaWritten: number;
  readonly mediaRemoved: number;
  readonly preferencesApplied: number;
  readonly perStore: Array<{ readonly store: BackupStoreName; readonly label: string; readonly added: number; readonly updated: number; readonly kept: number }>;
}

/**
 * Applies a validated backup in ONE readwrite transaction across every store.
 * All decoding and planning happens first; the transaction then issues its
 * writes synchronously, so it cannot auto-commit half-way. Any failure
 * (quota, validation, abort) rolls back everything: existing data is never
 * partially overwritten. Preferences are applied only after the commit.
 */
export async function applyImport(
  database: IDBDatabase,
  backup: ValidatedBackup,
  mode: ImportMode,
  options: { storage?: Pick<Storage, 'setItem'> | null } = {},
): Promise<ImportReport> {
  const existing = await readEverything(database);
  const plan = planImport(existing.stores as StoreRecords, backup.stores, mode);
  const existingMedia = await existingMediaKeys(database);
  const media = mediaDecisions(backup, plan, existingMedia, mode);

  // Decode every media item before the transaction starts (async work would let it auto-commit).
  const decoded = media.write.map((item) => {
    const bytes = base64ToBytes(item.data);
    if (bytes.byteLength !== item.size) throw new Error(`A media file in the backup is damaged (${item.store}/${item.key}).`);
    return { store: item.store, key: item.key, blob: new Blob([bytes as BlobPart], { type: item.mimeType }) };
  });

  // Media flags must match the bytes that will actually be present.
  const removed = new Set(media.remove.map((item) => `${item.store}/${item.key}`));
  const finalMedia: Record<MediaStoreName, Set<string>> = {
    media: new Set(existingMedia.media.filter((key) => !removed.has(`media/${key}`))),
    speakingRecordings: new Set(existingMedia.speakingRecordings.filter((key) => !removed.has(`speakingRecordings/${key}`))),
  };
  for (const item of decoded) finalMedia[item.store].add(item.key);

  const writes = BACKUP_STORE_NAMES.map((store) => ({
    store,
    records: plan.stores[store].write.map((record) => {
      const owner = store === 'sessions' ? 'media' : store === 'speakingAttempts' ? 'speakingRecordings' : null;
      const reconciled = owner ? reconcileMediaFlags(record, store, (key) => finalMedia[owner].has(key)) : record;
      // Re-validate the exact value being written: nothing unvalidated reaches storage.
      return BACKUP_STORES[store].schema.parse(reconciled) as Record<string, unknown>;
    }),
  }));

  const transaction = readTransaction(database, [...BACKUP_STORE_NAMES, ...MEDIA_NAMES], 'readwrite');
  await runInTransaction(transaction, async () => {
    if (mode === 'replace') for (const store of BACKUP_STORE_NAMES) transaction.objectStore(store).clear();
    for (const { store, records } of writes) {
      const objectStore = transaction.objectStore(store);
      for (const record of records) objectStore.put(record);
    }
    for (const item of media.remove) transaction.objectStore(item.store).delete(item.key);
    for (const item of decoded) transaction.objectStore(item.store).put({ [MEDIA_STORES[item.store].keyField]: item.key, blob: item.blob });
  });

  let preferencesApplied = 0;
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  for (const [key, value] of Object.entries(backup.preferences)) {
    try {
      storage?.setItem(key, value);
      preferencesApplied += 1;
    } catch {
      // A blocked preference is not worth failing an import that already committed.
    }
  }

  return {
    mode,
    ...plan.totals,
    skippedInvalid: backup.invalid.length,
    mediaWritten: decoded.length,
    mediaRemoved: media.remove.length,
    preferencesApplied,
    perStore: BACKUP_STORE_NAMES.map((store) => ({ store, label: BACKUP_STORES[store].label, added: plan.stores[store].added, updated: plan.stores[store].updated, kept: plan.stores[store].kept })),
  };
}
