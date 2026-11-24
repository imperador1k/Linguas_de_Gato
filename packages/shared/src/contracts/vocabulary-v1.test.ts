import { describe, expect, it } from 'vitest';
import { V1_NOW as NOW, personalEntry } from '../domain/vocabulary-fixtures.test-helpers.js';
import { planImport, validateBackup } from '../learning/backup.js';
import { vocabularyEntry } from '../learning/fixtures.test-helpers.js';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, BACKUP_STORE_NAMES, type BackupStoreName } from './backup.js';
import { vocabularyEntrySchema, vocabularyPracticeSetSchema } from './vocabulary.js';

/*
 * V1 (personal vocabulary) only adds optional fields and a new local question
 * type, so records and backups written before it must keep validating
 * unchanged, and new records must survive a backup round trip.
 */

/** A trainer round exactly as stored before V1 (pack ref without `kind`, no `partOfSpeech`). */
const legacyRound = {
  id: 'old-round',
  version: 1,
  entryIds: ['demo-everyday/en:book:verb/s1'],
  types: ['spelling'],
  questions: [
    {
      id: 'q1',
      type: 'spelling',
      itemId: 'demo-everyday/en:book:verb/s1',
      prompt: 'reservar',
      explanation: 'PT: reservar',
      language: 'en',
      lemma: 'book',
      answer: 'book',
      accepted: [],
      forms: ['booked', 'books'],
      ref: { packId: 'demo-everyday', packVersion: '1.0.0', entryId: 'en:book:verb', senseId: 's1', contextId: null },
    },
  ],
  shuffles: {},
  discarded: 0,
  model: 'local',
  answers: [{ kind: 'typed', questionId: 'q1', text: 'book', hints: [], answeredAt: NOW }],
  reviews: [],
  checkedAt: NOW,
  history: [{ checkedAt: NOW, correct: 1, objectiveTotal: 1 }],
  createdAt: NOW,
  updatedAt: NOW,
};

const trainedEntry = () => {
  const entry = personalEntry('eat', {});
  return {
    ...entry,
    senses: [{ ...entry.senses[0]!, knowledge: { recall: { step: 1, dueAt: NOW + 1, attempts: [{ at: NOW, outcome: 'correct' as const, hints: 0, expected: 'eat', roundId: 'r1' }] } } }],
  };
};

function envelope(stores: Partial<Record<BackupStoreName, unknown[]>>) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: NOW,
    app: { version: '0.1.0', databaseVersion: 6 },
    counts: Object.fromEntries(Object.entries(stores).map(([name, records]) => [name, records?.length ?? 0])),
    stores,
    preferences: {},
    media: { included: false, items: [], omitted: [] },
  };
}

describe('records from before V1', () => {
  it('still validate: entries without personal fields and rounds with pack refs', () => {
    expect(vocabularyEntrySchema.safeParse(vocabularyEntry('legacy', NOW, [{ at: NOW, rating: 'good' }])).success).toBe(true);
    expect(vocabularyPracticeSetSchema.safeParse(legacyRound).success).toBe(true);
  });

  it('new records validate, and malformed evidence is rejected', () => {
    expect(vocabularyEntrySchema.safeParse(trainedEntry()).success).toBe(true);
    const bad = trainedEntry();
    expect(vocabularyEntrySchema.safeParse({ ...bad, senses: [{ ...bad.senses[0], knowledge: { spelling: { step: 1, dueAt: 1, attempts: [] } } }] }).success).toBe(false);
    expect(vocabularyEntrySchema.safeParse({ ...bad, senses: [{ ...bad.senses[0], knowledge: { recall: { step: 1, dueAt: 1, attempts: [{ at: 1, outcome: 'great', hints: 0, expected: 'x', roundId: null }] } } }] }).success).toBe(false);
    // A collection ref must say so; a pack ref may not carry `kind`.
    const question = { ...legacyRound.questions[0], ref: { kind: 'collection', entryId: 'eat', senseId: 'eat-s1', contextId: null } };
    expect(vocabularyPracticeSetSchema.safeParse({ ...legacyRound, questions: [question] }).success).toBe(true);
    expect(vocabularyPracticeSetSchema.safeParse({ ...legacyRound, questions: [{ ...question, ref: { ...legacyRound.questions[0]!.ref, kind: 'pack' } }] }).success).toBe(false);
  });
});

describe('backups', () => {
  it('imports a backup made before V1 unchanged, and a V1 backup with its evidence', () => {
    const old = validateBackup(JSON.parse(JSON.stringify(envelope({ vocabularyEntries: [vocabularyEntry('legacy', NOW, [])], vocabularyPracticeSets: [legacyRound] }))));
    expect(old).toMatchObject({ ok: true });
    if (!old.ok) return;
    expect(old.backup.invalid).toEqual([]);
    expect(old.backup.stores.vocabularyPracticeSets).toEqual([legacyRound]);

    const current = validateBackup(JSON.parse(JSON.stringify(envelope({ vocabularyEntries: [trainedEntry()] }))));
    expect(current).toMatchObject({ ok: true });
    if (!current.ok) return;
    expect(current.backup.invalid).toEqual([]);
    expect(current.backup.stores.vocabularyEntries[0]).toEqual(trainedEntry());
  });

  it('merges by expression: a newer copy with more evidence replaces the older one', () => {
    const local = personalEntry('eat', {});
    const incoming = { ...trainedEntry(), updatedAt: local.updatedAt + 1 };
    const empty = Object.fromEntries(BACKUP_STORE_NAMES.map((name) => [name, []])) as unknown as Record<BackupStoreName, Record<string, unknown>[]>;
    const plan = planImport({ vocabularyEntries: [local] }, { ...empty, vocabularyEntries: [incoming] }, 'merge');
    expect(plan.stores.vocabularyEntries).toMatchObject({ updated: 1, added: 0 });
  });
});
