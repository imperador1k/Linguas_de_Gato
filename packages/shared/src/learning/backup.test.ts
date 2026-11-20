import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BACKUP_LIMITS, BACKUP_SCHEMA_VERSION, BACKUP_STORE_NAMES, type BackupStoreName } from '../contracts/backup.js';
import { base64ToBytes, bytesToBase64, planImport, reconcileMediaFlags, validateBackup } from './backup.js';
import { NOW, SESSION, grammarSet, speakingAttempt, vocabularyEntry, writingAttempt } from './fixtures.test-helpers.js';

function envelope(stores: Partial<Record<string, unknown[]>>, overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: NOW,
    app: { version: '0.1.0', databaseVersion: 6 },
    counts: Object.fromEntries(Object.entries(stores).map(([name, records]) => [name, records?.length ?? 0])),
    stores,
    preferences: { 'ldg:theme': 'dark' },
    media: { included: false, items: [], omitted: [] },
    ...overrides,
  };
}

const emptyIncoming = () => Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, []])) as unknown as Record<BackupStoreName, Record<string, unknown>[]>;

describe('validateBackup', () => {
  it('accepts a valid backup and keeps every valid record', () => {
    const result = validateBackup(envelope({ sessions: [SESSION], speakingAttempts: [speakingAttempt('a1', NOW, [])], grammarSets: [grammarSet('g1', NOW, 'inversion', ['right'])] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.stores.sessions).toHaveLength(1);
    expect(result.backup.stores.speakingAttempts).toHaveLength(1);
    expect(result.backup.stores.grammarSets).toHaveLength(1);
    expect(result.backup.preferences).toEqual({ 'ldg:theme': 'dark' });
    expect(result.backup.invalid).toEqual([]);
  });

  it('rejects files that are not backups, damaged envelopes and future versions', () => {
    expect(validateBackup(null)).toMatchObject({ ok: false });
    expect(validateBackup([1, 2])).toMatchObject({ ok: false });
    expect(validateBackup({ format: 'something-else' })).toMatchObject({ ok: false, error: expect.stringContaining('not a Linguas de Gato backup') });
    expect(validateBackup({ ...envelope({}), schemaVersion: BACKUP_SCHEMA_VERSION + 1 })).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
    expect(validateBackup({ ...envelope({}), stores: 'nope' })).toMatchObject({ ok: false, error: expect.stringContaining('damaged') });
    expect(validateBackup({ ...envelope({}), extra: 1 })).toMatchObject({ ok: false });
  });

  it('skips invalid and duplicate records, listing them, and ignores unknown data', () => {
    const broken = { ...speakingAttempt('bad', NOW, []), version: 99 };
    const result = validateBackup(
      envelope({ speakingAttempts: [speakingAttempt('a1', NOW, []), broken, speakingAttempt('a1', NOW, [])], somethingNew: [{}] }, { preferences: { 'ldg:theme': 'light', 'groq.apiKey': 'secret' } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.stores.speakingAttempts.map((r) => r.id)).toEqual(['a1']);
    expect(result.backup.invalid.map((item) => item.index)).toEqual([1, 2]);
    expect(result.backup.preferences).toEqual({ 'ldg:theme': 'light' });
    expect(result.backup.warnings.join(' ')).toContain('somethingNew');
    expect(result.backup.warnings.join(' ')).toContain('groq.apiKey');
  });

  it('strips unknown fields from records instead of importing them', () => {
    const tampered = { ...SESSION, injected: '<script>alert(1)</script>' };
    const result = validateBackup(envelope({ sessions: [tampered] }));
    // Strict schemas reject unknown keys outright, so nothing foreign is ever stored.
    if (result.ok) expect(result.backup.stores.sessions.every((record) => !('injected' in record))).toBe(true);
  });

  it('enforces record-count and string limits', () => {
    const tooMany = Array.from({ length: BACKUP_LIMITS.maxRecordsPerStore + 1 }, () => ({}));
    expect(validateBackup(envelope({ sessions: tooMany })).ok).toBe(false);
    expect(validateBackup(envelope({}, { preferences: { 'ldg:theme': 'x'.repeat(BACKUP_LIMITS.maxPreferenceChars + 1) } })).ok).toBe(false);
  });

  it('reports omitted media and rejects oversized media totals', () => {
    const omitted = validateBackup(envelope({}, { media: { included: false, items: [], omitted: [{ store: 'speakingRecordings', key: 'a1', size: 1000, label: 'Speaking a1' }] } }));
    expect(omitted.ok && omitted.backup.warnings.join(' ')).toContain('left out');
    const items = Array.from({ length: 3 }, (_, index) => ({ store: 'media', key: `s${index}`, mimeType: 'audio/mpeg', size: BACKUP_LIMITS.maxMediaItemBytes, data: '' }));
    expect(validateBackup(envelope({}, { media: { included: true, items, omitted: [] } }))).toMatchObject({ ok: false, error: expect.stringContaining('larger') });
  });
});

describe('planImport', () => {
  it('merges: adds new records, updates strictly newer ones and keeps the rest', () => {
    const older = writingAttempt('w1', NOW - 10_000, []);
    const newer = { ...older, updatedAt: NOW };
    const same = writingAttempt('w2', NOW, []);
    const incoming = { ...emptyIncoming(), writingAttempts: [newer, same, writingAttempt('w3', NOW, [])] };
    const plan = planImport({ writingAttempts: [older, same] }, incoming, 'merge');
    expect(plan.stores.writingAttempts).toMatchObject({ added: 1, updated: 1, kept: 1 });
    expect(plan.stores.writingAttempts.write.map((r) => r.id)).toEqual(['w1', 'w3']);
    expect(plan.clear).toBe(false);
  });

  it('never lets an older backup overwrite newer local work', () => {
    const local = { ...writingAttempt('w1', NOW, []), updatedAt: NOW };
    const stale = { ...local, updatedAt: NOW - 1 };
    const plan = planImport({ writingAttempts: [local] }, { ...emptyIncoming(), writingAttempts: [stale] }, 'merge');
    expect(plan.stores.writingAttempts.write).toEqual([]);
    expect(plan.totals.kept).toBe(1);
  });

  it('skips vocabulary entries that duplicate an expression saved under another id', () => {
    const local = vocabularyEntry('local', NOW, []);
    const incoming = { ...vocabularyEntry('other', NOW, []), key: local.key };
    const plan = planImport({ vocabularyEntries: [local] }, { ...emptyIncoming(), vocabularyEntries: [incoming] }, 'merge');
    expect(plan.stores.vocabularyEntries).toMatchObject({ added: 0, skippedDuplicates: 1 });
  });

  it('transcripts follow their session: replaced only with a newer or new session', () => {
    const transcript = { sessionId: 's1', version: 1, cues: [] };
    const keep = planImport({ sessions: [SESSION], transcripts: [transcript] }, { ...emptyIncoming(), sessions: [SESSION], transcripts: [transcript] }, 'merge');
    expect(keep.stores.transcripts.write).toEqual([]);
    const update = planImport({ sessions: [SESSION], transcripts: [transcript] }, { ...emptyIncoming(), sessions: [{ ...SESSION, updatedAt: SESSION.updatedAt + 1 }], transcripts: [transcript] }, 'merge');
    expect(update.stores.transcripts.write).toHaveLength(1);
  });

  it('replace writes everything after clearing', () => {
    const plan = planImport({ writingAttempts: [writingAttempt('local', NOW, [])] }, { ...emptyIncoming(), writingAttempts: [writingAttempt('w1', NOW, [])] }, 'replace');
    expect(plan.clear).toBe(true);
    expect(plan.stores.writingAttempts.write.map((r) => r.id)).toEqual(['w1']);
  });
});

describe('media helpers', () => {
  it('round-trips bytes through base64 and rejects malformed data', () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(() => base64ToBytes('not base64!')).toThrow();
    expect(() => base64ToBytes('abc')).toThrow();
  });

  it('clears media flags whose bytes are absent', () => {
    const fileSession = { ...SESSION, source: { kind: 'file', fileName: 'a.mp3', mimeType: 'audio/mpeg', size: 10, mediaStored: true } };
    expect(reconcileMediaFlags(fileSession, 'sessions', () => false)).toMatchObject({ source: { mediaStored: false } });
    expect(reconcileMediaFlags(fileSession, 'sessions', () => true)).toMatchObject({ source: { mediaStored: true } });
    const attempt = { ...speakingAttempt('a1', NOW, []), recording: { stored: true, mimeType: 'audio/webm' } };
    expect(reconcileMediaFlags(attempt, 'speakingAttempts', () => false)).toMatchObject({ recording: { stored: false } });
  });
});
