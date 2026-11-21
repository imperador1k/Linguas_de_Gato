import { describe, expect, it } from 'vitest';
import { describeMatch, matchVocabularyAnswer, normalizeTyped, typoAllowance } from './vocabulary-answers.js';

const en = (input: string, answer: string, accepted: string[] = [], forms: string[] = []) => matchVocabularyAnswer(input, { answer, accepted, forms }, 'en');

describe('normalizeTyped', () => {
  it('ignores case, outer spacing, sentence punctuation and quote styles', () => {
    expect(normalizeTyped('  "Booked."  ', 'en')).toBe('booked');
    expect(normalizeTyped('Look   After!', 'en')).toBe('look after');
    expect(normalizeTyped('don’t', 'en')).toBe("don't");
    expect(normalizeTyped('well – known', 'en')).toBe('well-known');
  });
});

describe('matchVocabularyAnswer', () => {
  it('accepts the expected answer regardless of case and punctuation', () => {
    expect(en('Booked.', 'booked')).toMatchObject({ verdict: 'correct', reason: 'exact' });
  });

  it('accepts explicitly listed alternatives and spelling variants, and nothing else', () => {
    expect(en('reserved', 'booked', ['reserved'])).toMatchObject({ verdict: 'correct', reason: 'variant', closest: 'reserved' });
    expect(en('color', 'colour', ['color'])).toMatchObject({ verdict: 'correct', reason: 'variant' });
    // A plausible synonym that is not listed is not accepted.
    expect(en('arranged', 'booked', ['reserved'])).toMatchObject({ verdict: 'incorrect' });
  });

  it('treats a hyphen and a space as the same in compounds', () => {
    expect(en('well known', 'well-known')).toMatchObject({ verdict: 'correct', reason: 'hyphenation' });
    expect(en('ice-cream', 'ice cream')).toMatchObject({ verdict: 'correct', reason: 'hyphenation' });
  });

  it('matches multiword expressions with irregular spacing', () => {
    expect(en('  run   out of ', 'run out of')).toMatchObject({ verdict: 'correct' });
  });

  it('treats accents as optional in English', () => {
    expect(en('cafe', 'café')).toMatchObject({ verdict: 'correct', reason: 'accents' });
  });

  it('keeps accents significant for languages without English rules', () => {
    // Only English is supported today; the strict default is what any future language gets.
    const result = matchVocabularyAnswer('cafe', { answer: 'café' }, 'xx' as 'en');
    expect(result).toMatchObject({ verdict: 'almost', reason: 'accents' });
  });

  it('calls a small typo almost, never correct', () => {
    expect(en('colegue', 'colleague')).toMatchObject({ verdict: 'almost', reason: 'spelling', closest: 'colleague' });
    expect(en('recieve', 'receive')).toMatchObject({ verdict: 'almost', reason: 'spelling' });
    expect(en('knowlege', 'knowledge')).toMatchObject({ verdict: 'almost' });
  });

  it('counts an adjacent swap as one mistake', () => {
    expect(en('frinedly', 'friendly')).toMatchObject({ verdict: 'almost' });
  });

  it('allows no typos in very short words', () => {
    expect(typoAllowance(3)).toBe(0);
    expect(en('ga', 'go')).toMatchObject({ verdict: 'incorrect' });
  });

  it('recognises the right word in the wrong form, and does not accept the lemma for an inflected gap', () => {
    expect(en('go', 'went', [], ['go', 'goes', 'gone', 'going'])).toMatchObject({ verdict: 'wrong_form', closest: 'went' });
    expect(en('book', 'booked', ['reserved'], ['book', 'books', 'booking'])).toMatchObject({ verdict: 'wrong_form' });
    // A misspelt other form still points at the right word in the wrong form.
    expect(en('childs', 'children', [], ['child'])).toMatchObject({ verdict: 'wrong_form' });
  });

  it('prefers a listed answer over a form when both could apply', () => {
    expect(en('gone', 'gone', [], ['go', 'gone'])).toMatchObject({ verdict: 'correct' });
  });

  it('reports an empty answer', () => {
    expect(en('   ', 'book')).toMatchObject({ verdict: 'empty' });
  });

  it('explains each verdict', () => {
    expect(describeMatch(en('booked', 'booked'))).toBe('Correct.');
    expect(describeMatch(en('colegue', 'colleague'))).toContain('Almost — check the spelling');
    expect(describeMatch(en('go', 'went', [], ['go']))).toContain('Correct word, wrong grammatical form');
    expect(describeMatch(en('table', 'booked'))).toBe('Incorrect — expected answer: “booked”.');
  });
});
