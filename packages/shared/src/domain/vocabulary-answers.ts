import type { LanguageCode } from './languages.js';
import { wordDistance } from './text-compare.js';

/**
 * Answer matching for typed vocabulary answers (Vocabulary Trainer).
 *
 * Only listed answers are ever accepted: the expected answer, explicit
 * alternatives and spelling variants. Everything else is classified so the
 * feedback can say what went wrong (a typo, the wrong form of the right word)
 * without ever counting a near miss as correct.
 *
 * Normalisation is split into generic rules (Unicode, case, spacing,
 * apostrophes, dashes, surrounding punctuation) and per-language rules, so
 * English conventions never leak into other languages.
 */

export type MatchVerdict = 'correct' | 'almost' | 'wrong_form' | 'incorrect' | 'empty';

export interface MatchResult {
  readonly verdict: MatchVerdict;
  /**
   * Why: `exact`; `variant` (a listed alternative or spelling); `hyphenation`
   * (hyphen or space written differently); `accents` (only diacritics differ);
   * `spelling` (a small typo); `form` (another form of the word); `none`.
   */
  readonly reason: 'exact' | 'variant' | 'hyphenation' | 'accents' | 'spelling' | 'form' | 'none';
  /** The listed answer the input matched or came closest to. */
  readonly closest: string;
}

export interface ExpectedAnswer {
  readonly answer: string;
  readonly accepted?: readonly string[];
  /** Other forms of the same word (never accepted; recognised for feedback). */
  readonly forms?: readonly string[];
}

/**
 * The language an answer is written in: a target language, or Portuguese
 * (Portugal) for English → Portuguese questions, where the learner answers in
 * their support language.
 */
export type AnswerLanguage = LanguageCode | 'pt';

interface LanguageRules {
  /** Whether diacritics distinguish words (true by default: "e" and "é" differ in Portuguese, French…). */
  readonly accentsDistinguish: boolean;
  /**
   * Articles that may be written before a translation or left out ("o livro"
   * and "livro" both name the meaning). Only a leading article is ignored,
   * and only when something remains.
   */
  readonly optionalArticles: readonly string[];
}

/**
 * English rarely uses diacritics and treats them as optional ("café"/"cafe",
 * "naïve"/"naive"). Portuguese keeps them distinctive (a near miss, never
 * correct) but lets an article be added or dropped. Languages without an entry
 * get the strict default, so a future pack never inherits leniency by accident.
 */
const LANGUAGE_RULES: Partial<Record<AnswerLanguage, LanguageRules>> = {
  en: { accentsDistinguish: false, optionalArticles: [] },
  pt: { accentsDistinguish: true, optionalArticles: ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas'] },
};
const DEFAULT_RULES: LanguageRules = { accentsDistinguish: true, optionalArticles: [] };

function rulesFor(language: AnswerLanguage): LanguageRules {
  return LANGUAGE_RULES[language] ?? DEFAULT_RULES;
}

function withoutArticle(value: string, rules: LanguageRules): string {
  const [first, ...rest] = value.split(' ');
  return rest.length > 0 && first !== undefined && rules.optionalArticles.includes(first) ? rest.join(' ') : value;
}

/** Generic normalisation, safe for any language written with spaces between words. */
export function normalizeTyped(value: string, language: AnswerLanguage): string {
  return (
    value
      .normalize('NFC')
      .toLocaleLowerCase(language)
      // Typographic apostrophes and primes all mean the same apostrophe.
      .replace(/[‘’‛′ʼ`´]/g, "'")
      // Hyphen-like dashes become a plain hyphen.
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s*-\s*/g, '-')
      .trim()
      // Quotes around the answer and final sentence punctuation are not part of the word.
      .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
      .replace(/[.,!?;:…]+$/u, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const stripAccents = (value: string) => value.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
/** Hyphen and space are interchangeable ("well-known"/"well known", "e-mail"/"e mail"). */
const looseHyphens = (value: string) => value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/** Typos allowed for a near miss: none for very short words, one edit, two for long ones. */
export function typoAllowance(length: number): number {
  if (length < 4) return 0;
  return length >= 9 ? 2 : 1;
}

/** Edit distance where swapping two adjacent letters counts as one mistake. */
function typoDistance(a: string, b: string): number {
  const distance = wordDistance(a, b);
  if (distance !== 2 || a.length !== b.length) return distance;
  const left = Array.from(a);
  const right = Array.from(b);
  const differing = left.flatMap((char, index) => (char === right[index] ? [] : [index]));
  const [first, second] = differing;
  return differing.length === 2 && first !== undefined && second === first + 1 && left[first] === right[second] && left[second] === right[first] ? 1 : distance;
}

export function matchVocabularyAnswer(input: string, expected: ExpectedAnswer, language: AnswerLanguage): MatchResult {
  const rules = rulesFor(language);
  const normalize = (value: string) => withoutArticle(normalizeTyped(value, language), rules);
  const typed = normalize(input);
  const answer = normalize(expected.answer);
  if (typed === '') return { verdict: 'empty', reason: 'none', closest: expected.answer };

  const listed = [expected.answer, ...(expected.accepted ?? [])].map((value) => ({ value, normalized: normalize(value) }));
  const forms = (expected.forms ?? []).map((value) => ({ value, normalized: normalize(value) })).filter((form) => !listed.some((item) => item.normalized === form.normalized));

  // 1. Listed answers, exactly.
  for (const item of listed) if (item.normalized === typed) return { verdict: 'correct', reason: item.normalized === answer ? 'exact' : 'variant', closest: item.value };
  // 2. Hyphen or space written differently.
  for (const item of listed) if (looseHyphens(item.normalized) === looseHyphens(typed)) return { verdict: 'correct', reason: 'hyphenation', closest: item.value };
  // 3. Diacritics only: optional where the language treats them so, otherwise a near miss.
  for (const item of listed) {
    if (looseHyphens(stripAccents(item.normalized)) === looseHyphens(stripAccents(typed))) {
      return rules.accentsDistinguish ? { verdict: 'almost', reason: 'accents', closest: item.value } : { verdict: 'correct', reason: 'accents', closest: item.value };
    }
  }
  // 4. Another form of the same word: never accepted, but worth saying.
  for (const form of forms) if (looseHyphens(stripAccents(form.normalized)) === looseHyphens(stripAccents(typed))) return { verdict: 'wrong_form', reason: 'form', closest: expected.answer };
  // 5. A small typo in a listed answer.
  let best: { value: string; distance: number } | null = null;
  for (const item of listed) {
    const distance = typoDistance(looseHyphens(stripAccents(typed)), looseHyphens(stripAccents(item.normalized)));
    if (distance <= typoAllowance(Array.from(item.normalized).length) && (best === null || distance < best.distance)) best = { value: item.value, distance };
  }
  if (best) return { verdict: 'almost', reason: 'spelling', closest: best.value };
  // 6. A small typo in another form still points at the right word in the wrong form.
  for (const form of forms) {
    const distance = typoDistance(looseHyphens(stripAccents(typed)), looseHyphens(stripAccents(form.normalized)));
    if (distance <= typoAllowance(Array.from(form.normalized).length)) return { verdict: 'wrong_form', reason: 'form', closest: expected.answer };
  }
  return { verdict: 'incorrect', reason: 'none', closest: expected.answer };
}

/**
 * What the question asked for, so feedback can say why a form is wrong:
 * `context` (the form a sentence needs), `lemma` (the dictionary form) or
 * `translation` (a Portuguese translation). `answer` is the main expected answer.
 */
export interface MatchSituation {
  readonly expects: 'context' | 'lemma' | 'translation';
  readonly answer: string;
}

/** Learner-facing feedback for a verdict. */
export function describeMatch(result: MatchResult, situation?: MatchSituation): string {
  switch (result.verdict) {
    case 'correct':
      if (result.reason === 'variant') {
        // An alternative the learner listed for this sense: correct, and worth knowing the main answer too.
        return situation && situation.answer !== result.closest ? `Correct — “${result.closest}” is an accepted alternative. Main answer: “${situation.answer}”.` : `Correct (also: ${result.closest}).`;
      }
      return result.reason === 'hyphenation' ? `Correct. Also written “${result.closest}”.` : 'Correct.';
    case 'almost':
      return result.reason === 'accents' ? `Almost — check the accents: “${result.closest}”.` : `Almost — check the spelling: “${result.closest}”.`;
    case 'wrong_form':
      if (situation?.expects === 'context') return `Right word and meaning, but not the form this sentence needs: “${result.closest}”.`;
      if (situation?.expects === 'lemma') return `Right word, wrong grammatical form. Write the dictionary form: “${result.closest}”.`;
      return `Correct word, wrong grammatical form. Expected: “${result.closest}”.`;
    case 'incorrect':
      return `Incorrect — expected answer: “${result.closest}”.`;
    case 'empty':
      return 'No answer.';
  }
}
