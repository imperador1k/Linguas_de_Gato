import {
  GAP,
  GRAMMAR_LIMITS,
  OPEN_GRAMMAR_TYPES,
  modelGrammarQuestionSchema,
  type GrammarAnswer,
  type GrammarQuestion,
  type GrammarQuestionType,
  type GrammarSetRecord,
  type StoredGrammarReview,
} from '../contracts/grammar.js';

/**
 * Deterministic grammar logic: normalising answers, verifying generated
 * questions (consistency and ambiguity), scoring, and the attempt lifecycle.
 */

// --- Normalisation ---------------------------------------------------------------------

const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/n't\b/g, ' not'],
  [/'m\b/g, ' am'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
];

/**
 * Removes differences that never change the grammar being tested: case,
 * curly versus straight quotes, extra spaces, spaces before punctuation,
 * final sentence punctuation, surrounding quotes, and contracted versus full
 * forms (don't = do not). Commas and every word are kept: they can carry
 * meaning (defining versus non-defining clauses, "who" versus "whom").
 */
export function normalizeAnswer(value: string): string {
  let text = value.normalize('NFKC').toLowerCase().replace(/[‘’‛′]/g, "'").replace(/[“”]/g, '"');
  text = text.trim().replace(/^["']+|["']+$/g, '').trim();
  text = text.replace(/[.!?;:…]+$/u, '').trim();
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  return text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,(?=\S)/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words only (letters, digits, apostrophes), lower-cased: what a word-order answer is made of. */
export function wordTokens(value: string): string[] {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .match(/[\p{L}\p{N}']+/gu) ?? []
  ).map((token) => token.replace(/^'+|'+$/g, '')).filter(Boolean);
}

const sameMultiset = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

const gapCount = (prompt: string) => prompt.split(GAP).length - 1;

// --- Verification of generated questions -------------------------------------------------------

export interface GrammarVerification {
  readonly questions: GrammarQuestion[];
  readonly discarded: number;
}

/**
 * Keeps only questions with exactly one defensible answer set:
 * - multiple choice: 3-4 distinct options, a valid key, an explanation per option;
 * - gaps (gap fill, transformation, completion): exactly one ___ and short answers;
 * - transformation: a source sentence and a keyword that every accepted answer uses;
 * - error correction: no gap, and every accepted answer actually differs from the prompt;
 * - word order: every accepted answer uses exactly the given words;
 * - accepted answers must be distinct after normalisation, and only requested types are kept.
 */
export function verifyGrammarQuestions(
  raw: readonly unknown[],
  options: { readonly types: readonly GrammarQuestionType[]; readonly maxQuestions: number },
): GrammarVerification {
  const allowed = new Set(options.types);
  const seenPrompts = new Set<string>();
  const questions: GrammarQuestion[] = [];
  let discarded = 0;

  for (const item of raw) {
    const parsed = modelGrammarQuestionSchema.safeParse(item);
    const verified = parsed.success && allowed.has(parsed.data.type) ? toVerifiedQuestion(parsed.data, `q${questions.length + 1}`) : null;
    const promptKey = verified ? `${verified.type}|${normalizeAnswer(verified.type === 'transformation' ? verified.sourceSentence : verified.prompt)}` : '';
    if (!verified || seenPrompts.has(promptKey)) {
      discarded += 1;
      continue;
    }
    seenPrompts.add(promptKey);
    questions.push(verified);
    if (questions.length >= options.maxQuestions) break;
  }
  return { questions, discarded };
}

/**
 * Accepted answers with variants that normalise to the same thing collapsed
 * ("would have passed" / "would've passed"); null if none is usable.
 */
function uniqueAnswers(answers: readonly string[]): string[] | null {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const answer of answers) {
    const key = normalizeAnswer(answer);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    unique.push(answer);
  }
  return unique.length > 0 ? unique : null;
}

const wordCount = (value: string) => wordTokens(value).length;

function toVerifiedQuestion(question: ReturnType<typeof modelGrammarQuestionSchema.parse>, id: string): GrammarQuestion | null {
  const base = { id, prompt: question.prompt, explanation: question.explanation, rule: question.rule };
  switch (question.type) {
    case 'multiple_choice': {
      const { options, correctOptionIndex: index, distractorExplanations } = question;
      const distinct = new Set(options.map(normalizeAnswer)).size === options.length;
      if (options.length < 3 || index === null || index >= options.length || !distinct) return null;
      if (distractorExplanations.length !== options.length) return null;
      // Every wrong option needs a reason; the key's own entry may be brief.
      if (distractorExplanations.some((reason, position) => position !== index && reason.trim() === '')) return null;
      if (gapCount(question.prompt) > 1) return null;
      return { ...base, type: 'multiple_choice', options: [...options], correctOptionIndex: index, distractorExplanations: [...distractorExplanations] };
    }
    case 'gap_fill': {
      const answers = uniqueAnswers(question.acceptedAnswers);
      if (gapCount(question.prompt) !== 1 || !answers || answers.some((answer) => wordCount(answer) > 5)) return null;
      return { ...base, type: 'gap_fill', acceptedAnswers: answers };
    }
    case 'sentence_completion': {
      const answers = uniqueAnswers(question.acceptedAnswers);
      if (gapCount(question.prompt) !== 1 || !answers || answers.some((answer) => wordCount(answer) > 14)) return null;
      return { ...base, type: 'sentence_completion', acceptedAnswers: answers };
    }
    case 'transformation': {
      const { sourceSentence, keyword } = question;
      const answers = uniqueAnswers(question.acceptedAnswers);
      if (!sourceSentence || !keyword || gapCount(question.prompt) !== 1 || !answers) return null;
      const key = wordTokens(keyword);
      if (key.length !== 1) return null;
      // Contractions count as their full form, so "would've" still contains the keyword's neighbours correctly.
      const usesKeyword = (answer: string) => wordTokens(normalizeAnswer(answer)).includes(key[0] as string);
      const size = (answer: string) => wordCount(normalizeAnswer(answer));
      if (!answers.every((answer) => usesKeyword(answer) && size(answer) >= 2 && size(answer) <= 8)) return null;
      return { ...base, type: 'transformation', sourceSentence, keyword: keyword.toUpperCase(), acceptedAnswers: answers };
    }
    case 'error_correction': {
      const answers = uniqueAnswers(question.acceptedAnswers);
      if (gapCount(question.prompt) !== 0 || !answers) return null;
      const original = normalizeAnswer(question.prompt);
      if (answers.some((answer) => normalizeAnswer(answer) === original)) return null;
      return { ...base, type: 'error_correction', acceptedAnswers: answers };
    }
    case 'word_order': {
      const given = question.words.flatMap(wordTokens);
      const answers = uniqueAnswers(question.acceptedAnswers);
      if (question.words.length < 3 || given.length < 3 || !answers) return null;
      if (!answers.every((answer) => sameMultiset(wordTokens(answer), given))) return null;
      return { ...base, type: 'word_order', words: [...question.words], acceptedAnswers: answers };
    }
  }
}

// --- Scoring ----------------------------------------------------------------------------

export interface AnswerEvaluation {
  readonly correct: boolean;
  /** The accepted answer the learner's answer matched, when it matched one. */
  readonly matched: string | null;
}

/**
 * Deterministic: an answer is correct only if it equals an accepted answer
 * after `normalizeAnswer` (or, for word order, uses the same words in the
 * same order). For gap questions the learner may type just the missing words
 * or the whole sentence.
 */
export function evaluateGrammarAnswer(question: GrammarQuestion, answer: GrammarAnswer | undefined): AnswerEvaluation {
  if (!answer) return { correct: false, matched: null };
  if (question.type === 'multiple_choice') {
    if (answer.kind !== 'choice') return { correct: false, matched: null };
    const correct = answer.selectedIndex === question.correctOptionIndex;
    return { correct, matched: correct ? (question.options[question.correctOptionIndex] ?? null) : null };
  }
  if (answer.kind !== 'text' || answer.text.trim() === '') return { correct: false, matched: null };

  if (question.type === 'word_order') {
    const given = wordTokens(answer.text).join(' ');
    const matched = question.acceptedAnswers.find((accepted) => wordTokens(accepted).join(' ') === given) ?? null;
    return { correct: matched !== null, matched };
  }

  const learner = normalizeAnswer(answer.text);
  const hasGap = question.type === 'gap_fill' || question.type === 'transformation' || question.type === 'sentence_completion';
  const matched =
    question.acceptedAnswers.find(
      (accepted) => normalizeAnswer(accepted) === learner || (hasGap && normalizeAnswer(fillGap(question.prompt, accepted)) === learner),
    ) ?? null;
  return { correct: matched !== null, matched };
}

/** The prompt with its gap filled; a base-word hint right after the gap ("___ (know)") is dropped. */
export function fillGap(prompt: string, answer: string): string {
  return prompt.replace(/___(\s*\([^)]{1,40}\))?/, answer);
}

export interface GrammarScore {
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
}

export function isAnswered(answer: GrammarAnswer | undefined): boolean {
  return answer !== undefined && (answer.kind === 'choice' || answer.text.trim() !== '');
}

export function scoreGrammarSet(record: Pick<GrammarSetRecord, 'set' | 'answers'>): GrammarScore {
  const byQuestion = new Map(record.answers.map((answer) => [answer.questionId, answer]));
  let answered = 0;
  let correct = 0;
  for (const question of record.set.questions) {
    const answer = byQuestion.get(question.id);
    if (isAnswered(answer)) answered += 1;
    if (evaluateGrammarAnswer(question, answer).correct) correct += 1;
  }
  return { total: record.set.questions.length, answered, correct };
}

// --- Attempt lifecycle --------------------------------------------------------------------

/** Records an answer; ignored once the round is checked, or if it doesn't fit the question. */
export function withGrammarAnswer(record: GrammarSetRecord, answer: GrammarAnswer, now: number): GrammarSetRecord {
  if (record.checkedAt !== null) return record;
  const question = record.set.questions.find((candidate) => candidate.id === answer.questionId);
  if (!question) return record;
  if ((question.type === 'multiple_choice') !== (answer.kind === 'choice')) return record;
  if (answer.kind === 'choice' && question.type === 'multiple_choice' && answer.selectedIndex >= question.options.length) return record;
  if (answer.kind === 'text' && answer.text.length > GRAMMAR_LIMITS.maxAnswerChars) return record;
  return { ...record, answers: [...record.answers.filter((existing) => existing.questionId !== answer.questionId), answer], updatedAt: now };
}

/** Locks the round and appends its deterministic score to the history. */
export function checkGrammarSet(record: GrammarSetRecord, now: number): GrammarSetRecord {
  if (record.checkedAt !== null) return record;
  const { correct, total } = scoreGrammarSet(record);
  return { ...record, checkedAt: now, history: [...record.history, { checkedAt: now, correct, total }].slice(-100), updatedAt: now };
}

/** Starts a new round: answers and second opinions are cleared, history is kept. */
export function retryGrammarSet(record: GrammarSetRecord, now: number): GrammarSetRecord {
  return { ...record, answers: [], reviews: [], checkedAt: null, updatedAt: now };
}

/** Whether a second opinion may be requested for this question in the current round. */
export function canRequestReview(record: GrammarSetRecord, question: GrammarQuestion): boolean {
  if (record.checkedAt === null || !OPEN_GRAMMAR_TYPES.has(question.type)) return false;
  const answer = record.answers.find((candidate) => candidate.questionId === question.id);
  return isAnswered(answer) && !evaluateGrammarAnswer(question, answer).correct;
}

/** Stores a second opinion, only for the answer it reviewed. It never changes the score. */
export function withGrammarReview(record: GrammarSetRecord, review: StoredGrammarReview, now: number): GrammarSetRecord {
  const question = record.set.questions.find((candidate) => candidate.id === review.questionId);
  const answer = record.answers.find((candidate) => candidate.questionId === review.questionId);
  if (!question || !canRequestReview(record, question) || answer?.kind !== 'text' || answer.text !== review.answer) return record;
  return { ...record, reviews: [...record.reviews.filter((existing) => existing.questionId !== review.questionId), review], updatedAt: now };
}
