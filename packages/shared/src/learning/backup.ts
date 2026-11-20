import {
  BACKUP_FORMAT,
  BACKUP_LIMITS,
  BACKUP_SCHEMA_VERSION,
  BACKUP_STORE_NAMES,
  BACKUP_STORES,
  PREFERENCE_KEYS,
  backupEnvelopeSchema,
  type BackupEnvelope,
  type BackupMediaItem,
  type BackupStoreName,
} from '../contracts/backup.js';

/**
 * Pure backup logic: validating an untrusted backup and planning an import.
 * The client does the IndexedDB reads and the single atomic write.
 */

export type StoreRecords = Partial<Record<BackupStoreName, Record<string, unknown>[]>>;

export interface ValidatedBackup {
  readonly envelope: Pick<BackupEnvelope, 'exportedAt' | 'app' | 'schemaVersion'>;
  readonly stores: Record<BackupStoreName, Record<string, unknown>[]>;
  readonly media: readonly BackupMediaItem[];
  readonly mediaOmitted: BackupEnvelope['media']['omitted'];
  readonly preferences: Partial<Record<(typeof PREFERENCE_KEYS)[number], string>>;
  /** Records that failed validation (skipped), per store, with the first reason. */
  readonly invalid: Array<{ readonly store: string; readonly index: number; readonly reason: string }>;
  readonly warnings: string[];
}

export type BackupValidation = { readonly ok: true; readonly backup: ValidatedBackup } | { readonly ok: false; readonly error: string };

/**
 * Validates parsed JSON. Structural problems reject the whole backup;
 * individual invalid records are listed and skipped (never imported).
 * Unknown stores and preference keys are ignored with a warning.
 */
export function validateBackup(parsed: unknown): BackupValidation {
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'This file is not a Linguas de Gato backup.' };
  const format = (parsed as { format?: unknown }).format;
  if (format !== BACKUP_FORMAT) return { ok: false, error: 'This file is not a Linguas de Gato backup.' };
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `This backup was made by a newer version of the app (format ${version}). Update the app before importing it.` };
  }
  const envelope = backupEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) return { ok: false, error: 'The backup file is damaged or incomplete, so nothing was imported.' };
  if (envelope.data.schemaVersion !== BACKUP_SCHEMA_VERSION) return { ok: false, error: `Unsupported backup format ${envelope.data.schemaVersion}.` };

  const warnings: string[] = [];
  const invalid: ValidatedBackup['invalid'] = [];
  const stores = Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, [] as Record<string, unknown>[]])) as Record<BackupStoreName, Record<string, unknown>[]>;

  for (const [name, records] of Object.entries(envelope.data.stores)) {
    if (!(BACKUP_STORE_NAMES as string[]).includes(name)) {
      warnings.push(`Ignored unknown data “${name.slice(0, 40)}” (${records.length} records).`);
      continue;
    }
    const spec = BACKUP_STORES[name as BackupStoreName];
    const seenKeys = new Set<string>();
    records.forEach((record, index) => {
      const result = spec.schema.safeParse(record);
      if (!result.success) {
        invalid.push({ store: name, index, reason: result.error.issues[0]?.message ?? 'Invalid record' });
        return;
      }
      const value = result.data as Record<string, unknown>;
      const key = spec.key(value);
      if (seenKeys.has(key)) {
        invalid.push({ store: name, index, reason: 'Duplicate record in the backup' });
        return;
      }
      seenKeys.add(key);
      stores[name as BackupStoreName].push(value);
    });
    const declared = envelope.data.counts[name];
    if (declared !== undefined && declared !== records.length) warnings.push(`${spec.label}: the backup says ${declared} records but contains ${records.length}.`);
  }

  const preferences: ValidatedBackup['preferences'] = {};
  for (const [key, value] of Object.entries(envelope.data.preferences)) {
    if ((PREFERENCE_KEYS as readonly string[]).includes(key)) preferences[key as (typeof PREFERENCE_KEYS)[number]] = value;
    else warnings.push(`Ignored unknown preference “${key.slice(0, 40)}”.`);
  }

  const mediaTotal = envelope.data.media.items.reduce((sum, item) => sum + item.size, 0);
  if (mediaTotal > BACKUP_LIMITS.maxMediaTotalBytes) return { ok: false, error: 'The media in this backup is larger than the app can import safely.' };
  if (!envelope.data.media.included && envelope.data.media.omitted.length > 0) {
    warnings.push(`${envelope.data.media.omitted.length} media file${envelope.data.media.omitted.length === 1 ? ' was' : 's were'} left out of this backup; those sessions or recordings will need their audio again.`);
  }
  if (invalid.length > 0) warnings.push(`${invalid.length} record${invalid.length === 1 ? '' : 's'} failed validation and will be skipped.`);

  return {
    ok: true,
    backup: {
      envelope: { exportedAt: envelope.data.exportedAt, app: envelope.data.app, schemaVersion: envelope.data.schemaVersion },
      stores,
      media: envelope.data.media.items,
      mediaOmitted: envelope.data.media.omitted,
      preferences,
      invalid,
      warnings,
    },
  };
}

export type ImportMode = 'merge' | 'replace';

export interface StorePlan {
  /** Records to write (new or newer than the existing copy). */
  readonly write: Record<string, unknown>[];
  readonly added: number;
  readonly updated: number;
  /** Existing records kept because they are the same age or newer. */
  readonly kept: number;
  /** Incoming records skipped because they would duplicate something already saved under another id. */
  readonly skippedDuplicates: number;
}

export interface ImportPlan {
  readonly mode: ImportMode;
  readonly stores: Record<BackupStoreName, StorePlan>;
  /** Replace mode: every listed store is cleared before writing. */
  readonly clear: boolean;
  readonly totals: { readonly added: number; readonly updated: number; readonly kept: number; readonly skippedDuplicates: number };
}

/**
 * Merge: new keys are added; for an existing key the incoming record wins
 * only if it is strictly newer (by `updatedAt`, or `createdAt` where that is
 * all there is); records without a timestamp keep the existing copy, except
 * transcripts, which follow their session's decision. Vocabulary entries are
 * unique by expression: an incoming entry for an expression already saved
 * under another id is skipped.
 * Replace: everything in the backup is written after clearing the stores.
 */
export function planImport(existing: StoreRecords, incoming: Record<BackupStoreName, Record<string, unknown>[]>, mode: ImportMode): ImportPlan {
  const stores = {} as Record<BackupStoreName, StorePlan>;
  const replacedSessions = new Set<string>();

  const order: BackupStoreName[] = ['sessions', ...BACKUP_STORE_NAMES.filter((name) => name !== 'sessions')];
  for (const name of order) {
    const spec = BACKUP_STORES[name];
    const records = incoming[name] ?? [];
    if (mode === 'replace') {
      stores[name] = { write: records, added: records.length, updated: 0, kept: 0, skippedDuplicates: 0 };
      continue;
    }
    const current = new Map((existing[name] ?? []).map((record) => [spec.key(record), record]));
    const existingVocabularyKeys = name === 'vocabularyEntries' ? new Map((existing[name] ?? []).map((record) => [String(record.key), String(record.id)])) : null;
    const write: Record<string, unknown>[] = [];
    let added = 0;
    let updatedCount = 0;
    let kept = 0;
    let skippedDuplicates = 0;
    for (const record of records) {
      const key = spec.key(record);
      const previous = current.get(key);
      if (!previous) {
        if (existingVocabularyKeys) {
          const owner = existingVocabularyKeys.get(String(record.key));
          if (owner && owner !== String(record.id)) {
            skippedDuplicates += 1;
            continue;
          }
        }
        write.push(record);
        added += 1;
        if (name === 'sessions') replacedSessions.add(key);
        continue;
      }
      const incomingAt = spec.updatedAt(record);
      const previousAt = spec.updatedAt(previous);
      const newer = name === 'transcripts' ? replacedSessions.has(key) : incomingAt !== null && previousAt !== null && incomingAt > previousAt;
      if (newer) {
        write.push(record);
        updatedCount += 1;
        if (name === 'sessions') replacedSessions.add(key);
      } else kept += 1;
    }
    stores[name] = { write, added, updated: updatedCount, kept, skippedDuplicates };
  }

  const totals = Object.values(stores).reduce(
    (sum, plan) => ({ added: sum.added + plan.added, updated: sum.updated + plan.updated, kept: sum.kept + plan.kept, skippedDuplicates: sum.skippedDuplicates + plan.skippedDuplicates }),
    { added: 0, updated: 0, kept: 0, skippedDuplicates: 0 },
  );
  return { mode, stores, clear: mode === 'replace', totals };
}

/**
 * Media flags must match reality after an import: a session or attempt
 * claims a stored copy only if its bytes are present.
 */
export function reconcileMediaFlags(records: Record<string, unknown>, store: BackupStoreName, hasMedia: (key: string) => boolean): Record<string, unknown> {
  if (store === 'sessions') {
    const source = records.source as { kind?: string; mediaStored?: boolean } | undefined;
    if (source?.kind === 'file' && source.mediaStored && !hasMedia(String(records.id))) return { ...records, source: { ...source, mediaStored: false } };
  }
  if (store === 'speakingAttempts') {
    const recording = records.recording as { stored?: boolean; mimeType?: string } | undefined;
    if (recording?.stored && !hasMedia(String(records.id))) return { ...records, recording: { ...recording, stored: false } };
  }
  return records;
}

// --- Base64 helpers (no Buffer: they run in the browser too) ------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('Invalid base64 data');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
