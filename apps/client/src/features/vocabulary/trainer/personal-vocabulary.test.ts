import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  NO_PACK_FILTERS,
  initialReviewState,
  translationsOf,
  vocabularyPackSchema,
  type LocalVocabularyQuestion,
  type ModelVocabularyLookup,
  type PersonalSenseInput,
  type VocabularyEntry,
  type VocabularyPack,
  type VocabularyPracticeSet,
} from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { applyImport, createBackup, readBackupFile } from '@/features/data-management/backup-service';
import { openAppDatabase } from '@/lib/storage/app-database';
import { addPersonalWord, editPersonalWord, indexedDbVocabularyRepository, memoryVocabularyRepository, saveToCollection, type VocabularyRepository } from '../storage/vocabulary-repository';
import { finishRound, localQuestions, migrateTrainerEvidence, retryMissed, saveAnswer, startCollectionRound, startRound } from './trainer-service';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 12);
const packFiles = import.meta.glob<unknown>('../../../../public/content/vocabulary/en/demo-everyday.json', { eager: true, import: 'default' });
const pack: VocabularyPack = vocabularyPackSchema.parse(Object.values(packFiles)[0]);

const input = (overrides: Partial<PersonalSenseInput> = {}): PersonalSenseInput => ({
  expression: 'eat',
  translations: ['comer'],
  partOfSpeech: 'verb',
  example: 'I usually ate breakfast at 8 AM.',
  alternatives: [],
  forms: ['eats', 'ate', 'eaten'],
  notes: '',
  ...overrides,
});

async function answer(repository: VocabularyRepository, set: VocabularyPracticeSet, text: (question: LocalVocabularyQuestion) => string, at = NOW) {
  for (const question of localQuestions(set)) await saveAnswer(repository, set.id, { kind: 'typed', questionId: question.id, text: text(question), hints: [], answeredAt: at }, at);
}

const only = async (repository: VocabularyRepository) => {
  const entries = await repository.entries.list();
  expect(entries).toHaveLength(1);
  return entries[0] as VocabularyEntry;
};

describe('managing personal vocabulary', () => {
  it('adds, refuses duplicates, adds a second meaning, and edits without losing progress', async () => {
    const repository = memoryVocabularyRepository();
    const created = await addPersonalWord(repository, input({ expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '', forms: ['books'] }), NOW);
    expect(created.outcome).toBe('created');
    expect((await addPersonalWord(repository, input({ expression: 'Book', translations: ['O livro'], partOfSpeech: 'noun', example: '', forms: [] }), NOW)).outcome).toBe('already_saved');
    const verb = await addPersonalWord(repository, input({ expression: 'book', translations: ['reservar'], partOfSpeech: 'verb', example: 'We booked a table.', forms: ['booked'] }), NOW);
    expect(verb.outcome).toBe('added_sense');
    const entry = await only(repository);
    expect(entry.senses.map((sense) => translationsOf(sense))).toEqual([['livro'], ['reservar']]);

    // Editing the verb to also accept "marcar".
    const edited = await editPersonalWord(repository, entry.id, verb.senseId, input({ expression: 'book', translations: ['reservar', 'marcar'], partOfSpeech: 'verb', example: 'We booked a table.', forms: ['booked'] }), NOW + 1);
    expect(edited.kind).toBe('saved');
    expect(translationsOf((await only(repository)).senses[1]!)).toEqual(['reservar', 'marcar']);
    // Editing it into a copy of the noun meaning is refused.
    expect((await editPersonalWord(repository, entry.id, verb.senseId, input({ expression: 'book', translations: ['livro'], partOfSpeech: '', example: '', forms: [] }), NOW + 2)).kind).toBe('duplicate');
  });

  it('refuses to rename an expression onto another saved one', async () => {
    const repository = memoryVocabularyRepository();
    await addPersonalWord(repository, input({ expression: 'receive', translations: ['receber'] }), NOW);
    const typo = await addPersonalWord(repository, input({ expression: 'recieve', translations: ['acolher'] }), NOW);
    expect((await editPersonalWord(repository, typo.entry.id, typo.senseId, input({ expression: 'receive', translations: ['acolher'] }), NOW + 1)).kind).toBe('conflict');
    expect((await editPersonalWord(repository, typo.entry.id, typo.senseId, input({ expression: 'welcome', translations: ['acolher'] }), NOW + 1)).kind).toBe('saved');
    expect((await repository.entries.list()).map((entry) => entry.key).sort()).toEqual(['receive', 'welcome']);
  });

  it('validates input before writing anything', async () => {
    const repository = memoryVocabularyRepository();
    await expect(addPersonalWord(repository, input({ translations: [] }), NOW)).rejects.toThrow();
    expect(await repository.entries.list()).toEqual([]);
  });
});

describe('training the personal collection', () => {
  it('records English → Portuguese evidence on that sense and direction only', async () => {
    const repository = memoryVocabularyRepository();
    await addPersonalWord(repository, input(), NOW);
    const set = (await startCollectionRound(repository, { entries: await repository.entries.list(), exercise: 'recognition', focus: 'new', count: 5, now: NOW, seed: 'x' }))!;
    expect(localQuestions(set).map((question) => [question.type, question.prompt, question.answer])).toEqual([['recognition', 'eat', 'comer']]);
    await answer(repository, set, () => 'o comer');
    const outcome = (await finishRound(repository, set.id, null, NOW))!;
    expect(outcome).toMatchObject({ added: 0, rescheduled: 1 });
    const entry = await only(repository);
    expect(entry.senses[0]?.knowledge?.recognition).toMatchObject({ step: 1, dueAt: NOW + DAY, attempts: [{ outcome: 'correct', expected: 'comer', roundId: set.id }] });
    expect(entry.senses[0]?.knowledge?.recall).toBeUndefined();
    expect(entry.senses[0]?.knowledge?.context).toBeUndefined();
    // The self-rated review schedule is the learner's own; the trainer does not move it.
    expect(entry.review).toEqual(initialReviewState(NOW));
  });

  it('keeps the two meanings of "book" apart', async () => {
    const repository = memoryVocabularyRepository();
    await addPersonalWord(repository, input({ expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '', forms: [] }), NOW);
    await addPersonalWord(repository, input({ expression: 'book', translations: ['reservar'], partOfSpeech: 'verb', example: '', forms: ['booked'] }), NOW);
    const set = (await startCollectionRound(repository, { entries: await repository.entries.list(), exercise: 'recall', focus: 'mixed', count: 10, now: NOW, seed: 'b' }))!;
    const [question] = localQuestions(set);
    expect(localQuestions(set)).toHaveLength(1);
    await answer(repository, set, () => 'booked');
    await finishRound(repository, set.id, null, NOW);
    const entry = await only(repository);
    const trained = entry.senses.find((sense) => question?.ref && 'kind' in question.ref && sense.id === question.ref.senseId)!;
    const other = entry.senses.find((sense) => sense.id !== trained.id)!;
    expect(trained.knowledge?.recall?.attempts.map((attempt) => attempt.outcome)).toEqual(['wrong_form']);
    expect(other.knowledge).toBeUndefined();
  });

  it('checks context answers against the form the sentence needs', async () => {
    const repository = memoryVocabularyRepository();
    await addPersonalWord(repository, input(), NOW);
    const set = (await startCollectionRound(repository, { entries: await repository.entries.list(), exercise: 'context', focus: 'mixed', count: 5, now: NOW, seed: 'c' }))!;
    expect(localQuestions(set)[0]).toMatchObject({ type: 'context', prompt: 'I usually ___ breakfast at 8 AM.', answer: 'ate' });
    await answer(repository, set, () => 'eat');
    await finishRound(repository, set.id, null, NOW);
    expect((await only(repository)).senses[0]?.knowledge?.context?.attempts).toEqual([{ at: NOW, outcome: 'wrong_form', hints: 0, expected: 'ate', roundId: set.id }]);
    // The hard one can be practised again straight away.
    const checked = (await repository.practiceSets.get(set.id))!;
    const retry = await retryMissed(repository, checked, NOW + 1);
    expect(localQuestions(retry!)[0]?.ref).toMatchObject({ kind: 'collection' });
  });

  it('leaves no evidence for an abandoned round, and resumes it after a reload', async () => {
    const factory = new IDBFactory();
    const first = indexedDbVocabularyRepository(await openAppDatabase(factory));
    await addPersonalWord(first, input(), NOW);
    await addPersonalWord(first, input({ expression: 'run', translations: ['correr'], example: '', forms: [] }), NOW);
    const set = (await startCollectionRound(first, { entries: await first.entries.list(), exercise: 'recall', focus: 'new', count: 5, now: NOW, seed: 'r' }))!;
    const [q1] = localQuestions(set);
    await saveAnswer(first, set.id, { kind: 'typed', questionId: q1!.id, text: q1!.answer, hints: ['length'], answeredAt: NOW }, NOW);
    expect((await first.entries.list()).every((entry) => entry.senses.every((sense) => sense.knowledge === undefined))).toBe(true);

    const reopened = indexedDbVocabularyRepository(await openAppDatabase(factory));
    const stored = (await reopened.practiceSets.get(set.id))!;
    expect(stored.checkedAt).toBeNull();
    expect(stored.answers).toEqual([{ kind: 'typed', questionId: q1!.id, text: q1!.answer, hints: ['length'], answeredAt: NOW }]);
    await answer(reopened, stored, (question) => question.answer, NOW + 1000);
    await finishRound(reopened, set.id, null, NOW + 1000);
    const entries = await indexedDbVocabularyRepository(await openAppDatabase(factory)).entries.list();
    const attempts = entries.flatMap((entry) => entry.senses.map((sense) => sense.knowledge?.recall?.attempts ?? []));
    // The first answer kept its hint (weak evidence); the second was unaided.
    expect(attempts.map((list) => list.map((attempt) => attempt.hints)).sort()).toEqual([[0], [1]]);
  });

  it('still checks a round when a word was deleted meanwhile', async () => {
    const repository = memoryVocabularyRepository();
    const { entry } = await addPersonalWord(repository, input(), NOW);
    const set = (await startCollectionRound(repository, { entries: [entry], exercise: 'recognition', focus: 'mixed', count: 5, now: NOW }))!;
    await answer(repository, set, () => 'comer');
    await repository.entries.delete(entry.id);
    expect((await finishRound(repository, set.id, null, NOW))?.set.checkedAt).toBe(NOW);
    expect(await repository.entries.list()).toEqual([]);
  });
});

describe('library rounds', () => {
  it('saves a 15-word round (stored sets used to stop at 12 questions)', async () => {
    const repository = memoryVocabularyRepository();
    const set = await startRound(repository, { pack, filters: NO_PACK_FILTERS, mode: 'spelling', count: 15, collection: [], now: NOW, seed: 'big' });
    expect(set?.questions).toHaveLength(15);
  });

  it('trains English → Portuguese on the pack and stores the pack’s answer data with the word', async () => {
    const repository = memoryVocabularyRepository();
    const set = (await startRound(repository, { pack, filters: { ...NO_PACK_FILTERS, query: 'laptop' }, mode: 'recognition', count: 1, collection: [], now: NOW, seed: 'l' }))!;
    const [question] = localQuestions(set);
    expect(question).toMatchObject({ type: 'recognition', prompt: 'laptop' });
    await answer(repository, set, (item) => item.answer);
    await finishRound(repository, set.id, pack, NOW);
    const entry = await only(repository);
    expect(entry.senses[0]).toMatchObject({ translations: expect.arrayContaining([question!.answer]), knowledge: { recognition: { step: 1 } } });
    // Now it can be trained from the collection too, in the other direction.
    const own = await startCollectionRound(repository, { entries: [entry], exercise: 'recall', focus: 'new', count: 1, now: NOW });
    expect(localQuestions(own!)[0]).toMatchObject({ type: 'spelling', answer: 'laptop', ref: { kind: 'collection' } });
  });

  it('rebuilds evidence for words trained before V1 from their rounds, once, then builds on it', async () => {
    const repository = memoryVocabularyRepository();
    // A round checked before V1, and the entry it produced (no per-facet evidence, a moved entry schedule).
    const old = (await startRound(repository, { pack, filters: { ...NO_PACK_FILTERS, query: 'laptop' }, mode: 'spelling', count: 1, collection: [], now: NOW - 2 * DAY, seed: 'o' }))!;
    await answer(repository, old, (question) => question.answer, NOW - 2 * DAY);
    await finishRound(repository, old.id, pack, NOW - 2 * DAY);
    const current = await only(repository);
    const legacy: VocabularyEntry = {
      ...current,
      senses: current.senses.map(({ knowledge: _knowledge, translations: _t, alternatives: _a, forms: _f, ...sense }) => sense),
      review: { ...current.review, step: 1, status: 'learning', dueAt: NOW - DAY, history: [{ at: NOW - 2 * DAY, rating: 'good', via: 'trainer' }] },
    };
    await repository.entries.put(legacy);

    expect(await migrateTrainerEvidence(repository)).toBe(1);
    const migrated = await only(repository);
    expect(migrated.senses[0]?.knowledge?.recall).toMatchObject({ step: 1, dueAt: NOW - DAY, attempts: [{ roundId: old.id }] });
    expect(migrated.review).toEqual(legacy.review);
    expect(await migrateTrainerEvidence(repository)).toBe(0);

    // A new round on the due word moves it from the rebuilt step, not from zero.
    const next = (await startRound(repository, { pack, filters: { ...NO_PACK_FILTERS, query: 'laptop' }, mode: 'spelling', count: 1, collection: [migrated], now: NOW, seed: 'n' }))!;
    await answer(repository, next, (question) => question.answer);
    await finishRound(repository, next.id, pack, NOW);
    expect((await only(repository)).senses[0]?.knowledge?.recall?.step).toBe(2);
  });
});

describe('saving from Reading', () => {
  const lookup: ModelVocabularyLookup = {
    expression: 'breaking even',
    lemma: 'break even',
    kind: 'idiom',
    partOfSpeech: 'phrase',
    contextualMeaning: 'making neither a profit nor a loss',
    dictionaryMeaning: 'to have no profit or loss',
    contextEvidence: 'breaking even',
    collocations: [],
    synonyms: [],
    antonyms: [],
    register: 'neutral',
    examples: ['The shop is breaking even.', 'We broke even last year.'],
    patterns: [],
    cefrEstimate: 'B2',
    portugueseExplanation: null,
  };
  const context = { sentence: 'Some owners admit they are only breaking even.', source: { kind: 'reading' as const, textId: 't1', title: 'Bookshops', paragraphIndex: 1 } };

  it('stores the learner’s translation on the new sense, making it trainable in both directions', async () => {
    const repository = memoryVocabularyRepository();
    const { outcome } = await saveToCollection(repository, lookup, context, NOW, ['não ter lucro nem prejuízo']);
    expect(outcome).toBe('created');
    const entry = await only(repository);
    expect(entry.senses[0]).toMatchObject({ translations: ['não ter lucro nem prejuízo'], source: { kind: 'reading' } });
    const set = await startCollectionRound(repository, { entries: [entry], exercise: 'mixed', focus: 'new', count: 1, now: NOW, seed: 'm' });
    expect(localQuestions(set!)[0]?.type).toBe('recognition');
  });

  it('without a translation, still saves exactly as before and offers context practice from its sentences', async () => {
    const repository = memoryVocabularyRepository();
    await saveToCollection(repository, lookup, context, NOW);
    const entry = await only(repository);
    expect(entry.senses[0]?.translations).toBeUndefined();
    const prompts = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const set = await startCollectionRound(repository, { entries: [entry], exercise: 'mixed', focus: 'new', count: 1, now: NOW, seed });
      const [question] = localQuestions(set!);
      expect(question).toMatchObject({ type: 'context', answer: 'breaking even' });
      prompts.add(question!.prompt);
    }
    // The sentence it was met in, or the lookup's example that uses the same form; never "We broke even…", whose form is not listed.
    expect([...prompts].every((prompt) => ['Some owners admit they are only ___.', 'The shop is ___.'].includes(prompt))).toBe(true);
  });
});

describe('backup and restore', () => {
  it('round-trips personal words, their evidence and rounds through a backup file', async () => {
    const source = await openAppDatabase(new IDBFactory());
    const repository = indexedDbVocabularyRepository(source);
    await addPersonalWord(repository, input({ notes: 'irregular past' }), NOW);
    const set = (await startCollectionRound(repository, { entries: await repository.entries.list(), exercise: 'recall', focus: 'new', count: 1, now: NOW }))!;
    await answer(repository, set, () => 'eat');
    await finishRound(repository, set.id, null, NOW);
    const before = await repository.entries.list();

    const backup = await createBackup(source, { includeMedia: false, now: NOW, storage: null });
    const parsed = await readBackupFile(new Blob([backup.json]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.invalid).toEqual([]);

    const target = await openAppDatabase(new IDBFactory());
    await applyImport(target, parsed.backup, 'replace', { storage: null });
    const restored = indexedDbVocabularyRepository(target);
    expect(await restored.entries.list()).toEqual(before);
    expect((await restored.practiceSets.get(set.id))?.checkedAt).toBe(NOW);
  });
});
