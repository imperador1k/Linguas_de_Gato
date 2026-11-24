import { describe, expect, it } from 'vitest';
import { personalSenseInputSchema } from '../contracts/vocabulary-personal.js';
import { vocabularyEntrySchema, type VocabularyEntry } from '../contracts/vocabulary.js';
import { V1_NOW as NOW, personalInput } from './vocabulary-fixtures.test-helpers.js';
import { withFacetAttempt } from './vocabulary-knowledge.js';
import { addPersonalSense, changesExpression, checkDuplicate, editPersonalSense, inputFromSense, parseAnswerList, translationsOf } from './vocabulary-personal.js';
import { saveLookup } from './vocabulary.js';

const ids = (n: number) => ({ entryId: `entry-${n}`, senseId: `sense-${n}` });

describe('typed lists', () => {
  it('splits on commas, semicolons and new lines, trims, and drops duplicates (any case)', () => {
    expect(parseAnswerList(' comer, almoçar;  Comer \n jantar ,, ', 6)).toEqual(['comer', 'almoçar', 'jantar']);
    expect(parseAnswerList('a, b, c', 2)).toEqual(['a', 'b']);
    expect(parseAnswerList('', 6)).toEqual([]);
  });
});

describe('the input schema', () => {
  it('requires the word and a Portuguese meaning, and limits words', () => {
    expect(personalSenseInputSchema.safeParse(personalInput()).success).toBe(true);
    expect(personalSenseInputSchema.safeParse(personalInput({ translations: [] })).success).toBe(false);
    expect(personalSenseInputSchema.safeParse(personalInput({ expression: '  ' })).success).toBe(false);
    expect(personalSenseInputSchema.safeParse(personalInput({ expression: 'one two three four five six seven eight nine' })).success).toBe(false);
    expect(personalSenseInputSchema.safeParse({ ...personalInput(), extra: true }).success).toBe(false);
  });
});

describe('adding a personal word', () => {
  it('creates a valid entry with a manual sense and its own answer data', () => {
    const { entry, outcome, senseId } = addPersonalSense(null, personalInput({ notes: 'irregular' }), NOW, ids(1));
    expect(outcome).toBe('created');
    expect(senseId).toBe('sense-1');
    expect(vocabularyEntrySchema.parse(entry)).toBeTruthy();
    expect(entry).toMatchObject({ expression: 'eat', lemma: 'eat', key: 'eat', kind: 'word', language: 'en' });
    expect(entry.senses[0]).toMatchObject({
      source: { kind: 'manual' },
      translations: ['comer'],
      forms: ['eats', 'ate', 'eaten'],
      context: 'I usually eat breakfast at 8 AM.',
      examples: ['I usually eat breakfast at 8 AM.'],
      partOfSpeech: 'verb',
      notes: 'irregular',
    });
    // Saving is not knowing: no evidence until the word is trained.
    expect(entry.senses[0]?.knowledge).toBeUndefined();
  });

  it('keeps two meanings of the same spelling as separate senses of one entry', () => {
    const noun = addPersonalSense(null, personalInput({ expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '', forms: ['books'] }), NOW, ids(1)).entry;
    const verb = addPersonalSense(noun, personalInput({ expression: 'Book', translations: ['reservar'], partOfSpeech: 'verb', example: 'We booked a table.', forms: ['booked'] }), NOW + 1, ids(2));
    expect(verb.outcome).toBe('added_sense');
    expect(verb.entry.id).toBe('entry-1');
    expect(verb.entry.senses.map((sense) => [sense.id, sense.partOfSpeech, translationsOf(sense)])).toEqual([
      ['sense-1', 'noun', ['livro']],
      ['sense-2', 'verb', ['reservar']],
    ]);
  });

  it('refuses the same meaning twice, ignoring case, accents, punctuation and a leading article', () => {
    const { entry } = addPersonalSense(null, personalInput({ expression: 'book', translations: ['livro'], partOfSpeech: 'noun', example: '' }), NOW, ids(1));
    for (const translation of ['Livro', 'o livro', 'livro.', 'lívro']) {
      const again = addPersonalSense(entry, personalInput({ expression: 'book', translations: [translation], partOfSpeech: 'noun', example: '' }), NOW, ids(2));
      expect(again.outcome).toBe('already_saved');
      expect(again.senseId).toBe('sense-1');
      expect(again.entry).toBe(entry);
    }
    // An unspecified part of speech is compatible with any.
    expect(checkDuplicate(entry, { translations: ['livro'], partOfSpeech: '' }).kind).toBe('duplicate');
    // The same translation in another part of speech is another meaning.
    expect(checkDuplicate(entry, { translations: ['livro'], partOfSpeech: 'verb' }).kind).toBe('new_sense');
    // A shared alternative translation also counts.
    expect(checkDuplicate(entry, { translations: ['caderno', 'livro'], partOfSpeech: 'noun' }).kind).toBe('duplicate');
  });

  it('stops at ten meanings', () => {
    let entry = addPersonalSense(null, personalInput({ translations: ['t0'] }), NOW, ids(0)).entry;
    for (let index = 1; index < 10; index += 1) entry = addPersonalSense(entry, personalInput({ translations: [`t${index}`] }), NOW, ids(index)).entry;
    expect(entry.senses).toHaveLength(10);
    expect(addPersonalSense(entry, personalInput({ translations: ['t10'] }), NOW, ids(10)).outcome).toBe('full');
  });
});

describe('editing', () => {
  const created = () => addPersonalSense(null, personalInput(), NOW, ids(1)).entry;

  it('round-trips the form values', () => {
    const entry = created();
    expect(inputFromSense(entry, entry.senses[0]!)).toEqual(personalInput());
  });

  it('updates a manual sense and keeps its id, provenance and evidence', () => {
    const entry = created();
    const trained: VocabularyEntry = {
      ...entry,
      senses: [withFacetAttempt(entry.senses[0]!, 'recall', { result: { verdict: 'correct', reason: 'exact', closest: 'eat' }, hints: 0, expected: 'eat', roundId: 'r1' }, NOW)],
    };
    const edited = editPersonalSense(trained, 'sense-1', personalInput({ translations: ['comer', 'alimentar-se'], example: 'They ate together.', notes: '' }), NOW + 5);
    const sense = edited.senses[0]!;
    expect(vocabularyEntrySchema.parse(edited)).toBeTruthy();
    expect(sense).toMatchObject({ id: 'sense-1', source: { kind: 'manual' }, translations: ['comer', 'alimentar-se'], contextualMeaning: 'comer, alimentar-se', context: 'They ate together.' });
    expect(sense.knowledge?.recall?.attempts).toHaveLength(1);
    expect('notes' in sense).toBe(false);
    expect(edited.updatedAt).toBe(NOW + 5);
  });

  it('adds answer data to a Reading sense without touching its sentence or meanings', () => {
    const lookup = {
      expression: 'booked',
      lemma: 'book',
      kind: 'word' as const,
      partOfSpeech: 'verb',
      contextualMeaning: 'reserved a table',
      dictionaryMeaning: 'to arrange to have a seat or room',
      contextEvidence: 'We booked a table',
      collocations: [],
      synonyms: ['reserve'],
      antonyms: [],
      register: 'neutral' as const,
      examples: ['I booked a room.', 'Book early.'],
      patterns: [],
      cefrEstimate: 'A2' as const,
      portugueseExplanation: 'reservou',
    };
    const { entry } = saveLookup(null, lookup, { sentence: 'We booked a table for two.', source: { kind: 'reading', textId: 't', title: 'T', paragraphIndex: 0 } }, NOW, { entryId: 'e', senseId: 's' });
    const edited = editPersonalSense(entry, 's', personalInput({ expression: 'book', translations: ['reservar'], example: 'ignored for Reading senses', forms: ['booked'] }), NOW + 1);
    expect(edited.senses[0]).toMatchObject({ context: 'We booked a table for two.', contextualMeaning: 'reserved a table', translations: ['reservar'], forms: ['booked'], source: { kind: 'reading' } });
    expect(edited.expression).toBe('booked');
  });

  it('changes the dictionary form and key when the English word is corrected', () => {
    const entry = addPersonalSense(null, personalInput({ expression: 'recieve', translations: ['receber'] }), NOW, ids(1)).entry;
    expect(changesExpression(entry, { expression: 'receive' })).toBe(true);
    expect(changesExpression(entry, { expression: 'Recieve' })).toBe(false);
    const edited = editPersonalSense(entry, 'sense-1', personalInput({ expression: 'receive', translations: ['receber'] }), NOW + 1);
    expect(edited).toMatchObject({ expression: 'receive', lemma: 'receive', key: 'receive' });
  });

  it('ignores the sense being edited when checking duplicates', () => {
    const entry = created();
    expect(checkDuplicate(entry, { translations: ['comer'], partOfSpeech: 'verb' }, 'sense-1').kind).toBe('new_sense');
  });
});

describe('translations of senses saved before V1', () => {
  it('reads a library sense’s translations back from its Portuguese explanation; Reading explanations are not translations', () => {
    const library = { source: { kind: 'library' as const, packId: 'p', packVersion: '1.0.0', entryId: 'e', senseId: 's' }, portugueseExplanation: 'reservar, marcar' };
    expect(translationsOf(library)).toEqual(['reservar', 'marcar']);
    expect(translationsOf({ source: { kind: 'reading', textId: 't', title: 't', paragraphIndex: 0 }, portugueseExplanation: 'Significa reservar algo.' })).toEqual([]);
    expect(translationsOf({ ...library, translations: ['x'] })).toEqual(['x']);
  });
});
