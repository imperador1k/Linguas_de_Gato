import { describe, expect, it } from 'vitest';
import { alignSequences, compareTexts, normalizeWord, tokenizeForComparison, wordDistance } from './text-compare.js';

const norms = (text: string, options?: Parameters<typeof tokenizeForComparison>[1]) =>
  tokenizeForComparison(text, options).map((token) => token.normalized);

describe('normalizeWord', () => {
  it('lowercases and unifies apostrophe variants', () => {
    expect(normalizeWord('Don’t')).toBe("don't");
    expect(normalizeWord('DONʼT')).toBe("don't");
    expect(normalizeWord('don`t')).toBe("don't");
  });

  it('drops periods inside abbreviations but keeps decimal points', () => {
    expect(normalizeWord('U.S')).toBe('us');
    expect(normalizeWord('e.g')).toBe('eg');
    expect(normalizeWord('3.5')).toBe('3.5');
  });

  it('drops thousands separators but keeps clock times', () => {
    expect(normalizeWord('1,000')).toBe('1000');
    expect(normalizeWord('10:30')).toBe('10:30');
  });
});

describe('tokenizeForComparison', () => {
  it('returns no tokens for empty or punctuation-only input', () => {
    expect(tokenizeForComparison('')).toEqual([]);
    expect(tokenizeForComparison('   \n\t ')).toEqual([]);
    expect(tokenizeForComparison('... — !? >>')).toEqual([]);
  });

  it('ignores case, whitespace and surrounding punctuation', () => {
    expect(norms('  Hello,   WORLD!\n How are you?  ')).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('keeps contractions as single, distinct words', () => {
    expect(norms("I'm sure they'll say it's fine, don't you think?")).toEqual([
      "i'm",
      'sure',
      "they'll",
      'say',
      "it's",
      'fine',
      "don't",
      'you',
      'think',
    ]);
  });

  it('treats curly and straight apostrophes the same', () => {
    expect(norms('We’re here')).toEqual(norms("We're here"));
  });

  it('strips quotation marks and leading or trailing apostrophes', () => {
    expect(norms('"Hello," she said. \'Quite.\'')).toEqual(['hello', 'she', 'said', 'quite']);
    expect(norms("the students' books")).toEqual(['the', 'students', 'books']);
  });

  it('splits hyphenated and slashed compounds into words', () => {
    expect(norms('a well-known, up-to-date and/or long—very long—answer')).toEqual([
      'a',
      'well',
      'known',
      'up',
      'to',
      'date',
      'and',
      'or',
      'long',
      'very',
      'long',
      'answer',
    ]);
  });

  it('keeps numbers, decimals, abbreviations and times intact', () => {
    expect(norms('It cost $3.50, about 1,000 in the U.S. at 10:30.')).toEqual([
      'it',
      'cost',
      '3.50',
      'about',
      '1000',
      'in',
      'the',
      'us',
      'at',
      '10:30',
    ]);
  });

  it('ignores bracketed sound descriptions and music notes by default', () => {
    expect(norms('[Music] Well (laughs) ♪ la la ♪ okay')).toEqual(['well', 'la', 'la', 'okay']);
    expect(norms('[Music] Well (laughs)', { ignoreBracketed: false })).toEqual(['music', 'well', 'laughs']);
  });

  it('handles accented letters and combining marks', () => {
    expect(norms('Café naïve résumé')).toEqual(['café', 'naïve', 'résumé']);
    // "e" followed by a combining acute accent normalises to the precomposed form.
    expect(norms('Café')).toEqual(['café']);
  });

  it('records the original spelling and offsets of every word', () => {
    const tokens = tokenizeForComparison('Hi, Don’t go!');
    expect(tokens.map((token) => token.text)).toEqual(['Hi', 'Don’t', 'go']);
    expect(tokens[1]).toMatchObject({ start: 4, end: 9 });
  });
});

describe('wordDistance', () => {
  it('computes character-level Levenshtein distance', () => {
    expect(wordDistance('kitten', 'sitting')).toBe(3);
    expect(wordDistance('', 'abc')).toBe(3);
    expect(wordDistance('same', 'same')).toBe(0);
  });
});

describe('alignSequences', () => {
  it('aligns identical sequences as matches', () => {
    expect(alignSequences(['a', 'b'], ['a', 'b']).map((step) => step.type)).toEqual(['match', 'match']);
  });

  it('handles empty sides', () => {
    expect(alignSequences([], [])).toEqual([]);
    expect(alignSequences(['a', 'b'], []).map((step) => step.type)).toEqual(['deletion', 'deletion']);
    expect(alignSequences([], ['a']).map((step) => step.type)).toEqual(['insertion']);
  });

  it('finds the minimal edit script', () => {
    const steps = alignSequences(['the', 'cat', 'sat', 'down'], ['the', 'bat', 'sat']);
    expect(steps.map((step) => step.type)).toEqual(['match', 'substitution', 'match', 'deletion']);
  });

  it('points every step at the right indices', () => {
    const steps = alignSequences(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    expect(steps).toEqual([
      { type: 'match', referenceIndex: 0, hypothesisIndex: 0 },
      { type: 'insertion', hypothesisIndex: 1 },
      { type: 'match', referenceIndex: 1, hypothesisIndex: 2 },
      { type: 'match', referenceIndex: 2, hypothesisIndex: 3 },
    ]);
  });
});

describe('compareTexts', () => {
  it('scores a perfect transcription as 100% regardless of case and punctuation', () => {
    const result = compareTexts("Well, I don't know.", "well i don't know");
    expect(result.wordErrorRate).toBe(0);
    expect(result.accuracy).toBe(1);
    expect(result.isExactMatch).toBe(true);
    expect(result.counts).toMatchObject({ matches: 4, substitutions: 0, deletions: 0, insertions: 0, referenceWords: 4 });
  });

  it('counts substitutions, deletions and insertions and computes WER', () => {
    // ref: the quick brown fox jumps (5)  hyp: the quik fox jumps high
    const result = compareTexts('The quick brown fox jumps.', 'the quik fox jumps high');
    expect(result.counts).toMatchObject({ matches: 3, substitutions: 1, deletions: 1, insertions: 1, referenceWords: 5 });
    expect(result.wordErrorRate).toBeCloseTo(3 / 5);
    expect(result.accuracy).toBeCloseTo(2 / 5);
  });

  it('preserves the distinction between contractions and full forms', () => {
    const result = compareTexts("I'm not sure", 'I am not sure');
    expect(result.isExactMatch).toBe(false);
    expect(result.counts.substitutions + result.counts.insertions).toBe(2);
    expect(result.wordErrorRate).toBeCloseTo(2 / 3);
  });

  it('flags near-miss spellings on substitutions', () => {
    const result = compareTexts("they don't receive it there", 'they dont recieve it their');
    const substitutions = result.alignment.filter((op) => op.type === 'substitution');
    expect(substitutions).toHaveLength(3);
    expect(substitutions.every((op) => op.type === 'substitution' && op.nearMiss)).toBe(true);
  });

  it('does not flag unrelated words as near misses', () => {
    const result = compareTexts('elephant', 'car');
    const [op] = result.alignment;
    expect(op).toMatchObject({ type: 'substitution', nearMiss: false });
  });

  it('can exceed 100% WER but accuracy never goes below zero', () => {
    const result = compareTexts('yes', 'no no no no');
    expect(result.wordErrorRate).toBe(4);
    expect(result.accuracy).toBe(0);
  });

  it('treats an empty answer as all deletions', () => {
    const result = compareTexts('one two three', '   ');
    expect(result.counts.deletions).toBe(3);
    expect(result.wordErrorRate).toBe(1);
    expect(result.accuracy).toBe(0);
  });

  it('handles an empty reference', () => {
    expect(compareTexts('', '').wordErrorRate).toBe(0);
    expect(compareTexts('[Music]', '').accuracy).toBe(1);
    const extra = compareTexts('', 'hello');
    expect(extra.wordErrorRate).toBe(1);
    expect(extra.accuracy).toBe(0);
  });

  it('exposes original tokens on each alignment step for rendering', () => {
    const result = compareTexts('Don’t stop.', 'dont stop');
    expect(result.alignment[0]).toMatchObject({
      type: 'substitution',
      reference: { text: 'Don’t' },
      hypothesis: { text: 'dont' },
    });
    expect(result.alignment[1]).toMatchObject({ type: 'match', reference: { text: 'stop' }, hypothesis: { text: 'stop' } });
  });

  it('ignores multi-line subtitle breaks', () => {
    expect(compareTexts('first line\nsecond line', 'first line second line').isExactMatch).toBe(true);
  });

  it('rejects inputs beyond the token limit instead of allocating huge matrices', () => {
    const long = Array.from({ length: 5001 }, () => 'word').join(' ');
    expect(() => compareTexts(long, 'word')).toThrow(RangeError);
  });
});
